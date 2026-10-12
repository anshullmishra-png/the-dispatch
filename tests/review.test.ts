import { describe, expect, it } from "vitest";
import { canRemove, chooseBackup, draftWarnings, editSimilarity } from "@/lib/approval/review";

describe("editSimilarity", () => {
  it("is 1 for identical text and falls with the edit distance", () => {
    expect(editSimilarity("same", "same")).toBe(1);
    expect(editSimilarity("", "")).toBe(1);
    expect(editSimilarity("kitten", "sitting")).toBeCloseTo(1 - 3 / 7, 3);
    expect(editSimilarity("abc", "")).toBe(0);
  });

  it("a small tweak scores high, a rewrite scores low", () => {
    const ai = "Merchants carry the cost of UPI. Banks do not.";
    expect(editSimilarity(ai, "Merchants carry the cost of UPI. Banks don't.")).toBeGreaterThan(0.9);
    expect(editSimilarity(ai, "Nobody is talking about who pays for free payments.")).toBeLessThan(0.5);
  });
});

describe("chooseBackup", () => {
  const b = (id: string, topic: string, backupRank: number) => ({ id, topic, backupRank });

  it("takes the next backup by rank when the spread holds", () => {
    expect(chooseBackup(["fintech", "ai_saas", "funding_vc"], [b("2", "fintech", 2), b("1", "fintech", 1)])).toEqual({
      backup: b("1", "fintech", 1),
      spreadOk: true,
    });
  });

  it("skips to the best-ranked backup that restores 3 topics", () => {
    const backups = [b("1", "fintech", 1), b("2", "ai_saas", 2), b("3", "health_bio", 3), b("4", "policy_regulation", 4)];
    expect(chooseBackup(["fintech", "fintech", "ai_saas"], backups)).toEqual({ backup: b("3", "health_bio", 3), spreadOk: true });
  });

  it("falls back to the next backup and reports it when none restores the spread", () => {
    expect(chooseBackup(["fintech", "fintech"], [b("1", "ai_saas", 1)])).toEqual({ backup: b("1", "ai_saas", 1), spreadOk: false });
  });

  it("returns null with no backups left", () => {
    expect(chooseBackup(["fintech"], [])).toBeNull();
  });
});

describe("canRemove", () => {
  const picks = (topics: string[]) => topics.map((topic, i) => ({ id: `s${i}`, topic }));

  it("allows a removal that leaves at least 8 stories and 3 topics", () => {
    expect(canRemove(picks(["a", "a", "a", "b", "b", "c", "c", "c", "a"]), "s0")).toBe("ok");
  });

  it("refuses when only 8 stories are left", () => {
    expect(canRemove(picks(["a", "a", "b", "b", "c", "c", "a", "b"]), "s0")).toBe("too_few_stories");
  });

  it("refuses when the rest would cover fewer than 3 topics", () => {
    expect(canRemove(picks(["c", "a", "a", "a", "a", "b", "b", "b", "b"]), "s0")).toBe("too_few_topics");
  });
});

describe("draftWarnings", () => {
  it("warns on fewer than 8 picks or fewer than 3 topics", () => {
    expect(draftWarnings(9, 4)).toEqual([]);
    expect(draftWarnings(6, 4)).toEqual(["Only 6 valid stories; the draft was not padded with weak ones."]);
    expect(draftWarnings(9, 2)).toEqual(["Picks span only 2 topics (the rule is at least 3)."]);
  });
});
