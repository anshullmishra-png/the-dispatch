import Parser from "rss-parser";
import { stripHtml, truncate } from "./text";
import type { CollectedItem } from "./types";

export const FEED_TIMEOUT_MS = 8_000;
export const MAX_ITEMS_PER_FEED = 40;
export const SNIPPET_MAX = 600;

const parser = new Parser();

export function userAgent(appUrl?: string): string {
  return `TheDispatchBot/1.0 (+${appUrl ?? "https://the-dispatch-pi.vercel.app"})`;
}

export class FeedError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FeedError";
  }
}

export async function fetchFeedXml(url: string, ua: string, timeoutMs = FEED_TIMEOUT_MS): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": ua,
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new FeedError(timedOut ? `timeout after ${timeoutMs} ms` : `network error: ${(err as Error).message}`);
  }
  if (!res.ok) throw new FeedError(`HTTP ${res.status}`, res.status);
  return res.text();
}

type FeedItem = Parser.Item & Record<string, unknown>;

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function snippetOf(item: FeedItem): string | null {
  const candidates = [
    item.contentSnippet,
    item["content:encodedSnippet"],
    item["content:encoded"],
    item.content,
    item.summary,
    item.description,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) {
      const text = stripHtml(c);
      if (text) return truncate(text, SNIPPET_MAX);
    }
  }
  return null;
}

/** Parses RSS/Atom XML into items with a valid http(s) link and a title. */
export async function parseFeed(xml: string, publisher: string): Promise<{ items: CollectedItem[]; feedTitle: string | null }> {
  let feed: Parser.Output<FeedItem>;
  try {
    feed = await parser.parseString(xml);
  } catch (err) {
    throw new FeedError(`unparseable feed: ${(err as Error).message.slice(0, 120)}`);
  }
  const items: CollectedItem[] = [];
  for (const item of feed.items ?? []) {
    const url = typeof item.link === "string" ? item.link.trim() : "";
    const title = stripHtml(typeof item.title === "string" ? item.title : "");
    if (!url || !title || !isHttpUrl(url)) continue;
    items.push({
      url,
      title,
      snippet: snippetOf(item),
      publisher,
      publishedAt: parseDate(item.isoDate) ?? parseDate(item.pubDate),
      raw: {
        guid: typeof item.guid === "string" ? item.guid : undefined,
        categories: Array.isArray(item.categories) ? item.categories.slice(0, 8) : undefined,
      },
    });
    if (items.length >= MAX_ITEMS_PER_FEED) break;
  }
  return { items, feedTitle: feed.title ?? null };
}

export async function collectRss(url: string, publisher: string, ua: string): Promise<CollectedItem[]> {
  const xml = await fetchFeedXml(url, ua);
  return (await parseFeed(xml, publisher)).items;
}
