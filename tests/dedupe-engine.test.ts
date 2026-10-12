import { describe, expect, it } from "vitest";
import {
  ACTIVE_RULE,
  CALIBRATED_RULE,
  chooseDuplicateRoot,
  DOC_RULE,
  isDistinctiveEntity,
  isDuplicate,
  judgePair,
  pickRepresentatives,
  sharedEntityCount,
} from "@/lib/dedupe/engine";
import { buildLastFourEntry, matchLastFour } from "@/lib/dedupe/history";
import { extractEntities, normalizeTitle } from "@/lib/dedupe/normalize";
import { trigramSimilarity } from "@/lib/dedupe/trigram";

/** Real headline pairs from the 12 Oct 2026 ingest, run through the full pipeline. */
const verdict = (a: string, b: string) =>
  judgePair(trigramSimilarity(normalizeTitle(a), normalizeTitle(b)), extractEntities(a), extractEntities(b));

describe("trigramSimilarity (pg_trgm port)", () => {
  it("matches the PostgreSQL documentation example", () => {
    expect(trigramSimilarity("word", "two words")).toBeCloseTo(4 / 11, 6);
  });

  it("is 1 for identical text, 0 for disjoint or empty", () => {
    expect(trigramSimilarity("zepto raises funds", "zepto raises funds")).toBe(1);
    expect(trigramSimilarity("abc", "xyz")).toBe(0);
    expect(trigramSimilarity("", "zepto")).toBe(0);
  });
});

describe("isDuplicate thresholds", () => {
  it("doc rule edges (0.44 / 0.45 / 0.6)", () => {
    expect(isDuplicate(0.44, 0, DOC_RULE)).toBe(false);
    expect(isDuplicate(0.45, 1, DOC_RULE)).toBe(false);
    expect(isDuplicate(0.45, 2, DOC_RULE)).toBe(true);
    expect(isDuplicate(0.599, 0, DOC_RULE)).toBe(false);
    expect(isDuplicate(0.6, 0, DOC_RULE)).toBe(true);
  });

  it("calibrated rule tiers (0.30 / 0.60 / 0.85)", () => {
    expect(ACTIVE_RULE).toBe(CALIBRATED_RULE);
    expect(isDuplicate(0.44, 0)).toBe(false); // 0.44 with no shared entities → candidate
    expect(isDuplicate(0.299, 5)).toBe(false);
    expect(isDuplicate(0.3, 1)).toBe(false);
    expect(isDuplicate(0.3, 2)).toBe(true);
    expect(isDuplicate(0.6, 0)).toBe(false);
    expect(isDuplicate(0.6, 1)).toBe(true);
    expect(isDuplicate(0.849, 0)).toBe(false);
    expect(isDuplicate(0.85, 0)).toBe(true);
  });
});

describe("distinctive entities", () => {
  it("drops generic words, quarter codes, years and small numbers", () => {
    for (const e of ["q2", "results", "net", "ipo", "rupee", "u.s", "2026", "09", "q2fy27", "fy26", "ai"]) {
      expect(isDistinctiveEntity(e)).toBe(false);
    }
  });

  it("keeps names, currency amounts, percentages and big numbers", () => {
    for (const e of ["zepto", "poonawalla fincorp", "₹375", "$9", "5%", "20000", "fin homes q2"]) {
      expect(isDistinctiveEntity(e)).toBe(true);
    }
  });

  it("matches a phrase against a contained name", () => {
    expect(sharedEntityCount(["ai-focused bytexl", "$9"], ["bytexl", "$9"])).toBe(2);
    expect(sharedEntityCount(["ola electric"], ["ola electric", "ola"])).toBe(1);
  });
});

describe("real headline pairs", () => {
  it("two outlets covering the same funding round → duplicate", () => {
    expect(
      verdict(
        "Tessolve raises $75 million from US-based Vector Line Capital",
        "Hero Electronix’s Tessolve Semiconductor raises $75 Mn led by Vector Line Capital",
      ).duplicate,
    ).toBe(true);
    expect(
      verdict(
        "Nat Habit raises ₹142 crore in a Series C funding round led by Trident Growth Partners",
        "Nat Habit raises Rs 142 Cr in Series C led by Trident Growth Partners",
      ).duplicate,
    ).toBe(true);
    expect(
      verdict(
        "AI-focused byteXL raises $9 Mn from Elevar Equity, Kalaari Capital",
        "Edtech firm ByteXL raises $9 million in funding round led by Elevar Equity",
      ).duplicate,
    ).toBe(true);
  });

  it("same company, different story → not a duplicate", () => {
    expect(
      verdict("Zepto raises $350 Mn in funding round led by Motilal Oswal", "Zepto launches 10-minute pharmacy delivery in Bengaluru")
        .duplicate,
    ).toBe(false);
    expect(verdict("Ola Electric cuts 500 jobs as losses widen", "Ola Electric launches new scooter priced at Rs 79,999").duplicate).toBe(
      false,
    );
  });

  it("template headlines about different companies → not a duplicate", () => {
    expect(
      verdict(
        "Can Fin Homes Q2 Results: Net profit rises 9% to ₹275 crore as NII climbs",
        "Poonawalla Fincorp Q2 Results: Net profit jumps 5-fold to ₹375 crore on strong loan growth",
      ).duplicate,
    ).toBe(false);
    expect(
      verdict("Rupee rises 16 paise to close at 96.72 against U.S. dollar", "Rupee rises 23 paise to 96.65 against U.S. dollar in early trade")
        .duplicate,
    ).toBe(false);
    expect(
      verdict("The Latest Home Loan Interest Rates: Oct 09, 2026", "The Latest Fixed Deposit Interest Rates: Oct 09, 2026").duplicate,
    ).toBe(false);
  });

  it("an exact syndicated copy is a duplicate even with no entities", () => {
    const t = "India's quick commerce growth set to accelerate, food delivery to remain steady";
    expect(verdict(t, t).duplicate).toBe(true);
  });
});

describe("chooseDuplicateRoot", () => {
  const ents = ["tessolve", "$75", "vector line capital"];
  const match = (id: string, day: number, similarity: number, duplicateOf: string | null = null) => ({
    id,
    publishedAt: new Date(`2026-10-${String(day).padStart(2, "0")}T06:00:00Z`),
    entities: ents,
    duplicateOf,
    similarity,
  });

  it("points at the cluster root of the earliest matching article", () => {
    const root = chooseDuplicateRoot({ entities: ents }, [match("late", 11, 0.9), match("early-dup", 9, 0.5, "root-1")]);
    expect(root).toMatchObject({ rootId: "root-1" });
  });

  it("returns null when nothing satisfies the rule", () => {
    expect(chooseDuplicateRoot({ entities: ["other"] }, [match("x", 10, 0.4)])).toBeNull();
  });
});

describe("pickRepresentatives", () => {
  it("keeps one article per cluster: earliest, then longest snippet", () => {
    const at = (h: number) => new Date(`2026-10-10T0${h}:00:00Z`);
    const reps = pickRepresentatives([
      { id: "a", duplicateOf: null, publishedAt: at(5), snippet: "short" },
      { id: "b", duplicateOf: "a", publishedAt: at(3), snippet: "x" },
      { id: "c", duplicateOf: "a", publishedAt: at(3), snippet: "much longer snippet" },
      { id: "d", duplicateOf: null, publishedAt: at(4), snippet: null },
    ]);
    expect(reps.map((r) => r.id).sort()).toEqual(["c", "d"]);
  });
});

describe("matchLastFour", () => {
  const set = [
    buildLastFourEntry({
      issueId: "issue-oct-8",
      issueDate: "2026-10-08",
      title: "AI-focused byteXL raises $9 Mn from Elevar Equity, Kalaari Capital",
      headline: "byteXL's $9 Mn round is a bet on job-ready engineers",
      canonicalHash: "hash-bytexl",
    }),
  ];
  const article = (title: string, canonicalHash = "other") => ({
    titleNorm: normalizeTitle(title),
    entities: extractEntities(title),
    canonicalHash,
  });

  it("a near-repeat of a story from the last four issues → seen_before", () => {
    const hit = matchLastFour(article("Edtech firm ByteXL raises $9 million in funding round led by Elevar Equity"), set);
    expect(hit?.entry.issueDate).toBe("2026-10-08");
    expect(hit?.exactUrl).toBe(false);
  });

  it("the same canonical URL → seen_before regardless of title", () => {
    expect(matchLastFour(article("Totally different words", "hash-bytexl"), set)?.exactUrl).toBe(true);
  });

  it("an unrelated story is not matched", () => {
    expect(matchLastFour(article("Zepto launches 10-minute pharmacy delivery in Bengaluru"), set)).toBeNull();
  });
});
