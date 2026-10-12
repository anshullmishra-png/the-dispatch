import { describe, expect, it } from "vitest";
import { FeedError, MAX_ITEMS_PER_FEED, parseFeed } from "@/lib/collect/rss";

const rss = (items: string) => `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel><title>Inc42</title><link>https://inc42.com</link>${items}</channel>
</rss>`;

describe("parseFeed (RSS 2.0)", () => {
  it("maps title, link, date and an HTML-stripped snippet", async () => {
    const { items, feedTitle } = await parseFeed(
      rss(`<item>
        <title>Zepto raises &#036;350 Mn</title>
        <link>https://inc42.com/buzz/zepto/?utm_source=rss</link>
        <pubDate>Mon, 12 Oct 2026 04:30:00 +0000</pubDate>
        <description><![CDATA[<p>The <b>quick commerce</b> major raised funds.</p>]]></description>
      </item>`),
      "Inc42",
    );
    expect(feedTitle).toBe("Inc42");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Zepto raises $350 Mn",
      url: "https://inc42.com/buzz/zepto/?utm_source=rss",
      publisher: "Inc42",
      snippet: "The quick commerce major raised funds.",
    });
    expect(items[0]?.publishedAt?.toISOString()).toBe("2026-10-12T04:30:00.000Z");
  });

  it("prefers content:encoded over a missing description", async () => {
    const { items } = await parseFeed(
      rss(`<item><title>A</title><link>https://x.in/a</link>
        <content:encoded><![CDATA[<div>Full <i>body</i> text</div>]]></content:encoded></item>`),
      "X",
    );
    expect(items[0]?.snippet).toBe("Full body text");
  });

  it("drops items without a title or a valid http link, and keeps undated ones", async () => {
    const { items } = await parseFeed(
      rss(`<item><title>No link</title></item>
        <item><title></title><link>https://x.in/b</link></item>
        <item><title>Bad scheme</title><link>javascript:alert(1)</link></item>
        <item><title>Undated</title><link>https://x.in/c</link><pubDate>not a date</pubDate></item>`),
      "X",
    );
    expect(items.map((i) => i.title)).toEqual(["Undated"]);
    expect(items[0]?.publishedAt).toBeNull();
  });

  it(`caps a feed at ${MAX_ITEMS_PER_FEED} items`, async () => {
    const many = Array.from({ length: 55 }, (_, i) => `<item><title>T${i}</title><link>https://x.in/${i}</link></item>`).join("");
    expect((await parseFeed(rss(many), "X")).items).toHaveLength(MAX_ITEMS_PER_FEED);
  });

  it("parses Atom feeds", async () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>RoW</title>
      <entry><title>Atom story</title><link href="https://restofworld.org/2026/x/"/>
      <updated>2026-10-11T10:00:00Z</updated><summary>Short summary</summary></entry></feed>`;
    const { items } = await parseFeed(atom, "Rest of World");
    expect(items[0]).toMatchObject({ title: "Atom story", url: "https://restofworld.org/2026/x/" });
  });

  it("raises a FeedError for an HTML page served instead of a feed", async () => {
    await expect(parseFeed("<html><body><script async>x</script></body></html>", "X")).rejects.toBeInstanceOf(FeedError);
  });
});
