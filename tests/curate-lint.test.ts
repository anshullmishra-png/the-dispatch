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
});
