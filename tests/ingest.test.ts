import { describe, expect, it, vi } from "vitest";
import { type CollectDeps, collectAll, prepareItems } from "@/lib/collect";
import { GNewsQuotaError } from "@/lib/collect/gnews";
import type { CollectedItem } from "@/lib/collect/types";
import { issueWindow } from "@/lib/time";

const window = issueWindow("2026-10-15"); // Wed 7 Oct 13:30 IST → Wed 14 Oct 13:29:59.999 IST
const src = (kind: "rss" | "gnews", name: string) => ({ id: `${kind}-${name}`, kind, name, urlOrQuery: `${name}-url` });
const item = (over: Partial<CollectedItem> = {}): CollectedItem => ({
  url: "https://inc42.com/buzz/a",
  title: "Zepto raises $350 Mn",
  snippet: null,
  publisher: "Inc42",
  publishedAt: new Date("2026-10-12T05:00:00Z"),
  raw: {},
  ...over,
});
const noSleep = async () => {};

describe("collectAll", () => {
  it("a dead feed does not break the run", async () => {
    const deps: CollectDeps = {
      rss: vi.fn(async (url: string) => {
        if (url === "dead-url") throw new Error("HTTP 404");
        return [item()];
      }),
      sleep: noSleep,
    };
    const { outcomes } = await collectAll([src("rss", "good"), src("rss", "dead"), src("rss", "also-good")], window, deps);
    expect(outcomes.map((o) => o.status)).toEqual(["ok", "failed", "ok"]);
    expect(outcomes[1]).toMatchObject({ status: "failed", error: "HTTP 404" });
  });

  it("stops GNews for the run on a quota error and keeps the rest skipped", async () => {
    const gnews = vi
      .fn()
      .mockResolvedValueOnce([item()])
      .mockRejectedValueOnce(new GNewsQuotaError(403))
      .mockResolvedValue([item()]);
    const { outcomes, gnewsRequests, gnewsStopped } = await collectAll(
      [src("gnews", "q1"), src("gnews", "q2"), src("gnews", "q3")],
      window,
      { rss: vi.fn(), gnews, sleep: noSleep },
    );
    expect(outcomes.map((o) => o.status)).toEqual(["ok", "skipped", "skipped"]);
    expect(gnewsRequests).toBe(2);
    expect(gnewsStopped).toBe("quota (HTTP 403)");
    expect(gnews).toHaveBeenCalledTimes(2);
  });

  it("asks GNews for articles since the window start", async () => {
    const gnews = vi.fn().mockResolvedValue([]);
    await collectAll([src("gnews", "q1")], window, { rss: vi.fn(), gnews, sleep: noSleep });
    expect(gnews).toHaveBeenCalledWith("q1-url", window.start);
  });

  it("skips GNews sources when no key is configured", async () => {
    const { outcomes, gnewsStopped } = await collectAll([src("gnews", "q1")], window, { rss: vi.fn(), sleep: noSleep });
    expect(outcomes[0]).toMatchObject({ status: "skipped", reason: "gnews_not_configured" });
    expect(gnewsStopped).toBe("not_configured");
  });
});

describe("prepareItems", () => {
  const ctx = { issueId: "issue-1", sourceId: "src-1", window, fetchedAt: new Date("2026-10-12T06:00:00Z") };

  it("keeps items inside the window, including both edges", () => {
    const { rows, counts } = prepareItems(
      [
        item({ url: "https://x.in/start", publishedAt: window.start }),
        item({ url: "https://x.in/end", publishedAt: window.end }),
        item({ url: "https://x.in/before", publishedAt: new Date(window.start.getTime() - 1) }),
        item({ url: "https://x.in/after", publishedAt: new Date(window.end.getTime() + 1) }),
      ],
      ctx,
    );
    expect(rows.map((r) => r.url)).toEqual(["https://x.in/start", "https://x.in/end"]);
    expect(counts).toMatchObject({ fetched: 4, inWindow: 2, outOfWindow: 2 });
  });

  it("dates undated items at fetch time and flags them", () => {
    const { rows, counts } = prepareItems([item({ publishedAt: null })], ctx);
    expect(rows[0]?.publishedAt).toEqual(ctx.fetchedAt);
    expect(rows[0]?.raw).toMatchObject({ date_missing: true });
    expect(counts.undated).toBe(1);
  });

  it("canonicalises URLs and drops repeats within the batch", () => {
    const { rows, counts } = prepareItems(
      [
        item({ url: "https://www.inc42.com/buzz/a/?utm_source=rss" }),
        item({ url: "https://inc42.com/buzz/a" }),
        item({ url: "notaurl" }),
      ],
      ctx,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.canonicalUrl).toBe("https://inc42.com/buzz/a");
    expect(counts).toMatchObject({ duplicateInBatch: 1, invalidUrl: 1 });
  });

  it("stores new articles with normalised title, entities and status new", () => {
    const { rows } = prepareItems([item({ title: "Zepto raises Rs 2,500 crore - Inc42" })], ctx);
    expect(rows[0]).toMatchObject({
      status: "new",
      issueId: "issue-1",
      sourceId: "src-1",
      titleNorm: "zepto raises ₹2500 crore",
    });
    expect(rows[0]?.entities).toEqual(expect.arrayContaining(["zepto", "₹2500"]));
    expect(rows[0]?.canonicalHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
