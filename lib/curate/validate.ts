// validateSelection (docs/04 §6). Pure: everything it needs is passed in.
import { BACKUPS, PICKS_MAX, PICKS_MIN, SIGNAL_TYPES, type SelectionOut, type StoryOut, TOPICS } from "@/lib/ai/schemas";
import { ACTIVE_RULE, judgePair, sharedEntityCount } from "@/lib/dedupe/engine";
import { type LastFourEntry, matchLastFour } from "@/lib/dedupe/history";
import { similarityOfSets, trigrams } from "@/lib/dedupe/trigram";
import { MAX_SENTENCES, MAX_WORDS, MIN_SENTENCES, splitSentences, voiceLint, wordCount } from "./lint";

export type ViolationCode =
  | "COUNT"
  | "UNKNOWN_ID"
  | "DUPLICATE_ID"
  | "TOPIC_SPREAD"
  | "LAST_FOUR_HIT"
  | "SAME_STORY_IN_PICKS"
  | "COMMENTARY_SHAPE"
  | "VOICE_LINT";

export interface Violation {
  code: ViolationCode;
  message: string;
  /** Short candidate id as Gemini sees it (e.g. "a07"). */
  articleId?: string;
  role?: "pick" | "backup";
}

export interface CandidateInfo {
  shortId: string;
  articleId: string;
  title: string;
  titleNorm: string;
  entities: string[];
  canonicalHash: string;
  /** Root of the article's duplicate cluster (its own id when it has none). */
  clusterRoot: string;
  snippet: string | null;
  publisher: string | null;
}

export interface ValidationContext {
  candidates: ReadonlyMap<string, CandidateInfo>;
  lastFour: readonly LastFourEntry[];
  neverSay: readonly string[];
}

export interface ValidationResult {
  ok: boolean;
  violations: Violation[];
  /** Non-fatal voice lint findings, keyed by short id. */
  warnings: Record<string, string[]>;
}

/** Last-4 rule for the validator: the dedupe rule, or (docs/04 §6) similarity ≥ 0.5 with any shared entity. */
export function hitsLastFour(c: CandidateInfo, lastFour: readonly LastFourEntry[]): LastFourEntry | null {
  const hit = matchLastFour(c, lastFour, ACTIVE_RULE);
  if (hit) return hit.entry;
  const tri = trigrams(c.titleNorm);
  for (const e of lastFour) {
    const sim = Math.max(similarityOfSets(tri, e.titleTri), similarityOfSets(tri, e.headlineTri));
    if (sim >= 0.5 && sharedEntityCount(c.entities, e.entities, { distinctiveOnly: true }) >= 1) return e;
  }
  return null;
}

export function validateSelection(sel: SelectionOut, ctx: ValidationContext): ValidationResult {
  const violations: Violation[] = [];
  const warnings: Record<string, string[]> = {};
  const tagged: { story: StoryOut; role: "pick" | "backup" }[] = [
    ...sel.picks.map((story) => ({ story, role: "pick" as const })),
    ...sel.backups.map((story) => ({ story, role: "backup" as const })),
  ];

  // COUNT
  if (sel.picks.length < PICKS_MIN || sel.picks.length > PICKS_MAX) {
    violations.push({ code: "COUNT", message: `picks must be ${PICKS_MIN}–${PICKS_MAX}, got ${sel.picks.length}` });
  }
  if (sel.backups.length !== BACKUPS) {
    violations.push({ code: "COUNT", message: `backups must be exactly ${BACKUPS}, got ${sel.backups.length}` });
  }

  // UNKNOWN_ID (also enum checks for topic / signal_type, which the schema should prevent)
  for (const { story, role } of tagged) {
    if (!ctx.candidates.has(story.article_id)) {
      violations.push({ code: "UNKNOWN_ID", message: "id is not in CANDIDATES", articleId: story.article_id, role });
    }
    if (!TOPICS.includes(story.topic)) {
      violations.push({ code: "UNKNOWN_ID", message: `topic "${story.topic}" is not in TOPICS`, articleId: story.article_id, role });
    }
    if (!(SIGNAL_TYPES as readonly string[]).includes(story.signal_type)) {
      violations.push({ code: "UNKNOWN_ID", message: `signal_type "${story.signal_type}" is invalid`, articleId: story.article_id, role });
    }
  }

  // DUPLICATE_ID
  const seen = new Set<string>();
  for (const { story, role } of tagged) {
    if (seen.has(story.article_id)) {
      violations.push({ code: "DUPLICATE_ID", message: "id used more than once across picks and backups", articleId: story.article_id, role });
    }
    seen.add(story.article_id);
  }

  // TOPIC_SPREAD
  const topics = new Set(sel.picks.map((p) => p.topic));
  if (topics.size < 3) {
    violations.push({ code: "TOPIC_SPREAD", message: `picks span ${topics.size} topic(s); need at least 3` });
  }

  // LAST_FOUR_HIT (picks and backups: a backup can be swapped in)
  for (const { story, role } of tagged) {
    const c = ctx.candidates.get(story.article_id);
    if (!c) continue;
    const hit = hitsLastFour(c, ctx.lastFour);
    if (hit) {
      violations.push({
        code: "LAST_FOUR_HIT",
        message: `repeats "${hit.headline.slice(0, 80)}" from the ${hit.issueDate} issue`,
        articleId: story.article_id,
        role,
      });
    }
  }

  // SAME_STORY_IN_PICKS (same cluster, or the dedupe rule says they are the same story)
  const picks = sel.picks.map((p) => ctx.candidates.get(p.article_id)).filter((c): c is CandidateInfo => Boolean(c));
  for (let i = 0; i < picks.length; i += 1) {
    for (let j = i + 1; j < picks.length; j += 1) {
      const a = picks[i] as CandidateInfo;
      const b = picks[j] as CandidateInfo;
      const sameCluster = a.clusterRoot === b.clusterRoot;
      const sim = similarityOfSets(trigrams(a.titleNorm), trigrams(b.titleNorm));
      if (sameCluster || judgePair(sim, a.entities, b.entities, ACTIVE_RULE).duplicate) {
        violations.push({
          code: "SAME_STORY_IN_PICKS",
          message: `same story as pick ${a.shortId}; keep only one`,
          articleId: b.shortId,
          role: "pick",
        });
      }
    }
  }

  // COMMENTARY_SHAPE and VOICE_LINT
  for (const { story, role } of tagged) {
    const sentences = splitSentences(story.commentary).length;
    const words = wordCount(story.commentary);
    if (sentences < MIN_SENTENCES || sentences > MAX_SENTENCES || words > MAX_WORDS) {
      violations.push({
        code: "COMMENTARY_SHAPE",
        message: `commentary has ${sentences} sentence(s) and ${words} words; needs ${MIN_SENTENCES}–${MAX_SENTENCES} sentences, ≤${MAX_WORDS} words`,
        articleId: story.article_id,
        role,
      });
    }
    const lint = voiceLint(story.commentary, ctx.neverSay);
    // Shape problems are already reported above; VOICE_LINT covers the rest.
    const voiceErrors = lint.errors.filter((e) => !e.startsWith("sentences:") && !e.startsWith("words:"));
    if (voiceErrors.length) {
      violations.push({ code: "VOICE_LINT", message: voiceErrors.join(", "), articleId: story.article_id, role });
    }
    if (lint.warnings.length) warnings[story.article_id] = lint.warnings;
  }

  return { ok: violations.length === 0, violations, warnings };
}
