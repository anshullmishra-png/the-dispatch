import { eq, sql } from "drizzle-orm";
import { articles, type Issue, type NewArticle, type Source, sources } from "@/db/schema";
import { db } from "@/lib/db";
import { canonicalizeUrl, hashUrl } from "@/lib/dedupe/canonical";
import { extractEntities, normalizeTitle } from "@/lib/dedupe/normalize";
import { env } from "@/lib/env";
import type { Logger } from "@/lib/log";
import { GNewsQuotaError, searchGNews } from "./gnews";
import { mapSettled } from "./limit";
import { collectRss, userAgent } from "./rss";
import type { CollectedItem } from "./types";

export const RSS_CONCURRENCY = 6;
export const GNEWS_SPACING_MS = 1_200;
/** A source auto-pauses after this many consecutive failed runs (docs/02 §8). */
export const MAX_CONSECUTIVE_FAILURES = 5;

export interface CollectDeps {
  rss: (url: string, name: string) => Promise<CollectedItem[]>;
  /** Undefined when NEWS_API_KEY is not configured. */
  gnews?: (query: string, from: Date) => Promise<CollectedItem[]>;
  sleep: (ms: number) => Promise<void>;
}

type SourceRef = Pick<Source, "id" | "kind" | "name" | "urlOrQuery">;

export type SourceOutcome =
  | { source: SourceRef; status: "ok"; items: CollectedItem[]; ms: number }
  | { source: SourceRef; status: "failed"; error: string; ms: number }
  | { source: SourceRef; status: "skipped"; reason: "gnews_quota" | "gnews_not_configured" };

/** Fetches every source; one failing source never stops the others. */
export async function collectAll(
  list: SourceRef[],
  window: { start: Date },
  deps: CollectDeps,
): Promise<{ outcomes: SourceOutcome[]; gnewsRequests: number; gnewsStopped: string | null }> {
  const rss = list.filter((s) => s.kind === "rss");
  const gnews = list.filter((s) => s.kind === "gnews");

  const rssResults = await mapSettled(rss, RSS_CONCURRENCY, async (s) => {
    const started = Date.now();
    const items = await deps.rss(s.urlOrQuery, s.name);
    return { items, ms: Date.now() - started };
  });
  const outcomes: SourceOutcome[] = rss.map((source, i) => {
    const r = rssResults[i];
    if (r?.status === "fulfilled") return { source, status: "ok", items: r.value.items, ms: r.value.ms };
    const error = r?.reason instanceof Error ? r.reason.message : String(r?.reason);
    return { source, status: "failed", error: error.split("\n")[0]?.slice(0, 300) ?? "unknown", ms: 0 };
  });

  let gnewsRequests = 0;
  let gnewsStopped: string | null = deps.gnews ? null : "not_configured";
  for (const source of gnews) {
    if (!deps.gnews || gnewsStopped) {
      outcomes.push({ source, status: "skipped", reason: deps.gnews ? "gnews_quota" : "gnews_not_configured" });
      continue;
    }
    if (gnewsRequests > 0) await deps.sleep(GNEWS_SPACING_MS);
    const started = Date.now();
    gnewsRequests += 1;
    try {
      const items = await deps.gnews(source.urlOrQuery, window.start);
      outcomes.push({ source, status: "ok", items, ms: Date.now() - started });
    } catch (err) {
      if (err instanceof GNewsQuotaError) {
        gnewsStopped = `quota (HTTP ${err.status})`;
        outcomes.push({ source, status: "skipped", reason: "gnews_quota" });
      } else {
        outcomes.push({ source, status: "failed", error: (err as Error).message.slice(0, 300), ms: Date.now() - started });
      }
    }
  }
  return { outcomes, gnewsRequests, gnewsStopped };
}

export interface PrepareCounts {
  fetched: number;
  inWindow: number;
  outOfWindow: number;
  undated: number;
  invalidUrl: number;
  duplicateInBatch: number;
}

/**
 * Keeps items published inside the issue window (undated items take the fetch
 * time and are flagged), canonicalises URLs and drops in-batch repeats.
 */
export function prepareItems(
  items: CollectedItem[],
  ctx: { issueId: string; sourceId: string; window: { start: Date; end: Date }; fetchedAt: Date },
): { rows: NewArticle[]; counts: PrepareCounts } {
  const counts: PrepareCounts = { fetched: items.length, inWindow: 0, outOfWindow: 0, undated: 0, invalidUrl: 0, duplicateInBatch: 0 };
  const rows: NewArticle[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const dateMissing = item.publishedAt === null;
    const publishedAt = item.publishedAt ?? ctx.fetchedAt;
    if (publishedAt < ctx.window.start || publishedAt > ctx.window.end) {
      counts.outOfWindow += 1;
      continue;
    }
    let canonicalUrl: string;
    try {
      canonicalUrl = canonicalizeUrl(item.url);
    } catch {
      counts.invalidUrl += 1;
      continue;
    }
    const canonicalHash = hashUrl(canonicalUrl);
    if (seen.has(canonicalHash)) {
      counts.duplicateInBatch += 1;
      continue;
    }
    seen.add(canonicalHash);
    if (dateMissing) counts.undated += 1;
    counts.inWindow += 1;
    rows.push({
      issueId: ctx.issueId,
      sourceId: ctx.sourceId,
      url: item.url,
      canonicalUrl,
      canonicalHash,
      title: item.title,
      titleNorm: normalizeTitle(item.title),
      snippet: item.snippet,
      publisher: item.publisher,
      publishedAt,
      fetchedAt: ctx.fetchedAt,
      entities: extractEntities(item.title),
      status: "new",
      raw: { ...item.raw, ...(dateMissing ? { date_missing: true } : {}) },
    });
  }
  return { rows, counts };
}

export interface SourceStat extends Partial<PrepareCounts> {
  sourceId: string;
  name: string;
  kind: string;
  status: SourceOutcome["status"];
  inserted?: number;
  known?: number;
  error?: string;
  reason?: string;
  ms?: number;
  paused?: boolean;
}

export interface IngestStats {
  issueDate: string;
  window: { start: string; end: string };
  totals: { sources: number; ok: number; failed: number; skipped: number; fetched: number; inWindow: number; inserted: number; known: number };
  gnews: { requests: number; stopped: string | null };
  sources: SourceStat[];
  durationMs: number;
}

function defaultDeps(): CollectDeps {
  const e = env();
  const ua = userAgent(e.APP_URL);
  const apikey = e.NEWS_API_KEY;
  return {
    rss: (url, name) => collectRss(url, name, ua),
    gnews: apikey ? (query, from) => searchGNews({ apikey, query, from }) : undefined,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

async function recordHealth(outcome: SourceOutcome, now: Date): Promise<boolean> {
  if (outcome.status === "skipped") return false;
  if (outcome.status === "ok") {
    await db()
      .update(sources)
      .set({ consecutiveFailures: 0, lastOkAt: now, lastError: null })
      .where(eq(sources.id, outcome.source.id));
    return false;
  }
  const [row] = await db()
    .update(sources)
    .set({
      consecutiveFailures: sql`${sources.consecutiveFailures} + 1`,
      lastError: outcome.error,
      active: sql`${sources.consecutiveFailures} + 1 < ${MAX_CONSECUTIVE_FAILURES}`,
    })
    .where(eq(sources.id, outcome.source.id))
    .returning({ active: sources.active });
  return row ? !row.active : false;
}

/** Fetch every active source, store new articles for `issue`, update source health. */
export async function runIngest(issue: Issue, opts: { log: Logger; deps?: CollectDeps; now?: Date }): Promise<IngestStats> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const window = { start: issue.windowStart, end: issue.windowEnd };
  const active = await db()
    .select({ id: sources.id, kind: sources.kind, name: sources.name, urlOrQuery: sources.urlOrQuery })
    .from(sources)
    .where(eq(sources.active, true))
    .orderBy(sources.kind, sources.name);

  const { outcomes, gnewsRequests, gnewsStopped } = await collectAll(active, window, opts.deps ?? defaultDeps());

  const stats: SourceStat[] = [];
  for (const outcome of outcomes) {
    const base = { sourceId: outcome.source.id, name: outcome.source.name, kind: outcome.source.kind, status: outcome.status };
    if (outcome.status === "ok") {
      const { rows, counts } = prepareItems(outcome.items, { issueId: issue.id, sourceId: outcome.source.id, window, fetchedAt: now });
      const inserted = rows.length
        ? await db().insert(articles).values(rows).onConflictDoNothing({ target: articles.canonicalHash }).returning({ id: articles.id })
        : [];
      stats.push({ ...base, ...counts, inserted: inserted.length, known: rows.length - inserted.length, ms: outcome.ms });
    } else if (outcome.status === "failed") {
      stats.push({ ...base, error: outcome.error });
      opts.log.warn("source failed", { source: outcome.source.name, error: outcome.error });
    } else {
      stats.push({ ...base, reason: outcome.reason });
    }
    const paused = await recordHealth(outcome, now);
    if (paused) {
      const last = stats[stats.length - 1];
      if (last) last.paused = true;
      opts.log.warn("source auto-paused", { source: outcome.source.name });
    }
  }

  const sum = (k: "fetched" | "inWindow" | "inserted" | "known") => stats.reduce((n, s) => n + (s[k] ?? 0), 0);
  return {
    issueDate: issue.issueDate,
    window: { start: window.start.toISOString(), end: window.end.toISOString() },
    totals: {
      sources: stats.length,
      ok: stats.filter((s) => s.status === "ok").length,
      failed: stats.filter((s) => s.status === "failed").length,
      skipped: stats.filter((s) => s.status === "skipped").length,
      fetched: sum("fetched"),
      inWindow: sum("inWindow"),
      inserted: sum("inserted"),
      known: sum("known"),
    },
    gnews: { requests: gnewsRequests, stopped: gnewsStopped },
    sources: stats,
    durationMs: Date.now() - started,
  };
}
