import { stripHtml, truncate } from "./text";
import type { CollectedItem } from "./types";
import { SNIPPET_MAX } from "./rss";

const ENDPOINT = "https://gnews.io/api/v4/search";
const TIMEOUT_MS = 10_000;

/** 403/429: daily quota exhausted or rate-limited. Ingest stops GNews for the run. */
export class GNewsQuotaError extends Error {
  constructor(readonly status: number) {
    super(`GNews quota/rate limit (HTTP ${status})`);
    this.name = "GNewsQuotaError";
  }
}

interface GNewsArticle {
  id?: string;
  title?: string;
  description?: string;
  url?: string;
  publishedAt?: string;
  source?: { name?: string };
}

export function mapGNewsArticles(body: unknown, query: string): CollectedItem[] {
  const articles = (body as { articles?: GNewsArticle[] })?.articles ?? [];
  const items: CollectedItem[] = [];
  for (const a of articles) {
    const url = a.url?.trim();
    const title = a.title ? stripHtml(a.title) : "";
    if (!url || !title) continue;
    const published = a.publishedAt ? new Date(a.publishedAt) : null;
    const snippet = a.description ? stripHtml(a.description) : "";
    items.push({
      url,
      title,
      snippet: snippet ? truncate(snippet, SNIPPET_MAX) : null,
      publisher: a.source?.name?.trim() || null,
      publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
      raw: { via: "gnews", query, gnewsId: a.id },
    });
  }
  return items;
}

export async function searchGNews(opts: {
  apikey: string;
  query: string;
  from: Date;
  max?: number;
}): Promise<CollectedItem[]> {
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    q: opts.query,
    lang: "en",
    country: "in",
    max: String(opts.max ?? 10),
    from: opts.from.toISOString(),
    sortby: "publishedAt",
    apikey: opts.apikey,
  }).toString();

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    // Never include the URL: it carries the API key.
    throw new Error(`GNews request failed: ${(err as Error).name}`);
  }
  if (res.status === 403 || res.status === 429) throw new GNewsQuotaError(res.status);
  if (!res.ok) throw new Error(`GNews HTTP ${res.status}`);
  return mapGNewsArticles(await res.json(), opts.query);
}
