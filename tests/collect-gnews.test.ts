import { afterEach, describe, expect, it, vi } from "vitest";
import { GNewsQuotaError, mapGNewsArticles, searchGNews } from "@/lib/collect/gnews";

const body = {
  information: {},
  totalArticles: 2,
  articles: [
    {
      id: "a1",
      title: "CurvetAI raises Rs 6 crore",
      description: "<p>Pre-seed round led by Merak Ventures.</p>",
      url: "https://economictimes.com/x",
      publishedAt: "2026-10-06T08:00:00Z",
      source: { name: "The Economic Times" },
    },
    { id: "a2", title: "", url: "https://y.in/z", publishedAt: "2026-10-06T08:00:00Z", source: { name: "Y" } },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("mapGNewsArticles", () => {
  it("maps articles and skips ones without a title", () => {
    const items = mapGNewsArticles(body, "startup funding");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "CurvetAI raises Rs 6 crore",
      snippet: "Pre-seed round led by Merak Ventures.",
      publisher: "The Economic Times",
      raw: { via: "gnews", query: "startup funding", gnewsId: "a1" },
    });
  });

  it("tolerates a body without articles", () => {
    expect(mapGNewsArticles({}, "q")).toEqual([]);
  });
});

describe("searchGNews", () => {
  it("sends country=in, sortby=publishedAt and the window start", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await searchGNews({ apikey: "secret-key", query: "AI startup", from: new Date("2026-10-08T00:00:00Z") });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("country")).toBe("in");
    expect(url.searchParams.get("sortby")).toBe("publishedAt");
    expect(url.searchParams.get("from")).toBe("2026-10-08T00:00:00.000Z");
    expect(url.searchParams.get("q")).toBe("AI startup");
  });

  it.each([403, 429])("throws GNewsQuotaError on HTTP %i", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
    await expect(searchGNews({ apikey: "k", query: "q", from: new Date() })).rejects.toBeInstanceOf(GNewsQuotaError);
  });

  it("never leaks the API key in error messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed for https://gnews.io/?apikey=secret-key")));
    await expect(searchGNews({ apikey: "secret-key", query: "q", from: new Date() })).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("secret-key") }),
    );
  });
});
