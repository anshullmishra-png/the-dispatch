// Issue state machine and the send gate (docs/02-ARCHITECTURE.md §6).
// Pure rules first (unit-tested); DB functions below apply them atomically.
import { createHash } from "node:crypto";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { approvals, articles, issues, issueStories } from "@/db/schema";
import { db, type Tx, withTransaction } from "@/lib/db";
import { requireEnv } from "@/lib/env";

export type IssueStatus = "COLLECTING" | "DRAFTING" | "IN_REVIEW" | "CONFIRMED" | "SENDING" | "SENT" | "HELD";
export type IssueEvent = "curate" | "notify" | "confirm" | "edit" | "hold" | "start_send" | "finish_send";

/**
 * Legal transitions. `edit` (any content change) is a self-loop except on a
 * confirmed issue, where it falls back to IN_REVIEW and voids the confirmation.
 */
export const TRANSITIONS: Record<IssueEvent, Partial<Record<IssueStatus, IssueStatus>>> = {
  curate: { COLLECTING: "DRAFTING", DRAFTING: "DRAFTING", IN_REVIEW: "DRAFTING", HELD: "DRAFTING" },
  notify: { DRAFTING: "IN_REVIEW" },
  confirm: { IN_REVIEW: "CONFIRMED", HELD: "CONFIRMED" },
  edit: { DRAFTING: "DRAFTING", IN_REVIEW: "IN_REVIEW", HELD: "HELD", CONFIRMED: "IN_REVIEW" },
  hold: { DRAFTING: "HELD", IN_REVIEW: "HELD", CONFIRMED: "HELD" },
  start_send: { CONFIRMED: "SENDING" },
  finish_send: { SENDING: "SENT" },
};

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: IssueStatus,
    readonly event: IssueEvent,
  ) {
    super(`illegal transition: ${event} from ${from}`);
    this.name = "IllegalTransitionError";
  }
}

export function nextStatus(current: IssueStatus, event: IssueEvent): IssueStatus {
  const to = TRANSITIONS[event][current];
  if (!to) throw new IllegalTransitionError(current, event);
  return to;
}

export function canTransition(current: IssueStatus, event: IssueEvent): boolean {
  return TRANSITIONS[event][current] !== undefined;
}

// ---------------------------------------------------------------- content hash

export interface HashableStory {
  position: number;
  headline: string;
  url: string;
  commentaryFinal: string;
}

/** SHA-256 of canonical JSON {subject, stories:[{position, headline, url, commentary_final}]} in position order. */
export function hashContent(content: { subject: string | null; stories: readonly HashableStory[] }): string {
  const canonical = {
    subject: content.subject ?? "",
    stories: [...content.stories]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ position: s.position, headline: s.headline, url: s.url, commentary_final: s.commentaryFinal })),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

// ---------------------------------------------------------------- pure guards

export type ConfirmFailure = "illegal_status" | "wrong_user" | "stories_pending" | "stale_card";

export function checkConfirm(input: {
  status: IssueStatus;
  actorTgId: number | null;
  shreyaTgId: number;
  pendingPicks: number;
  freshHash: string;
  /** Hash (or its 8-char prefix) carried by the Confirm button; omit for a non-card confirm. */
  cardHash?: string;
}): ConfirmFailure[] {
  const failures: ConfirmFailure[] = [];
  if (!canTransition(input.status, "confirm")) failures.push("illegal_status");
  if (input.actorTgId !== input.shreyaTgId) failures.push("wrong_user");
  if (input.pendingPicks > 0) failures.push("stories_pending");
  if (input.cardHash !== undefined && !input.freshHash.startsWith(input.cardHash)) failures.push("stale_card");
  return failures;
}

export type SendFailure =
  | "status_not_confirmed"
  | "wrong_confirmer"
  | "not_confirmed"
  | "hash_changed"
  | "no_confirm_approval"
  | "already_sent";

/** The six conditions of assertSendAllowed (docs/02 §6). All must hold. */
export function checkSendAllowed(input: {
  status: IssueStatus;
  confirmedBy: number | null;
  confirmedAt: Date | null;
  storedHash: string | null;
  freshHash: string;
  confirmApprovalHashes: readonly string[];
  sentAt: Date | null;
  shreyaTgId: number;
}): SendFailure[] {
  const failures: SendFailure[] = [];
  if (input.status !== "CONFIRMED") failures.push("status_not_confirmed");
  if (input.confirmedBy !== input.shreyaTgId) failures.push("wrong_confirmer");
  if (input.confirmedAt === null) failures.push("not_confirmed");
  if (input.storedHash === null || input.storedHash !== input.freshHash) failures.push("hash_changed");
  if (input.storedHash === null || !input.confirmApprovalHashes.includes(input.storedHash)) failures.push("no_confirm_approval");
  if (input.status === "SENT" || input.sentAt !== null) failures.push("already_sent");
  return failures;
}

export interface DraftShape {
  livePicks: number;
  topics: number;
  needsAttention: boolean;
}

/** notify guard: a valid draft, or one curate explicitly flagged for Shreya's attention. */
export function draftDeliverable(d: DraftShape): boolean {
  if (d.livePicks === 0) return false;
  const valid = d.livePicks >= 8 && d.livePicks <= 10 && d.topics >= 3;
  return valid || d.needsAttention;
}

// ---------------------------------------------------------------- DB layer

export class SendNotAllowedError extends Error {
  constructor(readonly failures: SendFailure[]) {
    super(`send not allowed: ${failures.join(", ")}`);
    this.name = "SendNotAllowedError";
  }
}

export class ConfirmRejectedError extends Error {
  constructor(readonly failures: ConfirmFailure[]) {
    super(`confirm rejected: ${failures.join(", ")}`);
    this.name = "ConfirmRejectedError";
  }
}

export class DraftNotDeliverableError extends Error {
  constructor(readonly shape: DraftShape) {
    super(`draft not deliverable: ${shape.livePicks} picks, ${shape.topics} topics`);
    this.name = "DraftNotDeliverableError";
  }
}

type Executor = Pick<ReturnType<typeof db>, "select">;

/** Live picks (not swapped out) with the article URL, for hashing and checks. */
async function loadLivePicks(exec: Executor, issueId: string) {
  return exec
    .select({
      position: issueStories.position,
      headline: issueStories.headline,
      commentaryFinal: issueStories.commentaryFinal,
      state: issueStories.state,
      topic: issueStories.topic,
      url: articles.url,
    })
    .from(issueStories)
    .innerJoin(articles, eq(articles.id, issueStories.articleId))
    .where(and(eq(issueStories.issueId, issueId), eq(issueStories.role, "pick"), ne(issueStories.state, "SWAPPED_OUT")))
    .orderBy(asc(issueStories.position));
}

export async function computeContentHash(issueId: string, exec: Executor = db()): Promise<string> {
  const [issue] = await exec.select({ subject: issues.subject }).from(issues).where(eq(issues.id, issueId));
  if (!issue) throw new Error(`issue ${issueId} not found`);
  const picks = await loadLivePicks(exec, issueId);
  return hashContent({
    subject: issue.subject,
    stories: picks.map((p) => ({ position: p.position ?? 0, headline: p.headline, url: p.url, commentaryFinal: p.commentaryFinal })),
  });
}

function shreyaId(): number {
  return Number(requireEnv("SHREYA_TG_USER_ID").SHREYA_TG_USER_ID);
}

/**
 * Throws SendNotAllowedError unless every guard passes. The first line of
 * sendIssue(); fails closed if SHREYA_TG_USER_ID is not configured.
 */
export async function assertSendAllowed(issueId: string): Promise<void> {
  const shreya = shreyaId();
  const [issue] = await db()
    .select({
      status: issues.status,
      confirmedBy: issues.confirmedBy,
      confirmedAt: issues.confirmedAt,
      contentHash: issues.contentHash,
      sentAt: issues.sentAt,
    })
    .from(issues)
    .where(eq(issues.id, issueId));
  if (!issue) throw new SendNotAllowedError(["status_not_confirmed"]);
  const confirms = await db()
    .select({ hash: approvals.contentHash })
    .from(approvals)
    .where(and(eq(approvals.issueId, issueId), eq(approvals.action, "confirm")));
  const failures = checkSendAllowed({
    status: issue.status,
    confirmedBy: issue.confirmedBy,
    confirmedAt: issue.confirmedAt,
    storedHash: issue.contentHash,
    freshHash: await computeContentHash(issueId),
    confirmApprovalHashes: confirms.map((c) => c.hash).filter((h): h is string => h !== null),
    sentAt: issue.sentAt,
    shreyaTgId: shreya,
  });
  if (failures.length) throw new SendNotAllowedError(failures);
}

export interface TransitionOptions {
  actorTgId?: number | null;
  cardHash?: string;
  detail?: Record<string, unknown>;
}

export interface TransitionResult {
  from: IssueStatus;
  to: IssueStatus;
  contentHash?: string;
  /** True when an edit voided a confirmation. */
  confirmationVoided?: boolean;
}

/** Shape of the live draft, for the notify guard. */
export async function loadDraftShape(issueId: string, exec: Executor = db()): Promise<DraftShape> {
  const [issue] = await exec.select({ needsAttention: issues.needsAttention }).from(issues).where(eq(issues.id, issueId));
  const picks = await loadLivePicks(exec, issueId);
  return { livePicks: picks.length, topics: new Set(picks.map((p) => p.topic)).size, needsAttention: issue?.needsAttention ?? false };
}

/**
 * Applies `event` to the issue inside a transaction with the row locked:
 * checks the transition and its guards, updates the issue, and writes the
 * approvals audit row. The only code path that changes `issues.status`
 * after drafting (curate's own move to DRAFTING goes through nextStatus too).
 */
export async function transition(issueId: string, event: IssueEvent, opts: TransitionOptions = {}): Promise<TransitionResult> {
  return withTransaction((tx) => applyTransition(tx, issueId, event, opts));
}

/**
 * transition() inside the caller's transaction, so a content change and the
 * status change it causes (an edit after confirm) commit together.
 */
export async function applyTransition(tx: Tx, issueId: string, event: IssueEvent, opts: TransitionOptions = {}): Promise<TransitionResult> {
  const [issue] = await tx
    .select({ status: issues.status })
    .from(issues)
    .where(eq(issues.id, issueId))
    .for("update");
  if (!issue) throw new Error(`issue ${issueId} not found`);
  const from = issue.status;
  const to = nextStatus(from, event);
  const audit = (action: (typeof approvals.$inferInsert)["action"], contentHash: string | null = null) =>
    tx.insert(approvals).values({ issueId, action, actorTgId: opts.actorTgId ?? null, contentHash, detail: opts.detail ?? null });

  if (event === "notify") {
    const shape = await loadDraftShape(issueId, tx);
    if (!draftDeliverable(shape)) throw new DraftNotDeliverableError(shape);
    await tx.update(issues).set({ status: to, updatedAt: sql`now()` }).where(eq(issues.id, issueId));
    return { from, to };
  }

  if (event === "confirm") {
    const picks = await loadLivePicks(tx, issueId);
    const freshHash = await computeContentHash(issueId, tx);
    const failures = checkConfirm({
      status: from,
      actorTgId: opts.actorTgId ?? null,
      shreyaTgId: shreyaId(),
      pendingPicks: picks.filter((p) => p.state === "PENDING").length,
      freshHash,
      cardHash: opts.cardHash,
    });
    if (failures.length) throw new ConfirmRejectedError(failures);
    await tx
      .update(issues)
      .set({ status: to, contentHash: freshHash, confirmedAt: sql`now()`, confirmedBy: opts.actorTgId ?? null, updatedAt: sql`now()` })
      .where(eq(issues.id, issueId));
    await audit("confirm", freshHash);
    return { from, to, contentHash: freshHash };
  }

  if (event === "edit") {
    if (from === "CONFIRMED") {
      await tx
        .update(issues)
        .set({ status: to, contentHash: null, confirmedAt: null, confirmedBy: null, updatedAt: sql`now()` })
        .where(eq(issues.id, issueId));
      await audit("reset_by_edit");
      return { from, to, confirmationVoided: true };
    }
    return { from, to, confirmationVoided: false };
  }

  if (event === "hold") {
    await tx.update(issues).set({ status: to, updatedAt: sql`now()` }).where(eq(issues.id, issueId));
    await audit("hold");
    return { from, to };
  }

  if (event === "finish_send") {
    await tx.update(issues).set({ status: to, sentAt: sql`now()`, updatedAt: sql`now()` }).where(eq(issues.id, issueId));
    return { from, to };
  }

  // curate, start_send: status only (start_send is preceded by assertSendAllowed in sendIssue).
  await tx.update(issues).set({ status: to, updatedAt: sql`now()` }).where(eq(issues.id, issueId));
  return { from, to };
}
