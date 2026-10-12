import { and, count, eq, inArray, sql } from "drizzle-orm";
import { approvals, articles, type Issue, issues, issueStories } from "@/db/schema";
import { canTransition, nextStatus } from "@/lib/approval/fsm";
import { withTransaction } from "@/lib/db";
import { formatIssueDateShort } from "@/lib/time";
import type { SelectedStory, SelectionResult } from "./select";

/** Statuses where curate may not replace the draft (derived from the state machine). */
export const LOCKED_STATUSES = (["COLLECTING", "DRAFTING", "IN_REVIEW", "CONFIRMED", "SENDING", "SENT", "HELD"] as const).filter(
  (s) => !canTransition(s, "curate"),
);

export class DraftExistsError extends Error {
  constructor() {
    super("a draft already exists for this issue; re-run with force to replace it");
    this.name = "DraftExistsError";
  }
}

export class DraftLockedError extends Error {
  constructor(status: string) {
    super(`issue is ${status}; its draft is locked`);
    this.name = "DraftLockedError";
  }
}

export function draftSubject(issueDate: string, topHeadline: string): string {
  const head = topHeadline.length > 55 ? `${topHeadline.slice(0, 54).trimEnd()}…` : topHeadline;
  return `The Dispatch · ${formatIssueDateShort(issueDate)} · ${head}`;
}

const toRow = (issueId: string, s: SelectedStory) => ({
  issueId,
  articleId: s.articleId,
  role: s.role,
  position: s.position,
  backupRank: s.backupRank,
  topic: s.topic,
  signalType: s.signalType,
  rationale: s.rationale,
  headline: s.headline,
  commentaryAi: s.commentary,
  commentaryFinal: s.commentary,
  state: "PENDING" as const,
  flags: s.flags,
});

/** Writes picks + backups, marks their articles, and moves the issue to DRAFTING. */
export async function persistDraft(issue: Issue, result: SelectionResult, opts: { force: boolean }): Promise<{ replaced: boolean }> {
  return withTransaction(async (tx) => {
    const [current] = await tx.select({ status: issues.status }).from(issues).where(eq(issues.id, issue.id)).for("update");
    if (!current) throw new Error(`issue ${issue.id} not found`);
    if (!canTransition(current.status, "curate")) throw new DraftLockedError(current.status);

    const [existing] = await tx.select({ n: count() }).from(issueStories).where(eq(issueStories.issueId, issue.id));
    const replaced = (existing?.n ?? 0) > 0;
    if (replaced && !opts.force) throw new DraftExistsError();
    if (replaced) {
      await tx.update(approvals).set({ storyId: null }).where(eq(approvals.issueId, issue.id));
      await tx
        .update(articles)
        .set({ status: sql`(case when ${articles.duplicateOf} is null then 'candidate' else 'duplicate' end)::article_status` })
        .where(and(eq(articles.issueId, issue.id), inArray(articles.status, ["selected", "backup"])));
      await tx.delete(issueStories).where(eq(issueStories.issueId, issue.id));
    }

    const stories = [...result.picks, ...result.backups];
    await tx.insert(issueStories).values(stories.map((s) => toRow(issue.id, s)));
    const pickIds = result.picks.map((s) => s.articleId);
    const backupIds = result.backups.map((s) => s.articleId);
    if (pickIds.length) await tx.update(articles).set({ status: "selected" }).where(inArray(articles.id, pickIds));
    if (backupIds.length) await tx.update(articles).set({ status: "backup" }).where(inArray(articles.id, backupIds));

    await tx
      .update(issues)
      .set({
        status: nextStatus(current.status, "curate"),
        needsAttention: result.needsAttention,
        subject: draftSubject(issue.issueDate, result.picks[0]?.headline ?? ""),
        contentHash: null,
        confirmedAt: null,
        confirmedBy: null,
        updatedAt: sql`now()`,
      })
      .where(eq(issues.id, issue.id));
    return { replaced };
  });
}
