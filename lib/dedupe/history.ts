import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { IsoDate } from "@/lib/time";
import { ACTIVE_RULE, type DedupeRule, judgePair } from "./engine";
import { extractEntities, normalizeTitle } from "./normalize";
import { similarityOfSets, trigrams } from "./trigram";

/** One story that went out in one of the last four SENT issues. */
export interface LastFourEntry {
  issueId: string;
  issueDate: IsoDate;
  headline: string;
  title: string;
  canonicalHash: string;
  entities: string[];
  /** Trigram sets of the normalised article title and the (possibly edited) headline. */
  titleTri: Set<string>;
  headlineTri: Set<string>;
}

export function buildLastFourEntry(row: {
  issueId: string;
  issueDate: IsoDate;
  headline: string;
  title: string;
  canonicalHash: string;
}): LastFourEntry {
  const entities = [...new Set([...extractEntities(row.title), ...extractEntities(row.headline)])];
  return {
    ...row,
    entities,
    titleTri: trigrams(normalizeTitle(row.title)),
    headlineTri: trigrams(normalizeTitle(row.headline)),
  };
}

/**
 * Stories (live picks, not swapped out) of the four most recent SENT issues
 * before `beforeIssueDate`. Entities are recomputed from text so they never
 * go stale when extraction rules change.
 */
export async function loadLastFourSet(beforeIssueDate: IsoDate): Promise<LastFourEntry[]> {
  const { rows } = await db().execute(sql`
    with last_four as (
      select id, issue_date from issues
      where status = 'SENT' and issue_date < ${beforeIssueDate}
      order by issue_date desc limit 4
    )
    select lf.id as issue_id, lf.issue_date::text as issue_date, s.headline, a.title, a.canonical_hash
    from last_four lf
    join issue_stories s on s.issue_id = lf.id
    join articles a on a.id = s.article_id
    where s.role = 'pick' and s.state <> 'SWAPPED_OUT'`);
  return rows.map((r) =>
    buildLastFourEntry({
      issueId: String(r.issue_id),
      issueDate: String(r.issue_date),
      headline: String(r.headline),
      title: String(r.title),
      canonicalHash: String(r.canonical_hash),
    }),
  );
}

export interface LastFourHit {
  entry: LastFourEntry;
  similarity: number;
  shared: number;
  exactUrl: boolean;
}

/** Best Last-4 match for an article: exact canonical URL, or the dedupe rule on title or headline. */
export function matchLastFour(
  article: { titleNorm: string; entities: string[]; canonicalHash: string },
  set: readonly LastFourEntry[],
  rule: DedupeRule = ACTIVE_RULE,
): LastFourHit | null {
  const tri = trigrams(article.titleNorm);
  let best: LastFourHit | null = null;
  for (const entry of set) {
    if (entry.canonicalHash === article.canonicalHash) {
      return { entry, similarity: 1, shared: entry.entities.length, exactUrl: true };
    }
    const similarity = Math.max(similarityOfSets(tri, entry.titleTri), similarityOfSets(tri, entry.headlineTri));
    const { duplicate, shared } = judgePair(similarity, article.entities, entry.entities, rule);
    if (duplicate && (!best || similarity > best.similarity)) best = { entry, similarity, shared, exactUrl: false };
  }
  return best;
}
