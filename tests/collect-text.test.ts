import { describe, expect, it } from "vitest";
import { decodeEntities, stripHtml, truncate } from "@/lib/collect/text";

describe("stripHtml", () => {
  it("removes tags, scripts, styles and comments", () => {
    expect(stripHtml('<p>Zepto <b>raises</b></p><script>alert(1)</script><style>p{}</style><!-- x -->funds')).toBe(
      "Zepto raises funds",
    );
  });

  it("decodes named and numeric entities", () => {
    expect(stripHtml("Tata &amp; Sons &#8377;50 &#x20B9;5 &rsquo;s &nbsp;deal")).toBe("Tata & Sons ₹50 ₹5 ’s deal");
  });

  it("leaves unknown entities intact", () => {
    expect(decodeEntities("a &bogus; b")).toBe("a &bogus; b");
  });
});

describe("truncate", () => {
  it("returns short text unchanged", () => {
    expect(truncate("short", 10)).toBe("short");
  });

  it("cuts at a word boundary with an ellipsis", () => {
    const out = truncate("Quick commerce players are burning cash on dark stores", 30);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });
});
