import { describe, expect, it } from "vitest";
import { groundingLint, openingRepeats, parseNeverSay, splitSentences, voiceLint, wordCount } from "@/lib/curate/lint";
import { STYLE_GUIDE } from "./fixtures/curate";

const NEVER = parseNeverSay(STYLE_GUIDE);
const ok = "Zepto raised money again. The round is smaller than the last one.";

describe("splitSentences", () => {
  it("does not split on abbreviations or decimals", () => {
    expect(splitSentences("The U.S. rule bites. Rs. 2.5 crore is small. Fair enough.")).toHaveLength(3);
  });

  it("splits after quotes and question marks", () => {
    expect(splitSentences("Is it real? “Not yet,” says the founder. Watch the margins.")).toHaveLength(3);
  });

  it("counts words", () => {
    expect(wordCount("  one two   three ")).toBe(3);
  });
});

describe("parseNeverSay", () => {
  it("reads the style guide's list, dropping notes and surrounding quotes", () => {
    expect(NEVER).toEqual(expect.arrayContaining(["game-changer", "in a bid to", "the indian startup ecosystem", "it's worth noting"]));
    expect(NEVER.some((p) => p.includes("(") || p.includes('"'))).toBe(false);
  });
});

describe("voiceLint", () => {
  it("passes clean commentary", () => {
    expect(voiceLint(ok, NEVER).errors).toEqual([]);
  });

  it("flags banned phrases, including hyphen/space variants", () => {
    expect(voiceLint("This is a game changer for lending. It will matter.", NEVER).errors).toContain("banned:game-changer");
    expect(voiceLint("In a bid to grow, Zepto raised again. It worked.", NEVER).errors).toContain("banned:in a bid to");
  });

  it("does not flag a banned word inside another word", () => {
    expect(voiceLint("The landmarks moved. The disruption was real.", ["landmark", "disrupt"]).errors).toEqual([]);
  });

  it("flags hashtags, emoji, markup and exclamation marks", () => {
    const { errors } = voiceLint("Big news #startups 🚀 **now**! Another sentence here.", NEVER);
    expect(errors).toEqual(expect.arrayContaining(["hashtag", "emoji", "markup", "exclamation"]));
  });

  it("flags shape: too few or too many sentences, too many words", () => {
    expect(voiceLint("One sentence only.", NEVER).errors[0]).toMatch(/^sentences:1/);
    expect(voiceLint("A. B. C. D.", NEVER).errors[0]).toMatch(/^sentences:4/);
    const long = `${"word ".repeat(70).trim()}. Second one.`;
    expect(voiceLint(long, NEVER).errors).toContain("words:72 (max 65)");
  });

  it("warns on more than one question", () => {
    expect(voiceLint("Is it? Was it? It was.", NEVER).warnings).toContain("more than one question");
  });
});

describe("openingRepeats", () => {
  it("finds commentaries that open with the same word", () => {
    expect(openingRepeats(["The round is big.", "the founder left.", "Zepto grew."])).toEqual(["the"]);
  });
});

describe("groundingLint", () => {
  const source = "Zepto raises Rs 1,200 crore led by Motilal Oswal. Revenue grew 40% in FY26.";

  it("flags a number the source does not contain", () => {
    expect(groundingLint("Revenue grew 42%. That is fast.", source)).toContain("ungrounded_number:42%");
  });

  it("treats 1,200 = 1200 and Rs = ₹", () => {
    expect(groundingLint("Zepto raised ₹1200 crore. Motilal Oswal led it.", source)).toEqual([]);
    expect(groundingLint("It raised Rs 1,200 crore. Growth was 40%.", source)).toEqual([]);
  });

  it("flags a multi-word name the source does not mention", () => {
    expect(groundingLint("Peak XV Partners also joined. Motilal Oswal led.", source)).toContain("ungrounded_entity:peak xv partners");
  });

  // Real false alarms from the first live draft (2026-10-12).
  it("does not join a name across a sentence boundary", () => {
    const src = "Tessolve raised $75 Mn led by Vector Line Capital.";
    expect(groundingLint("The round was led by Vector Line Capital. Semiconductor design needs capital.", src)).toEqual([]);
  });

  it("ignores a capitalised sentence opener in front of a name", () => {
    const src = "What happens when merchants pass on UPI MDR costs to customers?";
    expect(groundingLint("Passing UPI costs on hurts buyers. Merchants raise prices.", src)).toEqual([]);
  });

  // False alarms from the second live draft (2026-10-12).
  it("does not treat digits inside codes like D2C or Q2 as amounts", () => {
    const src = "DailyObjects raises Rs 332 crore; Roots Ventures realised an 18x return";
    expect(groundingLint("D2C scale needs stores. Q2 matters, and 18x is rare.", src)).toEqual([]);
  });

  it("matches names across straight and curly possessives", () => {
    const src = "Deepinder Goyal’s Temple is an unusual wearable.";
    expect(groundingLint("Smartwatches sit on the wrist. Deepinder Goyal's Temple does not.", src)).toEqual([]);
  });

  it("still flags an invented mid-sentence detail", () => {
    const src = "DailyObjects raises Rs 332 crore funding at Rs 1,050 crore valuation";
    expect(groundingLint("DailyObjects closed a ₹332 crore Series C round. It will open stores.", src)).toContain("ungrounded_entity:series c");
  });
});
