import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { approvals, articles, issues, issueStories, styleExamples } from "@/db/schema";
import { assertSendAllowed, ConfirmRejectedError, computeContentHash, IllegalTransitionError, transition } from "@/lib/approval/fsm";
import {
  approveAll,
  confirmIssue,
  editStory,
  holdIssue,
  keepStory,
  loadReview,
  removeStory,
  ReviewError,
  resolveIssue,
  resolveStory,
  swapStory,
} from "@/lib/approval/review";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { id8 } from "@/lib/telegram/cards";
import { collectingIssueDate, issueWindow } from "@/lib/time";

// A disposable issue far in the future (distinct from the FSM test's).
const SHREYA = 515151;
const actor = { actorTgId: SHREYA };
const issueDate = collectingIssueDate(new Date("2097-06-01T06:00:00Z"));
let issueId = "";
const articleIds: string[] = [];
const ids: Record<string, string> = {};

// 8 picks over 3 topics (fintech ×6, ai_saas, funding_vc) + 3 backups.
const PICKS = ["fintech", "fintech", "fintech", "fintech", "fintech", "fintech", "ai_saas", "funding_vc"];
const BACKUPS = ["fintech", "ai_saas", "health_bio"];

const rejection = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection");
};

describe.skipIf(!process.env.DATABASE_URL)("review actions on Neon", () => {
  beforeAll(async () => {
    vi.stubEnv("SHREYA_TG_USER_ID", String(SHREYA));
    resetEnvCache();
    const { start, end } = issueWindow(issueDate);
    const [issue] = await db()
      .insert(issues)
      .values({ issueDate, slug: `test-${issueDate}`, status: "IN_REVIEW", windowStart: start, windowEnd: end, subject: "[TEST] review integration" })
      .returning({ id: issues.id });
    issueId = issue?.id ?? "";
    const add = async (key: string, role: "pick" | "backup", topic: string, rank: number) => {
      const url = `https://test.invalid/review/${randomUUID()}`;
      const [a] = await db()
        .insert(articles)
        .values({ issueId, url, canonicalUrl: url, canonicalHash: randomUUID(), title: `Story ${key}`, titleNorm: `story ${key}`, status: role === "pick" ? "selected" : "backup" })
        .returning({ id: articles.id });
      if (!a) throw new Error("article insert failed");
      articleIds.push(a.id);
      const [s] = await db()
        .insert(issueStories)
        .values({
          issueId,
          articleId: a.id,
          role,
          position: role === "pick" ? rank : null,
          backupRank: role === "backup" ? rank : null,
          topic,
          signalType: "trend_link",
          rationale: "Test rationale.",
          headline: `Story ${key}`,
          commentaryAi: `AI sentence for ${key}. Second sentence.`,
          commentaryFinal: `AI sentence for ${key}. Second sentence.`,
        })
        .returning({ id: issueStories.id });
      ids[key] = s?.id ?? "";
    };
    for (const [i, t] of PICKS.entries()) await add(`p${i + 1}`, "pick", t, i + 1);
    for (const [i, t] of BACKUPS.entries()) await add(`b${i + 1}`, "backup", t, i + 1);
  });

  afterAll(async () => {
    if (issueId) {
      await db().delete(styleExamples).where(eq(styleExamples.issueId, issueId));
      await db().delete(approvals).where(eq(approvals.issueId, issueId));
      await db().delete(issueStories).where(eq(issueStories.issueId, issueId));
      for (const id of articleIds) await db().delete(articles).where(eq(articles.id, id));
      await db().delete(issues).where(eq(issues.id, issueId));
    }
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  const story = async (key: string) => (await db().select().from(issueStories).where(eq(issueStories.id, ids[key] as string)))[0];

  it("resolves 8-char prefixes within the issue", async () => {
    expect(await resolveIssue(id8(issueId))).toBe(issueId);
    expect(await resolveStory(issueId, id8(ids.p1 as string))).toBe(ids.p1);
    expect(await rejection(resolveStory(issueId, "00000000"))).toBeInstanceOf(ReviewError);
  });

  it("Keep marks a story KEPT once, with an approval row", async () => {
    expect(await keepStory(issueId, ids.p1 as string, actor)).toEqual({ changed: true });
    expect(await keepStory(issueId, ids.p1 as string, actor)).toEqual({ changed: false });
    expect((await story("p1"))?.state).toBe("KEPT");
    const rows = await db().select().from(approvals).where(and(eq(approvals.issueId, issueId), eq(approvals.action, "keep")));
    expect(rows).toHaveLength(1);
  });

  it("Swap of the only ai_saas pick skips the fintech backup to keep 3 topics", async () => {
    const res = await swapStory(issueId, ids.p7 as string, actor);
    // b1 is fintech (would leave 2 topics), b2 is ai_saas: the best-ranked backup that restores the spread.
    expect(res).toMatchObject({ oldId: ids.p7, replacementId: ids.b2, position: 7, spreadOk: true, confirmationVoided: false });
    expect(await story("p7")).toMatchObject({ state: "SWAPPED_OUT" });
    expect(await story("b2")).toMatchObject({ role: "pick", position: 7, state: "PENDING", swappedFrom: ids.p7 });
    const review = await loadReview(issueId);
    expect(review.livePicks).toHaveLength(8);
    expect(Object.keys(review.summary.topics).sort()).toEqual(["ai_saas", "fintech", "funding_vc"]);
    expect(review.unusedBackups.map((b) => b.id).sort()).toEqual([ids.b1, ids.b3].sort());
    const [old] = await db().select({ s: articles.status }).from(articles).innerJoin(issueStories, eq(issueStories.articleId, articles.id)).where(eq(issueStories.id, ids.p7 as string));
    expect(old?.s).toBe("rejected");
  });

  it("a swapped-out story can't be acted on", async () => {
    const err = await rejection(keepStory(issueId, ids.p7 as string, actor));
    expect((err as ReviewError).reason).toBe("not_a_live_pick");
  });

  it("Edit saves the text, marks it EDITED and stores a style example", async () => {
    const res = await editStory(issueId, ids.p2 as string, "Shreya's own first line. And her second.", actor);
    expect(res.similarity).toBeLessThan(1);
    expect(await story("p2")).toMatchObject({ state: "EDITED", edited: true, commentaryFinal: "Shreya's own first line. And her second." });
    const ex = await db().select().from(styleExamples).where(eq(styleExamples.issueId, issueId));
    expect(ex).toHaveLength(1);
    // A second edit of the same story replaces the example rather than adding one.
    await editStory(issueId, ids.p2 as string, "Shreya's own first line. And a better second.", actor);
    expect(await db().select().from(styleExamples).where(eq(styleExamples.issueId, issueId))).toHaveLength(1);
  });

  it("Confirm is refused while stories are pending", async () => {
    const err = await rejection(confirmIssue(issueId, actor));
    expect(err).toBeInstanceOf(ConfirmRejectedError);
    expect((err as ConfirmRejectedError).failures).toContain("stories_pending");
  });

  it("Approve all keeps every pending pick", async () => {
    const { kept } = await approveAll(issueId, actor);
    expect(kept.length).toBe(6); // p3–p6, p8 and the promoted b2
    expect((await loadReview(issueId)).summary.counts.PENDING).toBe(0);
  });

  it("Confirm refuses a stale card, then confirms with the fresh hash and records unedited commentary", async () => {
    const stale = await rejection(confirmIssue(issueId, { ...actor, cardHash: "00000000" }));
    expect((stale as ConfirmRejectedError).failures).toEqual(["stale_card"]);
    const hash = await computeContentHash(issueId);
    const res = await confirmIssue(issueId, { ...actor, cardHash: hash.slice(0, 8) });
    expect(res).toMatchObject({ to: "CONFIRMED", contentHash: hash });
    await expect(assertSendAllowed(issueId)).resolves.toBeUndefined();
    const ex = await db().select().from(styleExamples).where(eq(styleExamples.issueId, issueId));
    expect(ex.filter((e) => e.similarity === 1)).toHaveLength(7); // 8 live picks minus the edited one
  });

  it("an edit after Confirm resets to IN_REVIEW and the gate blocks sending", async () => {
    const res = await editStory(issueId, ids.p3 as string, "A late change. Still two sentences.", actor);
    expect(res).toMatchObject({ from: "CONFIRMED", to: "IN_REVIEW", confirmationVoided: true });
    const [issue] = await db().select().from(issues).where(eq(issues.id, issueId));
    expect(issue).toMatchObject({ status: "IN_REVIEW", contentHash: null, confirmedAt: null });
    expect(await rejection(assertSendAllowed(issueId))).toBeTruthy();
  });

  it("a swap after re-confirming also voids the confirmation", async () => {
    await confirmIssue(issueId, actor);
    const res = await swapStory(issueId, ids.p4 as string, actor);
    expect(res).toMatchObject({ replacementId: ids.b1, confirmationVoided: true, to: "IN_REVIEW" });
  });

  it("Remove is refused at 8 stories, then works at 9 and renumbers the rest", async () => {
    expect(((await rejection(removeStory(issueId, ids.p5 as string, actor))) as ReviewError).reason).toBe("too_few_stories");
    // Add a ninth pick so a removal is allowed.
    const [a] = await db()
      .insert(articles)
      .values({ issueId, url: `https://test.invalid/review/${randomUUID()}`, canonicalUrl: "x", canonicalHash: randomUUID(), title: "Story p9", titleNorm: "story p9", status: "selected" })
      .returning({ id: articles.id });
    articleIds.push(a?.id as string);
    const [s9] = await db()
      .insert(issueStories)
      .values({ issueId, articleId: a?.id as string, role: "pick", position: 9, topic: "ai_saas", signalType: "trend_link", rationale: "r", headline: "Story p9", commentaryAi: "A. B.", commentaryFinal: "A. B." })
      .returning({ id: issueStories.id });
    const res = await removeStory(issueId, ids.p5 as string, actor);
    expect(res.position).toBe(5);
    const review = await loadReview(issueId);
    expect(review.livePicks.map((p) => p.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(review.livePicks.find((p) => p.id === s9?.id)?.position).toBe(8);
    expect(review.picks.find((p) => p.id === ids.p5)).toMatchObject({ state: "SWAPPED_OUT", removed: true });
    const rows = await db().select().from(approvals).where(and(eq(approvals.issueId, issueId), eq(approvals.action, "remove")));
    expect(rows).toHaveLength(1);
  });

  it("Hold stops the issue; holding twice is refused; a sent issue can't be reviewed", async () => {
    expect(await holdIssue(issueId, actor)).toMatchObject({ to: "HELD" });
    expect(await rejection(holdIssue(issueId, actor))).toBeInstanceOf(IllegalTransitionError);
    await db().update(issues).set({ status: "SENT" }).where(eq(issues.id, issueId));
    expect(((await rejection(keepStory(issueId, ids.b1 as string, actor))) as ReviewError).reason).toBe("issue_locked");
    expect(await rejection(transition(issueId, "confirm", actor))).toBeInstanceOf(IllegalTransitionError);
  });
});
