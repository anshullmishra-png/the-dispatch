import { and, asc, eq, sql } from "drizzle-orm";
import { articles, type Issue } from "@/db/schema";
import { db } from "@/lib/db";
import type { Logger } from "@/lib/log";
import { ACTIVE_RULE, chooseDuplicateRoot, type ScoredMatch } from "./engine";
import { loadLastFourSet, matchLastFour } from "./history";

const MAX_WINDOW_MATCHES = 25;
const SAMPLE_PAIRS = 10;

export interface MatchSample {
  kind: "duplicate" | "seen_before";
  title: string;
  matchedTitle: string;
  similarity: number;
  shared: number;
  matchedIssueDate?: string;
}

export interface DedupeStats {
  processed: number;
  duplicate: number;
  seenBefore: number;
  candidate: number;
  lastFourStories: number;
  samples: MatchSample[];
  durationMs: number;
}

/**
 * Classifies every `new` article of the issue (docs/05 §2, calibrated rule):
 * within-window duplicate → Last-4 `seen_before` → `candidate`.
 * Articles are processed in publish order and each result is written before the
 * next, so later articles can match earlier ones from the same run.
 */
export async function classifyNewArticles(issue: Issue, opts: { log: Logger }): Promise<DedupeStats> {
  const started = Date.now();
  const lastFour = await loadLastFourSet(issue.issueDate);
  const pending = await db()
    .select({
      id: articles.id,
      title: articles.title,
      titleNorm: articles.titleNorm,
      entities: articles.entities,
      canonicalHash: articles.canonicalHash,
    })
    .from(articles)
    .where(and(eq(articles.issueId, issue.id), eq(articles.status, "new")))
    .orderBy(asc(articles.publishedAt), asc(articles.fetchedAt), asc(articles.id));

  const stats: DedupeStats = {
    processed: 0,
    duplicate: 0,
    seenBefore: 0,
    candidate: 0,
    lastFourStories: lastFour.length,
    samples: [],
    durationMs: 0,
  };

  for (const a of pending) {
    // `%` is pg_trgm's indexed similarity filter (threshold 0.3 = the rule's weak floor).
    const { rows } = await db().execute(sql`
      select id, title, published_at, entities, duplicate_of, similarity(title_norm, ${a.titleNorm})::float as score
      from articles
      where issue_id = ${issue.id} and id <> ${a.id} and status <> 'new' and title_norm % ${a.titleNorm}
      order by score desc
      limit ${MAX_WINDOW_MATCHES}`);
    const matches: (ScoredMatch & { title: string })[] = rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      publishedAt: new Date(String(r.published_at)),
      entities: (r.entities as string[] | null) ?? [],
      duplicateOf: r.duplicate_of ? String(r.duplicate_of) : null,
      similarity: Number(r.score),
    }));

    const dup = chooseDuplicateRoot(a, matches, ACTIVE_RULE);
    if (dup) {
      await db()
        .update(articles)
        .set({ status: "duplicate", duplicateOf: dup.rootId, similarity: dup.similarity })
        .where(eq(articles.id, a.id));
      stats.duplicate += 1;
      if (stats.samples.length < SAMPLE_PAIRS) {
        const m = matches.find((x) => (x.duplicateOf ?? x.id) === dup.rootId) ?? matches[0];
        stats.samples.push({ kind: "duplicate", title: a.title, matchedTitle: m?.title ?? "?", similarity: dup.similarity, shared: dup.shared });
      }
    } else {
      const hit = matchLastFour(a, lastFour, ACTIVE_RULE);
      if (hit) {
        await db()
          .update(articles)
          .set({ status: "seen_before", seenInIssue: hit.entry.issueId, similarity: hit.similarity })
          .where(eq(articles.id, a.id));
        stats.seenBefore += 1;
        if (stats.samples.filter((s) => s.kind === "seen_before").length < SAMPLE_PAIRS) {
          stats.samples.push({
            kind: "seen_before",
            title: a.title,
            matchedTitle: hit.entry.headline,
            similarity: hit.similarity,
            shared: hit.shared,
            matchedIssueDate: hit.entry.issueDate,
          });
        }
      } else {
        await db().update(articles).set({ status: "candidate" }).where(eq(articles.id, a.id));
        stats.candidate += 1;
      }
    }
    stats.processed += 1;
  }

  stats.durationMs = Date.now() - started;
  opts.log.info("dedupe finished", {
    processed: stats.processed,
    duplicate: stats.duplicate,
    seenBefore: stats.seenBefore,
    candidate: stats.candidate,
  });
  return stats;
}
