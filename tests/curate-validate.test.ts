import { describe, expect, it } from "vitest";
import { parseNeverSay } from "@/lib/curate/lint";
import { validateSelection } from "@/lib/curate/validate";
import { buildLastFourEntry } from "@/lib/dedupe/history";
import { fixtureCandidates, STYLE_GUIDE, validSelection } from "./fixtures/curate";

const ctx = (over: Partial<Parameters<typeof validateSelection>[1]> = {}) => ({
  candidates: fixtureCandidates(),
  lastFour: [],
  neverSay: parseNeverSay(STYLE_GUIDE),
  ...over,
});
const codes = (sel = validSelection(), c = ctx()) => validateSelection(sel, c).violations.map((v) => v.code);

describe("validateSelection", () => {
  it("accepts the valid fixture", () => {
    const res = validateSelection(validSelection(), ctx());
    expect(res.violations).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("COUNT: too few picks or the wrong number of backups", () => {
    const sel = validSelection();
    sel.picks = sel.picks.slice(0, 7);
    expect(codes(sel)).toContain("COUNT");
    const sel2 = validSelection();
    sel2.backups = sel2.backups.slice(0, 4);
    expect(codes(sel2)).toContain("COUNT");
  });

  it("UNKNOWN_ID: id not in candidates, or an invalid topic", () => {
    const sel = validSelection();
    (sel.picks[0] as { article_id: string }).article_id = "a99";
    expect(codes(sel)).toContain("UNKNOWN_ID");
    const sel2 = validSelection();
    (sel2.picks[0] as { topic: string }).topic = "crypto";
    expect(codes(sel2)).toContain("UNKNOWN_ID");
  });

  it("DUPLICATE_ID: an id reused across picks and backups", () => {
    const sel = validSelection();
    (sel.backups[0] as { article_id: string }).article_id = "a01";
    expect(codes(sel)).toContain("DUPLICATE_ID");
  });

  it("TOPIC_SPREAD: picks covering fewer than 3 topics", () => {
    const sel = validSelection();
    sel.picks.forEach((p, i) => ((p as { topic: string }).topic = i % 2 ? "fintech" : "funding_vc"));
    expect(codes(sel)).toContain("TOPIC_SPREAD");
  });

  it("LAST_FOUR_HIT: a near-repeat of a story from the last four issues", () => {
    const lastFour = [
      buildLastFourEntry({
        issueId: "past",
        issueDate: "2026-10-08",
        topic: "exits_markets",
        title: "Zetwerk sets IPO price band at ₹143-151 for its issue",
        headline: "Zetwerk sets IPO price band at Rs 143-151",
        canonicalHash: "x",
      }),
    ];
    const v = validateSelection(validSelection(), ctx({ lastFour })).violations;
    expect(v.find((x) => x.code === "LAST_FOUR_HIT")).toMatchObject({ articleId: "a01", role: "pick" });
  });

  it("SAME_STORY_IN_PICKS: two picks from one duplicate cluster", () => {
    const candidates = fixtureCandidates();
    const a02 = candidates.get("a02");
    const a03 = candidates.get("a03");
    if (a02 && a03) candidates.set("a03", { ...a03, clusterRoot: a02.clusterRoot });
    expect(codes(validSelection(), ctx({ candidates }))).toContain("SAME_STORY_IN_PICKS");
  });

  it("COMMENTARY_SHAPE: one sentence, or more than 65 words", () => {
    const sel = validSelection();
    (sel.picks[0] as { commentary: string }).commentary = "Just one sentence here.";
    expect(codes(sel)).toContain("COMMENTARY_SHAPE");
    const sel2 = validSelection();
    (sel2.picks[1] as { commentary: string }).commentary = `${"word ".repeat(70).trim()}. Second sentence.`;
    expect(codes(sel2)).toContain("COMMENTARY_SHAPE");
  });

  it("VOICE_LINT: a banned phrase from the style guide", () => {
    const sel = validSelection();
    (sel.picks[0] as { commentary: string }).commentary = "This round is a game-changer for D2C. It matters.";
    const v = validateSelection(sel, ctx()).violations.find((x) => x.code === "VOICE_LINT");
    expect(v?.message).toContain("banned:game-changer");
  });
});
