// Shreya's per-story review actions (docs/05-INTEGRATIONS.md §3). Channel-agnostic:
// Telegram handlers call these; each runs in one transaction with the issue row
// locked, and any content change goes through the FSM's `edit` event so an
// edit after Confirm voids the confirmation in the same commit.
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { approvals, articles, issues, issueStories, styleExamples, styleGuides } from "@/db/schema";
import { applyTransition, canTransition, computeContentHash, type IssueStatus, type TransitionResult } from "@/lib/approval/fsm";
import { parseNeverSay, voiceLint } from "@/lib/curate/lint";
import { db, type Tx, withTransaction } from "@/lib/db";
import type { CardStory, DraftSummary, StoryState } from "@/lib/telegram/cards";

export type ReviewFailure = "not_found" | "ambiguous" | "issue_locked" | "not_a_live_pick" | "no_backups" | "empty_text";

export class ReviewError extends Error {
  constructor(
    readonly reason: ReviewFailure,
    message: string = reason,
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

const MIN_TOPICS = 3;
const PICKS_MIN = 8;
const MAX_EDIT_CHARS = 1500;

// ---------------------------------------------------------------- pure helpers

/** Normalised Levenshtein ratio (docs/04 §11): 1.0 = unchanged. */
export function editSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
    }
    prev = cur;
  }
  const distance = prev[b.length] as number;
  return Math.round((1 - distance / longest) * 1000) / 1000;
}

export interface BackupOption {
  id: string;
  topic: string;
  backupRank: number | null;
}

/**
 * docs/05 §3 Swap: take the next unused backup by rank, unless that would drop
 * the topic spread below 3 — then the best-ranked backup that keeps it. If none
 * can, take the next one anyway and report the spread problem.
 */
export function chooseBackup(remainingTopics: readonly string[], backups: readonly BackupOption[]): { backup: BackupOption; spreadOk: boolean } | null {
  const ordered = [...backups].sort((a, b) => (a.backupRank ?? 99) - (b.backupRank ?? 99));
  const first = ordered[0];
  if (!first) return null;
  const spreadWith = (b: BackupOption) => new Set([...remainingTopics, b.topic]).size;
  if (spreadWith(first) >= MIN_TOPICS) return { backup: first, spreadOk: true };
  const restoring = ordered.find((b) => spreadWith(b) >= MIN_TOPICS);
  return restoring ? { backup: restoring, spreadOk: true } : { backup: first, spreadOk: false };
}

export function draftWarnings(livePicks: number, topics: number): string[] {
  const w: string[] = [];
  if (livePicks < PICKS_MIN) w.push(`Only ${livePicks} valid ${livePicks === 1 ? "story" : "stories"}; the draft was not padded with weak ones.`);
  if (topics < MIN_TOPICS) w.push(`Picks span only ${topics} ${topics === 1 ? "topic" : "topics"} (the rule is at least ${MIN_TOPICS}).`);
  return w;
}

// ---------------------------------------------------------------- lookups

export interface ReviewStory extends CardStory {
  role: "pick" | "backup";
  articleId: string;
  backupRank: number | null;
  commentaryAi: string;
  edited: boolean;
}

export interface ReviewState {
  issue: { id: string; issueDate: string; status: IssueStatus; confirmedAt: Date | null; subject: string | null };
  /** Picks in position order, live first, swapped-out after. */
  picks: ReviewStory[];
  livePicks: ReviewStory[];
  unusedBackups: ReviewStory[];
  summary: DraftSummary;
}

type Exec = Pick<ReturnType<typeof db>, "select">;

async function loadStories(exec: Exec, issueId: string): Promise<ReviewStory[]> {
  const rows = await exec
    .select({
      id: issueStories.id,
      role: issueStories.role,
      position: issueStories.position,
      backupRank: issueStories.backupRank,
      topic: issueStories.topic,
      signalType: issueStories.signalType,
      headline: issueStories.headline,
      commentaryAi: issueStories.commentaryAi,
      commentary: issueStories.commentaryFinal,
      rationale: issueStories.rationale,
      flags: issueStories.flags,
      state: issueStories.state,
      edited: issueStories.edited,
      swappedFrom: issueStories.swappedFrom,
      articleId: issueStories.articleId,
      url: articles.url,
      publisher: articles.publisher,
    })
    .from(issueStories)
    .innerJoin(articles, eq(articles.id, issueStories.articleId))
    .where(eq(issueStories.issueId, issueId))
    .orderBy(asc(issueStories.position), asc(issueStories.backupRank), asc(issueStories.createdAt));
  return rows.map((r) => ({
    ...r,
    position: r.position ?? 0,
    flags: Array.isArray(r.flags) ? (r.flags as string[]) : [],
    replacedPosition: r.swappedFrom !== null,
  }));
}

export async function loadReview(issueId: string, exec: Exec = db()): Promise<ReviewState> {
  const [issue] = await exec
    .select({ id: issues.id, issueDate: issues.issueDate, status: issues.status, confirmedAt: issues.confirmedAt, subject: issues.subject })
    .from(issues)
    .where(eq(issues.id, issueId));
  if (!issue) throw new ReviewError("not_found", `issue ${issueId} not found`);
  const stories = await loadStories(exec, issueId);
  const picks = stories.filter((s) => s.role === "pick");
  const livePicks = picks.filter((s) => s.state !== "SWAPPED_OUT");
  const unusedBackups = stories.filter((s) => s.role === "backup" && s.state === "PENDING");
  const counts: Record<StoryState, number> = { PENDING: 0, KEPT: 0, EDITED: 0, SWAPPED_OUT: 0 };
  for (const p of picks) counts[p.state] += 1;
  const topics: Record<string, number> = {};
  for (const p of livePicks) topics[p.topic] = (topics[p.topic] ?? 0) + 1;
  return {
    issue,
    picks: [...livePicks, ...picks.filter((s) => s.state === "SWAPPED_OUT")],
    livePicks,
    unusedBackups,
    summary: {
      issueId,
      issueDate: issue.issueDate,
      status: issue.status,
      contentHash: await computeContentHash(issueId, exec),
      confirmedAt: issue.confirmedAt,
      counts,
      topics,
      backupsLeft: unusedBackups.length,
      warnings: draftWarnings(livePicks.length, Object.keys(topics).length),
    },
  };
}

const prefixOf = (id8: string) => {
  if (!/^[0-9a-f]{8}$/.test(id8)) throw new ReviewError("not_found", "malformed id");
  return `${id8}%`;
};

/** Finds the issue for an 8-char id prefix, rejecting ambiguity (docs/05 §3). */
export async function resolveIssue(issue8: string): Promise<string> {
  const rows = await db()
    .select({ id: issues.id })
    .from(issues)
    .where(sql`${issues.id}::text like ${prefixOf(issue8)}`)
    .limit(2);
  if (rows.length === 0) throw new ReviewError("not_found");
  if (rows.length > 1) throw new ReviewError("ambiguous");
  return (rows[0] as { id: string }).id;
}

/** Finds a story by 8-char prefix within one issue, rejecting ambiguity. */
export async function resolveStory(issueId: string, story8: string): Promise<string> {
  const rows = await db()
    .select({ id: issueStories.id })
    .from(issueStories)
    .where(and(eq(issueStories.issueId, issueId), sql`${issueStories.id}::text like ${prefixOf(story8)}`))
    .limit(2);
  if (rows.length === 0) throw new ReviewError("not_found");
  if (rows.length > 1) throw new ReviewError("ambiguous");
  return (rows[0] as { id: string }).id;
}

/** Banned phrases from the active style guide, for linting Shreya's edits. */
export async function lintEdit(text: string): Promise<string[]> {
  const [guide] = await db().select({ content: styleGuides.content }).from(styleGuides).where(eq(styleGuides.active, true));
  return voiceLint(text, guide ? parseNeverSay(guide.content) : []).errors;
}

// ---------------------------------------------------------------- actions

/** Locks the issue and refuses if its content can no longer change. */
async function lockReviewable(tx: Tx, issueId: string): Promise<IssueStatus> {
  const [issue] = await tx.select({ status: issues.status }).from(issues).where(eq(issues.id, issueId)).for("update");
  if (!issue) throw new ReviewError("not_found");
  if (!canTransition(issue.status, "edit")) throw new ReviewError("issue_locked", `issue is ${issue.status}`);
  return issue.status;
}

async function lockLivePick(tx: Tx, issueId: string, storyId: string) {
  const [story] = await tx
    .select()
    .from(issueStories)
    .where(and(eq(issueStories.id, storyId), eq(issueStories.issueId, issueId)))
    .for("update");
  if (!story) throw new ReviewError("not_found");
  if (story.role !== "pick" || story.state === "SWAPPED_OUT") throw new ReviewError("not_a_live_pick");
  return story;
}

export interface Actor {
  actorTgId: number;
}

export async function keepStory(issueId: string, storyId: string, { actorTgId }: Actor): Promise<{ changed: boolean }> {
  return withTransaction(async (tx) => {
    await lockReviewable(tx, issueId);
    const story = await lockLivePick(tx, issueId, storyId);
    if (story.state !== "PENDING") return { changed: false };
    await tx.update(issueStories).set({ state: "KEPT" }).where(eq(issueStories.id, storyId));
    await tx.insert(approvals).values({ issueId, storyId, action: "keep", actorTgId });
    return { changed: true };
  });
}

export async function approveAll(issueId: string, { actorTgId }: Actor): Promise<{ kept: string[] }> {
  return withTransaction(async (tx) => {
    await lockReviewable(tx, issueId);
    const kept = await tx
      .update(issueStories)
      .set({ state: "KEPT" })
      .where(and(eq(issueStories.issueId, issueId), eq(issueStories.role, "pick"), eq(issueStories.state, "PENDING")))
      .returning({ id: issueStories.id });
    if (kept.length) {
      await tx.insert(approvals).values({ issueId, action: "approve_all", actorTgId, detail: { count: kept.length } });
    }
    return { kept: kept.map((k) => k.id) };
  });
}

export async function editStory(
  issueId: string,
  storyId: string,
  newText: string,
  { actorTgId, lintOverride = [] }: Actor & { lintOverride?: readonly string[] },
): Promise<TransitionResult & { similarity: number }> {
  const text = newText.trim().replace(/\s+/g, " ");
  if (!text) throw new ReviewError("empty_text");
  if (text.length > MAX_EDIT_CHARS) throw new ReviewError("empty_text", "text too long");
  return withTransaction(async (tx) => {
    await lockReviewable(tx, issueId);
    const story = await lockLivePick(tx, issueId, storyId);
    const similarity = editSimilarity(story.commentaryAi, text);
    await tx.update(issueStories).set({ commentaryFinal: text, edited: true, state: "EDITED" }).where(eq(issueStories.id, storyId));
    await tx.insert(approvals).values({
      issueId,
      storyId,
      action: "edit",
      actorTgId,
      detail: { similarity, ...(lintOverride.length ? { lintOverride } : {}) },
    });
    // Few-shot memory (docs/04 §11): one row per edited story; a re-edit replaces it.
    await tx
      .delete(styleExamples)
      .where(and(eq(styleExamples.issueId, issueId), eq(styleExamples.articleTitle, story.headline), eq(styleExamples.aiText, story.commentaryAi)));
    if (similarity < 1) {
      await tx.insert(styleExamples).values({ issueId, articleTitle: story.headline, aiText: story.commentaryAi, finalText: text, similarity });
    }
    const t = await applyTransition(tx, issueId, "edit", { actorTgId });
    return { ...t, similarity };
  });
}

export interface SwapResult extends TransitionResult {
  oldId: string;
  replacementId: string;
  position: number;
  spreadOk: boolean;
}

/** Swap needs no AI call: the next backup takes the same position. */
export async function swapStory(issueId: string, storyId: string, { actorTgId }: Actor): Promise<SwapResult> {
  return withTransaction(async (tx) => {
    await lockReviewable(tx, issueId);
    const old = await lockLivePick(tx, issueId, storyId);
    const stories = await tx
      .select({ id: issueStories.id, role: issueStories.role, state: issueStories.state, topic: issueStories.topic, backupRank: issueStories.backupRank })
      .from(issueStories)
      .where(eq(issueStories.issueId, issueId))
      .for("update");
    const remainingTopics = stories.filter((s) => s.role === "pick" && s.state !== "SWAPPED_OUT" && s.id !== old.id).map((s) => s.topic);
    const backups = stories.filter((s) => s.role === "backup" && s.state === "PENDING");
    const choice = chooseBackup(remainingTopics, backups);
    if (!choice) throw new ReviewError("no_backups");

    // Order matters: free the position before the backup takes it (partial unique index).
    await tx.update(issueStories).set({ state: "SWAPPED_OUT" }).where(eq(issueStories.id, old.id));
    await tx
      .update(issueStories)
      .set({ role: "pick", position: old.position, swappedFrom: old.id, state: "PENDING" })
      .where(eq(issueStories.id, choice.backup.id));
    const [promoted] = await tx.select({ articleId: issueStories.articleId }).from(issueStories).where(eq(issueStories.id, choice.backup.id));
    await tx.update(articles).set({ status: "rejected" }).where(eq(articles.id, old.articleId));
    if (promoted) await tx.update(articles).set({ status: "selected" }).where(eq(articles.id, promoted.articleId));
    await tx.insert(approvals).values({
      issueId,
      storyId: old.id,
      action: "swap",
      actorTgId,
      detail: { replacementId: choice.backup.id, position: old.position, spreadOk: choice.spreadOk },
    });
    const t = await applyTransition(tx, issueId, "edit", { actorTgId });
    return { ...t, oldId: old.id, replacementId: choice.backup.id, position: old.position ?? 0, spreadOk: choice.spreadOk };
  });
}

/**
 * Confirm via the FSM (pending + stale-card guards), then record unedited
 * commentary as 1.0-similarity style examples (docs/04 §11).
 */
export async function confirmIssue(issueId: string, { actorTgId, cardHash }: Actor & { cardHash?: string }): Promise<TransitionResult> {
  return withTransaction(async (tx) => {
    const result = await applyTransition(tx, issueId, "confirm", { actorTgId, cardHash });
    await tx.delete(styleExamples).where(and(eq(styleExamples.issueId, issueId), gte(styleExamples.similarity, 1)));
    const live = await loadStories(tx, issueId);
    const unchanged = live.filter((s) => s.role === "pick" && s.state !== "SWAPPED_OUT" && s.commentary === s.commentaryAi);
    if (unchanged.length) {
      await tx.insert(styleExamples).values(
        unchanged.map((s) => ({ issueId, articleTitle: s.headline, aiText: s.commentaryAi, finalText: s.commentary, similarity: 1 })),
      );
    }
    return result;
  });
}

export async function holdIssue(issueId: string, { actorTgId }: Actor): Promise<TransitionResult> {
  return withTransaction((tx) => applyTransition(tx, issueId, "hold", { actorTgId }));
}
