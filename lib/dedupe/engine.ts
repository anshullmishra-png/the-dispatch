// Pure duplicate-detection rules (docs/05-INTEGRATIONS.md §2). No I/O.

export interface DedupeRule {
  /** At or above: duplicate on similarity alone. */
  identical: number;
  /** At or above: duplicate with at least `strongMinShared` shared entities. */
  strong: number;
  strongMinShared: number;
  /** At or above: duplicate with at least `weakMinShared` shared entities. */
  weak: number;
  weakMinShared: number;
  /** Count only distinctive entities (not "Q2", "results", years, dates…). */
  distinctiveOnly: boolean;
}

/** Thresholds exactly as written in docs/05 §2 (before calibration). */
export const DOC_RULE: DedupeRule = {
  identical: 0.6,
  strong: 0.6,
  strongMinShared: 0,
  weak: 0.45,
  weakMinShared: 2,
  distinctiveOnly: false,
};

/**
 * Calibrated on 509 real articles (2026-10-12) and approved by the user:
 * cross-outlet rewrites of one story score 0.30–0.45, which DOC_RULE misses,
 * while template headlines ("X Q2 Results: Net profit…") share only generic words.
 */
export const CALIBRATED_RULE: DedupeRule = {
  identical: 0.85,
  strong: 0.6,
  strongMinShared: 1,
  weak: 0.3,
  weakMinShared: 2,
  distinctiveOnly: true,
};

/** The rule the pipeline uses. */
export const ACTIVE_RULE = CALIBRATED_RULE;

// Words that headlines share without being about the same story.
const GENERIC_WORDS = new Set([
  "results", "result", "update", "updates", "net", "profit", "profits", "loss", "losses", "revenue",
  "earnings", "ipo", "ipos", "price", "band", "share", "shares", "stock", "stocks", "sensex", "nifty",
  "rupee", "dollar", "us", "u.s", "usa", "uk", "gst", "rbi", "sebi", "council", "govt", "government",
  "centre", "minister", "latest", "interest", "rates", "rate", "today", "ai", "tech", "funding",
  "updated", "weekly", "data", "report", "q", "fy",
]);
const GENERIC_CODE = /^(?:q[1-4]|h[12]|fy\d{2,4}|q[1-4]fy\d{2,4})$/;

/** False for entities made only of generic words, years, and small bare numbers (dates, counts). */
export function isDistinctiveEntity(entity: string): boolean {
  const ws = entity.split(" ").filter(Boolean);
  if (ws.length === 0) return false;
  if (ws.length === 1) {
    const w = ws[0] as string;
    if (/^\d+$/.test(w)) {
      const n = Number(w);
      return !(n <= 31 || (n >= 1900 && n <= 2099));
    }
  }
  return ws.some((w) => !GENERIC_WORDS.has(w) && !GENERIC_CODE.test(w) && !/^\d{1,2}$/.test(w));
}

const words = (entity: string) => entity.split(" ").filter(Boolean);

/** True when one entity's words are all contained in the other's ("ai-focused bytexl" ~ "bytexl"). */
function entitiesMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const longWords = new Set(words(long));
  return words(short).every((w) => longWords.has(w));
}

/** Entities of `a` that match some entity of `b`; each `b` entity is used at most once. */
export function sharedEntityCount(
  a: readonly string[],
  b: readonly string[],
  opts: { distinctiveOnly?: boolean } = {},
): number {
  const keep = (e: string) => !opts.distinctiveOnly || isDistinctiveEntity(e);
  const left = a.filter(keep);
  const right = b.filter(keep);
  const used = new Set<number>();
  let count = 0;
  for (const ea of left) {
    const j = right.findIndex((eb, idx) => !used.has(idx) && entitiesMatch(ea, eb));
    if (j >= 0) {
      used.add(j);
      count += 1;
    }
  }
  return count;
}

export function isDuplicate(similarity: number, sharedEntities: number, rule: DedupeRule = ACTIVE_RULE): boolean {
  if (similarity >= rule.identical) return true;
  if (similarity >= rule.strong && sharedEntities >= rule.strongMinShared) return true;
  return similarity >= rule.weak && sharedEntities >= rule.weakMinShared;
}

/** Shared-entity count as the rule defines it, then the verdict. */
export function judgePair(
  similarity: number,
  a: readonly string[],
  b: readonly string[],
  rule: DedupeRule = ACTIVE_RULE,
): { duplicate: boolean; shared: number } {
  const shared = sharedEntityCount(a, b, { distinctiveOnly: rule.distinctiveOnly });
  return { duplicate: isDuplicate(similarity, shared, rule), shared };
}

export interface ComparableArticle {
  id: string;
  publishedAt: Date;
  entities: string[];
  /** Root of this article's duplicate cluster, if it is itself a duplicate. */
  duplicateOf: string | null;
}

export interface ScoredMatch extends ComparableArticle {
  similarity: number;
}

/**
 * Among earlier articles that satisfy the rule, returns the cluster root of the
 * earliest one, with the best score seen for that root.
 */
export function chooseDuplicateRoot(
  article: Pick<ComparableArticle, "entities">,
  matches: readonly ScoredMatch[],
  rule: DedupeRule = ACTIVE_RULE,
): { rootId: string; similarity: number; shared: number } | null {
  let best: { rootId: string; publishedAt: number; similarity: number; shared: number } | null = null;
  for (const m of matches) {
    const { duplicate, shared } = judgePair(m.similarity, article.entities, m.entities, rule);
    if (!duplicate) continue;
    const rootId = m.duplicateOf ?? m.id;
    const t = m.publishedAt.getTime();
    if (!best || t < best.publishedAt || (t === best.publishedAt && m.similarity > best.similarity)) {
      best = { rootId, publishedAt: t, similarity: m.similarity, shared };
    }
  }
  return best ? { rootId: best.rootId, similarity: best.similarity, shared: best.shared } : null;
}

export interface ClusterMember {
  id: string;
  duplicateOf: string | null;
  publishedAt: Date | null;
  snippet: string | null;
}

/**
 * One article per duplicate cluster, for the Gemini call: earliest published,
 * tie-break longest snippet (docs/05 §2).
 */
export function pickRepresentatives<T extends ClusterMember>(members: readonly T[]): T[] {
  const byRoot = new Map<string, T>();
  for (const m of members) {
    const root = m.duplicateOf ?? m.id;
    const current = byRoot.get(root);
    if (!current || isBetterRepresentative(m, current)) byRoot.set(root, m);
  }
  return [...byRoot.values()];
}

function isBetterRepresentative(a: ClusterMember, b: ClusterMember): boolean {
  const ta = a.publishedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const tb = b.publishedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta < tb;
  return (a.snippet?.length ?? 0) > (b.snippet?.length ?? 0);
}
