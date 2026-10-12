import { describe, expect, it } from "vitest";
import { extractEntities, normalizeTitle, stripSourceSuffix } from "@/lib/dedupe/normalize";

describe("stripSourceSuffix", () => {
  it("strips a short trailing publisher suffix", () => {
    expect(stripSourceSuffix("Zepto raises $350 Mn in fresh round - Inc42 Media")).toBe(
      "Zepto raises $350 Mn in fresh round",
    );
    expect(stripSourceSuffix("Zepto raises $350 Mn | The Economic Times")).toBe("Zepto raises $350 Mn");
    expect(stripSourceSuffix("Zepto raises $350 Mn — Mint")).toBe("Zepto raises $350 Mn");
  });

  it("keeps a long suffix that is part of the headline", () => {
    const title = "Quick commerce - why the dark store math still does not add up for anyone";
    expect(stripSourceSuffix(title)).toBe(title);
  });
});

describe("normalizeTitle", () => {
  it("lowercases, removes punctuation and quotes, collapses spaces", () => {
    expect(normalizeTitle("  Zepto's  ‘big’ bet: “10-minute” delivery!! ")).toBe(
      "zeptos big bet 10 minute delivery",
    );
  });

  it("treats Rs / INR / ₹ amounts as equal", () => {
    const a = normalizeTitle("Startup X raises Rs 50 crore");
    expect(a).toBe("startup x raises ₹50 crore");
    expect(normalizeTitle("Startup X raises ₹50 crore")).toBe(a);
    expect(normalizeTitle("Startup X raises Rs. 50 crore")).toBe(a);
    expect(normalizeTitle("Startup X raises INR 50 crore")).toBe(a);
    expect(normalizeTitle("Startup X raises Rs50 crore")).toBe(a);
  });

  it("drops thousands separators but keeps decimals", () => {
    expect(normalizeTitle("Layoffs hit 1,200 staff")).toBe("layoffs hit 1200 staff");
    expect(normalizeTitle("Raises $2.5 Mn")).toBe("raises $2.5 mn");
    expect(normalizeTitle("Raises $2.5 Mn")).not.toBe(normalizeTitle("Raises $25 Mn"));
  });

  it("drops leading exclusive/breaking/watch tags and the source suffix", () => {
    expect(normalizeTitle("EXCLUSIVE: Breaking: Meesho files DRHP - Entrackr")).toBe("meesho files drhp");
  });

  it("does not turn words containing 'rs' into rupees", () => {
    expect(normalizeTitle("Founders raise 5 crore")).toBe("founders raise 5 crore");
    expect(normalizeTitle("Investors back Rsquare")).toBe("investors back rsquare");
  });
});

describe("extractEntities", () => {
  it("extracts capitalised names and normalised numbers", () => {
    const e = extractEntities("Zepto raises Rs 2,500 crore from Motilal Oswal - Inc42");
    expect(e).toEqual(expect.arrayContaining(["zepto", "₹2500", "motilal oswal"]));
    expect(e).not.toContain("inc42");
  });

  it("breaks name phrases at commas and other punctuation", () => {
    const e = extractEntities("AI-focused byteXL raises $9 Mn from Elevar Equity, Kalaari Capital");
    expect(e).toEqual(expect.arrayContaining(["elevar equity", "kalaari capital"]));
    expect(e).not.toContain("elevar equity kalaari capital");
  });

  it("recognises mixed-case brand names", () => {
    expect(extractEntities("Edtech firm byteXL raises $9 million")).toContain("bytexl");
    expect(extractEntities("Zepto's rival eyes Pune")).toEqual(expect.arrayContaining(["zepto", "pune"]));
  });

  it("matches amounts regardless of unit spelling", () => {
    const a = extractEntities("Zepto raises ₹2,500 crore");
    const b = extractEntities("Zepto raises Rs 2,500 Cr");
    expect(a).toEqual(["zepto", "₹2500"]);
    expect(b).toEqual(["zepto", "₹2500"]);
  });

  it("skips stop words, months and India/startup", () => {
    const e = extractEntities("How Indian Startup Razorpay Plans IPO In October");
    expect(e).not.toEqual(expect.arrayContaining(["how", "indian", "startup", "october"]));
    expect(e.join(" ")).toContain("razorpay");
    expect(e.join(" ")).toContain("ipo");
  });

  it("two outlets covering the same round share entities", () => {
    const a = extractEntities("Zepto raises $350 Mn led by Motilal Oswal - Inc42");
    const b = extractEntities("Quick commerce major Zepto bags $350 Mn; Motilal Oswal leads | ET");
    const shared = a.filter((x) => b.includes(x));
    expect(shared.length).toBeGreaterThanOrEqual(2);
  });
});
