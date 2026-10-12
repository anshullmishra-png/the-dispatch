import { describe, expect, it } from "vitest";
import {
  canTransition,
  checkConfirm,
  checkSendAllowed,
  draftDeliverable,
  hashContent,
  IllegalTransitionError,
  type IssueEvent,
  type IssueStatus,
  nextStatus,
  TRANSITIONS,
} from "@/lib/approval/fsm";
import { LOCKED_STATUSES } from "@/lib/curate/draft";

const STATUSES: IssueStatus[] = ["COLLECTING", "DRAFTING", "IN_REVIEW", "CONFIRMED", "SENDING", "SENT", "HELD"];
const EVENTS: IssueEvent[] = ["curate", "notify", "confirm", "edit", "hold", "start_send", "finish_send"];

// The legal moves from docs/02-ARCHITECTURE.md §6, written out independently of the code.
const LEGAL: [IssueStatus, IssueEvent, IssueStatus][] = [
  ["COLLECTING", "curate", "DRAFTING"],
  ["DRAFTING", "curate", "DRAFTING"],
  ["IN_REVIEW", "curate", "DRAFTING"],
  ["HELD", "curate", "DRAFTING"],
  ["DRAFTING", "notify", "IN_REVIEW"],
  ["IN_REVIEW", "confirm", "CONFIRMED"],
  ["HELD", "confirm", "CONFIRMED"],
  ["DRAFTING", "edit", "DRAFTING"],
  ["IN_REVIEW", "edit", "IN_REVIEW"],
  ["HELD", "edit", "HELD"],
  ["CONFIRMED", "edit", "IN_REVIEW"],
  ["DRAFTING", "hold", "HELD"],
  ["IN_REVIEW", "hold", "HELD"],
  ["CONFIRMED", "hold", "HELD"],
  ["CONFIRMED", "start_send", "SENDING"],
  ["SENDING", "finish_send", "SENT"],
];

describe("nextStatus", () => {
  it.each(LEGAL)("%s --%s--> %s", (from, event, to) => {
    expect(nextStatus(from, event)).toBe(to);
  });

  it("every other status/event combination throws", () => {
    const legal = new Set(LEGAL.map(([f, e]) => `${f}:${e}`));
    let illegal = 0;
    for (const s of STATUSES) {
      for (const e of EVENTS) {
        if (legal.has(`${s}:${e}`)) continue;
        illegal += 1;
        expect(() => nextStatus(s, e)).toThrow(IllegalTransitionError);
        expect(canTransition(s, e)).toBe(false);
      }
    }
    expect(illegal).toBe(STATUSES.length * EVENTS.length - LEGAL.length);
  });

  it("the code's table matches the documented one exactly", () => {
    const fromCode = Object.entries(TRANSITIONS).flatMap(([e, m]) => Object.entries(m).map(([f, t]) => `${f}:${e}:${t}`));
    expect(fromCode.sort()).toEqual(LEGAL.map(([f, e, t]) => `${f}:${e}:${t}`).sort());
  });

  it("an edit after confirming resets the issue to IN_REVIEW", () => {
    expect(nextStatus("CONFIRMED", "edit")).toBe("IN_REVIEW");
  });

  it("nothing can leave SENT, and a sent issue cannot be re-sent", () => {
    for (const e of EVENTS) expect(canTransition("SENT", e)).toBe(false);
  });

  it("only a confirmed issue can start sending", () => {
    for (const s of STATUSES) expect(canTransition(s, "start_send")).toBe(s === "CONFIRMED");
  });

  it("curate cannot overwrite a confirmed, sending or sent issue", () => {
    expect([...LOCKED_STATUSES].sort()).toEqual(["CONFIRMED", "SENDING", "SENT"]);
  });
});

describe("hashContent", () => {
  const stories = [
    { position: 2, headline: "B", url: "https://x.in/b", commentaryFinal: "Second." },
    { position: 1, headline: "A", url: "https://x.in/a", commentaryFinal: "First." },
  ];
  const base = { subject: "The Dispatch · Thu 15 Oct · A", stories };

  it("is a stable sha256 independent of input order", () => {
    const h = hashContent(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashContent({ ...base, stories: [...stories].reverse() })).toBe(h);
  });

  it.each([
    ["subject", { ...base, subject: "Other" }],
    ["commentary", { ...base, stories: [stories[0], { ...stories[1], commentaryFinal: "First!" }] }],
    ["headline", { ...base, stories: [stories[0], { ...stories[1], headline: "A2" }] }],
    ["url", { ...base, stories: [stories[0], { ...stories[1], url: "https://x.in/a2" }] }],
    ["order", { ...base, stories: [{ ...stories[0], position: 1 }, { ...stories[1], position: 2 }] }],
  ] as const)("changes when the %s changes", (_what, changed) => {
    expect(hashContent(changed as Parameters<typeof hashContent>[0])).not.toBe(hashContent(base));
  });
});

describe("checkConfirm", () => {
  const ok = { status: "IN_REVIEW" as const, actorTgId: 42, shreyaTgId: 42, pendingPicks: 0, freshHash: "abcdef1234" };

  it("passes for Shreya on a fully reviewed draft", () => {
    expect(checkConfirm(ok)).toEqual([]);
    expect(checkConfirm({ ...ok, cardHash: "abcdef12" })).toEqual([]);
  });

  it.each([
    ["wrong user", { actorTgId: 7 }, "wrong_user"],
    ["a pick still pending", { pendingPicks: 1 }, "stories_pending"],
    ["a stale card", { cardHash: "00000000" }, "stale_card"],
    ["an already-sent issue", { status: "SENT" as const }, "illegal_status"],
  ] as const)("rejects %s", (_w, over, failure) => {
    expect(checkConfirm({ ...ok, ...over })).toContain(failure);
  });
});

describe("checkSendAllowed (the six guards)", () => {
  const confirmedAt = new Date("2026-10-14T15:00:00Z");
  const ok = {
    status: "CONFIRMED" as IssueStatus,
    confirmedBy: 42 as number | null,
    confirmedAt: confirmedAt as Date | null,
    storedHash: "h1" as string | null,
    freshHash: "h1",
    confirmApprovalHashes: ["h1"],
    sentAt: null as Date | null,
    shreyaTgId: 42,
  };

  it("passes only when every guard holds", () => {
    expect(checkSendAllowed(ok)).toEqual([]);
  });

  it.each([
    ["wrong status (still in review)", { status: "IN_REVIEW" as const }, "status_not_confirmed"],
    ["wrong user confirmed it", { confirmedBy: 7 }, "wrong_confirmer"],
    ["missing confirmation time", { confirmedAt: null }, "not_confirmed"],
    ["content changed after confirm", { freshHash: "h2" }, "hash_changed"],
    ["no matching confirm approval", { confirmApprovalHashes: ["old"] }, "no_confirm_approval"],
    ["already sent", { sentAt: new Date() }, "already_sent"],
  ] as const)("blocks: %s", (_w, over, failure) => {
    expect(checkSendAllowed({ ...ok, ...over })).toContain(failure);
  });

  it("an unconfirmed issue fails several guards at once", () => {
    expect(checkSendAllowed({ ...ok, status: "IN_REVIEW", confirmedBy: null, confirmedAt: null, storedHash: null })).toEqual(
      expect.arrayContaining(["status_not_confirmed", "wrong_confirmer", "not_confirmed", "hash_changed", "no_confirm_approval"]),
    );
  });
});

describe("draftDeliverable", () => {
  it("accepts a valid draft or one flagged for attention", () => {
    expect(draftDeliverable({ livePicks: 9, topics: 4, needsAttention: false })).toBe(true);
    expect(draftDeliverable({ livePicks: 6, topics: 2, needsAttention: true })).toBe(true);
  });

  it("rejects an invalid unflagged draft or an empty one", () => {
    expect(draftDeliverable({ livePicks: 7, topics: 3, needsAttention: false })).toBe(false);
    expect(draftDeliverable({ livePicks: 9, topics: 2, needsAttention: false })).toBe(false);
    expect(draftDeliverable({ livePicks: 0, topics: 0, needsAttention: true })).toBe(false);
  });
});
