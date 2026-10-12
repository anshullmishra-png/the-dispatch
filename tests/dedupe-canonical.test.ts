import { describe, expect, it } from "vitest";
import { canonicalizeUrl, hashUrl } from "@/lib/dedupe/canonical";

const BASE = "https://inc42.com/buzz/zepto-raises-funding";

describe("canonicalizeUrl", () => {
  it("removes tracking params", () => {
    expect(
      canonicalizeUrl(
        `${BASE}?utm_source=x&utm_medium=rss&UTM_Campaign=y&fbclid=1&gclid=2&mc_cid=3&mc_eid=4&ref=feed&ref_src=tw&cmpid=5&ito=6`,
      ),
    ).toBe(BASE);
  });

  it("keeps meaningful params, sorted so order is irrelevant", () => {
    const a = canonicalizeUrl(`${BASE}?page=2&id=9&utm_source=x`);
    const b = canonicalizeUrl(`${BASE}?id=9&page=2`);
    expect(a).toBe(`${BASE}?id=9&page=2`);
    expect(a).toBe(b);
  });

  it("collapses www, case, fragment and trailing slash variants", () => {
    const variants = [
      "https://www.inc42.com/buzz/zepto-raises-funding/",
      "HTTPS://WWW.Inc42.com/buzz/zepto-raises-funding#comments",
      "https://inc42.com/buzz/zepto-raises-funding//",
    ];
    for (const v of variants) expect(canonicalizeUrl(v)).toBe(BASE);
  });

  it("resolves AMP paths and the amp param", () => {
    expect(canonicalizeUrl(`${BASE}/amp/`)).toBe(BASE);
    expect(canonicalizeUrl(`${BASE}/amp`)).toBe(BASE);
    expect(canonicalizeUrl("https://inc42.com/amp/buzz/zepto-raises-funding")).toBe(BASE);
    expect(canonicalizeUrl(`${BASE}?amp`)).toBe(BASE);
    expect(canonicalizeUrl(`${BASE}?amp=1`)).toBe(BASE);
  });

  it("keeps path case (paths are case-sensitive)", () => {
    expect(canonicalizeUrl("https://example.com/News/A1")).toBe("https://example.com/News/A1");
  });

  it("rejects non-http URLs", () => {
    expect(() => canonicalizeUrl("ftp://example.com/x")).toThrow();
    expect(() => canonicalizeUrl("not a url")).toThrow();
  });
});

describe("hashUrl", () => {
  it("is a stable sha256 hex digest", () => {
    const h = hashUrl(BASE);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashUrl(canonicalizeUrl(`https://www.inc42.com/buzz/zepto-raises-funding/?utm_source=x`))).toBe(h);
  });
});
