import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { approvals, articles, issues, issueStories } from "@/db/schema";
import {
  assertSendAllowed,
  ConfirmRejectedError,
  computeContentHash,
  IllegalTransitionError,
  SendNotAllowedError,
  transition,
} from "@/lib/approval/fsm";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { SendNotImplementedError, sendIssue } from "@/lib/mail/send";
import { collectingIssueDate, issueWindow } from "@/lib/time";

// A disposable issue far in the future, so it can never collide with real data.
const SHREYA = 424242;
const issueDate = collectingIssueDate(new Date("2098-12-28T06:00:00Z"));
let issueId = "";
const articleIds: string[] = [];

const rejection = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection");
};

describe.skipIf(!process.env.DATABASE_URL)("state machine and send gate on Neon", () => {
  beforeAll(async () => {
    vi.stubEnv("SHREYA_TG_USER_ID", String(SHREYA));
    resetEnvCache();
    const { start, end } = issueWindow(issueDate);
    const [issue] = await db()
      .insert(issues)
      .values({ issueDate, slug: `test-${issueDate}`, status: "DRAFTING", windowStart: start, windowEnd: end, subject: "[TEST] FSM integration" })
      .returning({ id: issues.id });
    issueId = issue?.id ?? "";
    const topics = ["fintech", "ai_saas", "funding_vc"];
    for (let i = 1; i <= 8; i += 1) {
      const url = `https://test.invalid/fsm/${randomUUID()}`;
      const [a] = await db()
        .insert(articles)
        .values({ issueId, url, canonicalUrl: url, canonicalHash: randomUUID(), title: `Test story ${i}`, titleNorm: `test story ${i}`, status: "selected" })
        .returning({ id: articles.id });
      if (!a) throw new Error("article insert failed");
      articleIds.push(a.id);
      await db().insert(issueStories).values({
        issueId,
        articleId: a.id,
        role: "pick",
        position: i,
        topic: topics[i % 3] as string,
        signalType: "trend_link",
        rationale: "Test rationale.",
        headline: `Test story ${i}`,
        commentaryAi: "First sentence. Second sentence.",
        commentaryFinal: "First sentence. Second sentence.",
      });
    }
  });

  afterAll(async () => {
    if (issueId) {
      await db().delete(issueStories).where(eq(issueStories.issueId, issueId));
      for (const id of articleIds) await db().delete(articles).where(eq(articles.id, id));
      await db().delete(issues).where(eq(issues.id, issueId));
    }
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  const status = async () => (await db().select({ s: issues.status }).from(issues).where(eq(issues.id, issueId)))[0]?.s;
  const keepAll = () => db().update(issueStories).set({ state: "KEPT" }).where(eq(issueStories.issueId, issueId));

  it("notify moves a valid draft to IN_REVIEW", async () => {
    expect(await transition(issueId, "notify")).toMatchObject({ from: "DRAFTING", to: "IN_REVIEW" });
  });

  it("refuses Confirm from anyone but Shreya", async () => {
    const err = await rejection(transition(issueId, "confirm", { actorTgId: 7 }));
    expect(err).toBeInstanceOf(ConfirmRejectedError);
    expect((err as ConfirmRejectedError).failures).toContain("wrong_user");
  });

  it("refuses Confirm while a story is still pending", async () => {
    const err = await rejection(transition(issueId, "confirm", { actorTgId: SHREYA }));
    expect((err as ConfirmRejectedError).failures).toContain("stories_pending");
  });

  it("refuses Confirm from a stale card", async () => {
    await keepAll();
    const err = await rejection(transition(issueId, "confirm", { actorTgId: SHREYA, cardHash: "deadbeef" }));
    expect((err as ConfirmRejectedError).failures).toEqual(["stale_card"]);
    expect(await status()).toBe("IN_REVIEW");
  });

  it("confirms with the current card hash, storing the hash and an approval", async () => {
    const hash = await computeContentHash(issueId);
    const res = await transition(issueId, "confirm", { actorTgId: SHREYA, cardHash: hash.slice(0, 8) });
    expect(res).toMatchObject({ to: "CONFIRMED", contentHash: hash });
    const rows = await db().select().from(approvals).where(and(eq(approvals.issueId, issueId), eq(approvals.action, "confirm")));
    expect(rows.map((r) => r.contentHash)).toContain(hash);
  });

  it("the gate passes, and sendIssue gets past it", async () => {
    await expect(assertSendAllowed(issueId)).resolves.toBeUndefined();
    await expect(sendIssue(issueId)).rejects.toBeInstanceOf(SendNotImplementedError);
  });

  it("editing after confirm resets to IN_REVIEW and the gate blocks sending", async () => {
    await db()
      .update(issueStories)
      .set({ commentaryFinal: "Edited sentence. Second sentence." })
      .where(and(eq(issueStories.issueId, issueId), eq(issueStories.position, 1)));
    expect(await transition(issueId, "edit", { actorTgId: SHREYA })).toMatchObject({ from: "CONFIRMED", to: "IN_REVIEW", confirmationVoided: true });
    const [issue] = await db().select().from(issues).where(eq(issues.id, issueId));
    expect(issue).toMatchObject({ status: "IN_REVIEW", contentHash: null, confirmedAt: null });
    const resets = await db().select().from(approvals).where(and(eq(approvals.issueId, issueId), eq(approvals.action, "reset_by_edit")));
    expect(resets).toHaveLength(1);
    const err = await rejection(sendIssue(issueId));
    expect(err).toBeInstanceOf(SendNotAllowedError);
    expect((err as SendNotAllowedError).failures).toContain("status_not_confirmed");
  });

  it("a change slipped in without the review flow is caught by the hash", async () => {
    await transition(issueId, "confirm", { actorTgId: SHREYA });
    await db()
      .update(issueStories)
      .set({ commentaryFinal: "Sneaky change. Second sentence." })
      .where(and(eq(issueStories.issueId, issueId), eq(issueStories.position, 2)));
    const err = await rejection(assertSendAllowed(issueId));
    expect((err as SendNotAllowedError).failures).toEqual(["hash_changed"]);
  });

  it("hold stops everything: no sending from HELD", async () => {
    expect(await transition(issueId, "hold", { actorTgId: SHREYA })).toMatchObject({ to: "HELD" });
    expect(await rejection(transition(issueId, "start_send"))).toBeInstanceOf(IllegalTransitionError);
    expect((await rejection(assertSendAllowed(issueId)) as SendNotAllowedError).failures).toContain("status_not_confirmed");
  });

  it("the gate fails closed when Shreya's id is not configured", async () => {
    vi.stubEnv("SHREYA_TG_USER_ID", "");
    resetEnvCache();
    await expect(assertSendAllowed(issueId)).rejects.toThrow(/SHREYA_TG_USER_ID/);
    vi.stubEnv("SHREYA_TG_USER_ID", String(SHREYA));
    resetEnvCache();
  });
});
