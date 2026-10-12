// runSelection (docs/04 §6–7): one Gemini call, validate, up to 2 re-prompts,
// then deterministic repair. Gemini proposes; code checks; nothing here sends.
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { articles, type Issue, styleExamples, styleGuides } from "@/db/schema";
import { type GenerateJsonOptions, type GenerateJsonResult, generateJson } from "@/lib/ai/gemini";
import { buildRepairPrompt, buildSystemPrompt, buildUserPrompt, type FewShotExample, type PromptCandidate } from "@/lib/ai/prompts";
import { BACKUPS, PICKS_MAX, PICKS_MIN, type SelectionOut, SelectionShape, type StoryOut, selectionJsonSchema, TOPICS } from "@/lib/ai/schemas";
import { db } from "@/lib/db";
import { ACTIVE_RULE, judgePair, pickRepresentatives } from "@/lib/dedupe/engine";
import { type LastFourEntry, loadLastFourSet } from "@/lib/dedupe/history";
import { similarityOfSets, trigrams } from "@/lib/dedupe/trigram";
import type { Logger } from "@/lib/log";
import { istDate } from "@/lib/time";
import mockSelection from "@/tests/fixtures/selection.json";
import { MAX_CANDIDATES, trimCandidates } from "./candidates";
import { groundingLint, openingRepeats, parseNeverSay } from "./lint";
import { type CandidateInfo, type ValidationResult, type Violation, validateSelection } from "./validate";

export const MAX_REPROMPTS = 2;

export class CurateBlockedError extends Error {
  constructor(
    message: string,
    readonly reason: "style_guide_missing" | "style_guide_incomplete" | "too_few_candidates",
  ) {
    super(message);
    this.name = "CurateBlockedError";
  }
}

export interface CurateContext {
  styleGuide: { version: number; content: string };
  neverSay: string[];
  candidates: Map<string, CandidateInfo & { publishedAt: Date | null }>;
  promptCandidates: PromptCandidate[];
  lastFour: LastFourEntry[];
  fewShot: FewShotExample[];
  candidatesTotal: number;
}

/** Everything the selection call needs, from Neon. */
export async function loadCurateContext(issue: Issue): Promise<CurateContext> {
  const [guide] = await db()
    .select({ version: styleGuides.version, content: styleGuides.content, hasFillMarkers: styleGuides.hasFillMarkers })
    .from(styleGuides)
    .where(eq(styleGuides.active, true));
  if (!guide) throw new CurateBlockedError("no active style guide; run npm run seed", "style_guide_missing");
  if (guide.hasFillMarkers) throw new CurateBlockedError("style guide still has [FILL] markers", "style_guide_incomplete");

  const rows = await db()
    .select({
      id: articles.id,
      title: articles.title,
      titleNorm: articles.titleNorm,
      entities: articles.entities,
      canonicalHash: articles.canonicalHash,
      snippet: articles.snippet,
      publisher: articles.publisher,
      publishedAt: articles.publishedAt,
      status: articles.status,
      duplicateOf: articles.duplicateOf,
    })
    .from(articles)
    .where(and(eq(articles.issueId, issue.id), inArray(articles.status, ["candidate", "duplicate", "selected", "backup"])));

  // A cluster competes only if its root is still eligible (not seen_before).
  // selected/backup count as eligible so a forced re-curate reconsiders the last draft's stories.
  const eligible = new Set(["candidate", "selected", "backup"]);
  const candidateRoots = new Set(rows.filter((r) => eligible.has(r.status)).map((r) => r.id));
  const members = rows.filter((r) => candidateRoots.has(r.duplicateOf ?? r.id));
  const reps = trimCandidates(pickRepresentatives(members), MAX_CANDIDATES);

  const candidates = new Map<string, CandidateInfo & { publishedAt: Date | null }>();
  const promptCandidates: PromptCandidate[] = [];
  reps.forEach((r, i) => {
    const shortId = `a${String(i + 1).padStart(2, "0")}`;
    candidates.set(shortId, {
      shortId,
      articleId: r.id,
      title: r.title,
      titleNorm: r.titleNorm,
      entities: r.entities,
      canonicalHash: r.canonicalHash,
      clusterRoot: r.duplicateOf ?? r.id,
      snippet: r.snippet,
      publisher: r.publisher,
      publishedAt: r.publishedAt,
    });
    promptCandidates.push({
      id: shortId,
      source: r.publisher ?? "unknown",
      published: r.publishedAt ? istDate(r.publishedAt) : "unknown",
      title: r.title,
      snippet: r.snippet ?? "",
    });
  });

  const lastFour = await loadLastFourSet(issue.issueDate);
  const fewShot = await db()
    .select({ articleTitle: styleExamples.articleTitle, aiText: styleExamples.aiText, finalText: styleExamples.finalText })
    .from(styleExamples)
    .where(lt(styleExamples.similarity, 0.9))
    .orderBy(desc(styleExamples.createdAt))
    .limit(5);

  return {
    styleGuide: { version: guide.version, content: guide.content },
    neverSay: parseNeverSay(guide.content),
    candidates,
    promptCandidates,
    lastFour,
    fewShot,
    candidatesTotal: candidateRoots.size,
  };
}

function isSameStory(a: CandidateInfo, b: CandidateInfo): boolean {
  if (a.clusterRoot === b.clusterRoot) return true;
  const sim = similarityOfSets(trigrams(a.titleNorm), trigrams(b.titleNorm));
  return judgePair(sim, a.entities, b.entities, ACTIVE_RULE).duplicate;
}

/**
 * Deterministic repair after the re-prompts are exhausted (docs/04 §6): drop
 * violating stories, promote backups in rank order (never two copies of one
 * story) while restoring a 3-topic spread. Never pads with weak stories.
 */
export function repairSelection(
  sel: SelectionOut,
  validation: ValidationResult,
  candidates: ReadonlyMap<string, CandidateInfo>,
): { picks: StoryOut[]; backups: StoryOut[]; needsAttention: boolean; notes: string[] } {
  const notes: string[] = [];
  const bad = new Set(validation.violations.filter((v) => v.articleId).map((v) => `${v.role}:${v.articleId}`));
  const used = new Set<string>();
  const okStory = (s: StoryOut, role: "pick" | "backup") =>
    candidates.has(s.article_id) && !used.has(s.article_id) && !bad.has(`${role}:${s.article_id}`);

  const picks: StoryOut[] = [];
  for (const s of sel.picks) {
    if (picks.length >= PICKS_MAX) break;
    const c = candidates.get(s.article_id);
    if (!okStory(s, "pick") || !c || picks.some((p) => isSameStory(candidates.get(p.article_id) as CandidateInfo, c))) {
      notes.push(`dropped pick ${s.article_id}`);
      continue;
    }
    picks.push(s);
    used.add(s.article_id);
  }

  const bench = sel.backups.filter((s) => okStory(s, "backup"));
  const fitsPicks = (s: StoryOut) => {
    const c = candidates.get(s.article_id) as CandidateInfo;
    return !picks.some((p) => isSameStory(candidates.get(p.article_id) as CandidateInfo, c));
  };
  const promote = (s: StoryOut, why: string) => {
    picks.push(s);
    used.add(s.article_id);
    bench.splice(bench.indexOf(s), 1);
    notes.push(`promoted backup ${s.article_id} (${why})`);
  };

  for (const s of [...bench]) {
    if (picks.length >= PICKS_MIN) break;
    if (!used.has(s.article_id) && fitsPicks(s)) promote(s, "fill");
  }

  const spread = () => new Set(picks.map((p) => p.topic)).size;
  for (const s of [...bench]) {
    if (spread() >= 3) break;
    if (used.has(s.article_id) || !fitsPicks(s) || picks.some((p) => p.topic === s.topic)) continue;
    if (picks.length < PICKS_MAX) {
      promote(s, "topic spread");
    } else {
      const counts = new Map<string, number>();
      for (const p of picks) counts.set(p.topic, (counts.get(p.topic) ?? 0) + 1);
      const victimIdx = [...picks].reverse().findIndex((p) => (counts.get(p.topic) ?? 0) > 1);
      if (victimIdx < 0) continue;
      const realIdx = picks.length - 1 - victimIdx;
      const [victim] = picks.splice(realIdx, 1);
      if (victim) {
        used.delete(victim.article_id);
        notes.push(`replaced pick ${victim.article_id} for topic spread`);
      }
      promote(s, "topic spread");
    }
  }

  const backups = bench.filter((s) => !used.has(s.article_id)).slice(0, BACKUPS);
  const needsAttention = picks.length < PICKS_MIN || spread() < 3;
  if (picks.length < PICKS_MIN) notes.push(`only ${picks.length} valid picks; not padding with weak stories`);
  if (spread() < 3) notes.push(`picks span only ${spread()} topic(s)`);
  return { picks, backups, needsAttention, notes };
}

export interface SelectedStory {
  shortId: string;
  articleId: string;
  role: "pick" | "backup";
  position: number | null;
  backupRank: number | null;
  topic: string;
  signalType: string;
  rationale: string;
  headline: string;
  commentary: string;
  flags: string[];
}

export interface SelectionAttempt {
  attempt: number;
  violations: { code: string; articleId?: string }[];
  usage: GenerateJsonResult<SelectionOut>["usage"];
  latencyMs: number;
  geminiAttempts: number;
}

export interface SelectionResult {
  picks: SelectedStory[];
  backups: SelectedStory[];
  needsAttention: boolean;
  repaired: boolean;
  notes: string[];
  attempts: SelectionAttempt[];
  model: string;
  styleGuideVersion: number;
  candidatesSent: number;
  candidatesTotal: number;
  usage: { in: number; out: number; thoughts: number };
}

type Generate = (opts: GenerateJsonOptions<SelectionOut>) => Promise<GenerateJsonResult<SelectionOut>>;

function toStories(
  stories: StoryOut[],
  role: "pick" | "backup",
  ctx: CurateContext,
  warnings: Record<string, string[]>,
  repeatedOpenings: Set<string>,
): SelectedStory[] {
  return stories.map((s, i) => {
    const c = ctx.candidates.get(s.article_id) as CandidateInfo;
    const opening = s.commentary.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") ?? "";
    const flags = [
      ...groundingLint(s.commentary, `${c.title} ${c.snippet ?? ""}`),
      ...(warnings[s.article_id] ?? []).map((w) => `voice:${w}`),
      ...(repeatedOpenings.has(opening) ? [`repeated_opening:${opening}`] : []),
    ];
    return {
      shortId: s.article_id,
      articleId: c.articleId,
      role,
      position: role === "pick" ? i + 1 : null,
      backupRank: role === "backup" ? i + 1 : null,
      topic: s.topic,
      signalType: s.signal_type,
      rationale: s.rationale.trim(),
      headline: c.title,
      commentary: s.commentary.trim(),
      flags,
    };
  });
}

export async function runSelection(
  issue: Issue,
  opts: { log: Logger; deadline: number; generate?: Generate; context?: CurateContext },
): Promise<SelectionResult> {
  const ctx = opts.context ?? (await loadCurateContext(issue));
  // docs/02 §8: with a thin batch, still run Gemini and flag the draft; only an
  // impossible batch (fewer than the minimum number of picks) is refused.
  if (ctx.candidates.size < PICKS_MIN) {
    throw new CurateBlockedError(`only ${ctx.candidates.size} candidates; need at least ${PICKS_MIN}`, "too_few_candidates");
  }
  const generate = opts.generate ?? generateJson<SelectionOut>;
  const ids = [...ctx.candidates.keys()];
  const system = buildSystemPrompt({
    topics: TOPICS,
    styleGuide: ctx.styleGuide.content,
    fewShot: ctx.fewShot,
    lastFour: ctx.lastFour.map((e) => ({ issueDate: e.issueDate, topic: e.topic, headline: e.headline })),
  });
  const baseUser = buildUserPrompt(ctx.promptCandidates);
  const validationCtx = { candidates: ctx.candidates, lastFour: ctx.lastFour, neverSay: ctx.neverSay };

  const attempts: SelectionAttempt[] = [];
  let user = baseUser;
  let last: { sel: SelectionOut; validation: ValidationResult } | null = null;
  let model = "unknown";
  const usage = { in: 0, out: 0, thoughts: 0 };

  for (let i = 0; i <= MAX_REPROMPTS; i += 1) {
    const res = await generate({
      system,
      user,
      jsonSchema: selectionJsonSchema(ids),
      parse: (raw) => SelectionShape.parse(raw),
      label: i === 0 ? "curate.select" : `curate.select.reprompt${i}`,
      log: opts.log,
      temperature: 0.4,
      deadline: opts.deadline,
      mock: () => mockSelection,
    });
    model = res.model;
    usage.in += res.usage.in;
    usage.out += res.usage.out;
    usage.thoughts += res.usage.thoughts;
    const validation = validateSelection(res.data, validationCtx);
    attempts.push({
      attempt: i + 1,
      violations: validation.violations.map((v) => ({ code: v.code, articleId: v.articleId })),
      usage: res.usage,
      latencyMs: res.latencyMs,
      geminiAttempts: res.attempts,
    });
    last = { sel: res.data, validation };
    if (validation.ok) break;
    opts.log.warn("selection invalid", { attempt: i + 1, codes: [...new Set(validation.violations.map((v) => v.code))] });
    if (i < MAX_REPROMPTS) user = buildRepairPrompt(baseUser, validation.violations as Violation[]);
  }
  if (!last) throw new Error("selection produced no answer");

  let picks = last.sel.picks;
  let backups = last.sel.backups;
  let needsAttention = false;
  let repaired = false;
  let notes: string[] = [];
  if (!last.validation.ok) {
    ({ picks, backups, needsAttention, notes } = repairSelection(last.sel, last.validation, ctx.candidates));
    repaired = true;
    opts.log.warn("selection repaired", { notes, needsAttention });
  }

  const repeated = new Set(openingRepeats(picks.map((p) => p.commentary)));
  return {
    picks: toStories(picks, "pick", ctx, last.validation.warnings, repeated),
    backups: toStories(backups, "backup", ctx, last.validation.warnings, new Set()),
    needsAttention,
    repaired,
    notes,
    attempts,
    model,
    styleGuideVersion: ctx.styleGuide.version,
    candidatesSent: ctx.candidates.size,
    candidatesTotal: ctx.candidatesTotal,
    usage,
  };
}

/** Counts used by the dashboard and run stats. */
export function summarize(result: SelectionResult) {
  return {
    picks: result.picks.length,
    backups: result.backups.length,
    topics: [...new Set(result.picks.map((p) => p.topic))],
    signals: result.picks.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.signalType]: (acc[p.signalType] ?? 0) + 1 }), {}),
    flagged: result.picks.filter((p) => p.flags.length > 0).length,
    needsAttention: result.needsAttention,
    repaired: result.repaired,
  };
}
