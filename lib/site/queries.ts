// Read-only data for the public pages. Counts only: no subscriber emails leave here.
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { articles, issues, issueStories, pipelineRuns, sources, styleExamples, styleGuides, subscribers } from "@/db/schema";
import { db } from "@/lib/db";
import { loadIssueEmail } from "@/lib/mail/content";
import { targetIssueDate } from "@/lib/time";

export async function sentIssues() {
  const rows = await db()
    .select({ id: issues.id, slug: issues.slug, issueDate: issues.issueDate, subject: issues.subject, sentAt: issues.sentAt })
    .from(issues)
    .where(eq(issues.status, "SENT"))
    .orderBy(desc(issues.issueDate));
  if (!rows.length) return [];
  const picks = await db()
    .select({ issueId: issueStories.issueId, topic: issueStories.topic, headline: issueStories.headline, position: issueStories.position })
    .from(issueStories)
    .where(and(inArray(issueStories.issueId, rows.map((r) => r.id)), eq(issueStories.role, "pick"), ne(issueStories.state, "SWAPPED_OUT")))
    .orderBy(asc(issueStories.position));
  return rows.map((r) => {
    const mine = picks.filter((p) => p.issueId === r.id);
    return { ...r, stories: mine.length, topics: [...new Set(mine.map((p) => p.topic))], headlines: mine.map((p) => p.headline) };
  });
}

/** A sent issue for the web view; drafts are never public. */
export async function sentIssueBySlug(slug: string) {
  const [row] = await db().select({ id: issues.id, status: issues.status }).from(issues).where(eq(issues.slug, slug));
  if (!row || row.status !== "SENT") return null;
  return loadIssueEmail(row.id);
}

export async function dashboardData() {
  const [issue] = await db()
    .select({ id: issues.id, issueDate: issues.issueDate, status: issues.status, needsAttention: issues.needsAttention, confirmedAt: issues.confirmedAt, sentAt: issues.sentAt })
    .from(issues)
    .where(eq(issues.issueDate, targetIssueDate(new Date())));

  const articleCounts = issue
    ? Object.fromEntries(
        (
          await db()
            .select({ status: articles.status, n: sql<number>`count(*)::int` })
            .from(articles)
            .where(eq(articles.issueId, issue.id))
            .groupBy(articles.status)
        ).map((r) => [r.status, r.n]),
      )
    : {};
  const picks = issue
    ? await db()
        .select({ topic: issueStories.topic })
        .from(issueStories)
        .where(and(eq(issueStories.issueId, issue.id), eq(issueStories.role, "pick"), ne(issueStories.state, "SWAPPED_OUT")))
    : [];
  const topicCounts: Record<string, number> = {};
  for (const p of picks) topicCounts[p.topic] = (topicCounts[p.topic] ?? 0) + 1;

  const runs = await db().select().from(pipelineRuns).orderBy(desc(pipelineRuns.startedAt)).limit(15);
  const sourceRows = await db()
    .select({ name: sources.name, kind: sources.kind, active: sources.active, lastOkAt: sources.lastOkAt, failures: sources.consecutiveFailures })
    .from(sources)
    .orderBy(asc(sources.kind), asc(sources.name));
  const subs = Object.fromEntries(
    (await db().select({ status: subscribers.status, n: sql<number>`count(*)::int` }).from(subscribers).groupBy(subscribers.status)).map((r) => [r.status, r.n]),
  ) as Record<string, number>;
  const [voice] = await db()
    .select({ total: sql<number>`count(*)::int`, unedited: sql<number>`count(*) filter (where ${styleExamples.similarity} >= 1)::int` })
    .from(styleExamples);

  const sum = (...keys: string[]) => keys.reduce((n, k) => n + ((articleCounts as Record<string, number>)[k] ?? 0), 0);
  return {
    issue: issue ?? null,
    figures: {
      fetched: sum("new", "duplicate", "seen_before", "candidate", "selected", "backup", "rejected"),
      candidates: sum("candidate", "selected", "backup", "rejected"),
      duplicates: sum("duplicate", "seen_before"),
      picked: picks.length,
      /** Not yet picked or ruled out: what a re-curate would consider. */
      eligible: sum("candidate"),
    },
    topicCounts,
    runs,
    sources: sourceRows,
    subscribers: subs,
    voice: { total: voice?.total ?? 0, unedited: voice?.unedited ?? 0 },
  };
}

export type DashboardData = Awaited<ReturnType<typeof dashboardData>>;

// ---------------------------------------------------------------- article library

export const LIBRARY_FILTERS = {
  all: null,
  candidate: ["candidate"],
  picked: ["selected", "backup"],
  duplicate: ["duplicate"],
  seen_before: ["seen_before"],
  rejected: ["rejected"],
} as const;
export type LibraryFilter = keyof typeof LIBRARY_FILTERS;

/** Search text is matched literally: escape LIKE's wildcards and its escape char. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function articleLibrary(filter: LibraryFilter, q: string) {
  const [issue] = await db()
    .select({ id: issues.id, issueDate: issues.issueDate, windowStart: issues.windowStart, windowEnd: issues.windowEnd })
    .from(issues)
    .where(eq(issues.issueDate, targetIssueDate(new Date())));
  if (!issue) return null;
  const counts = Object.fromEntries(
    (
      await db()
        .select({ status: articles.status, n: sql<number>`count(*)::int` })
        .from(articles)
        .where(eq(articles.issueId, issue.id))
        .groupBy(articles.status)
    ).map((r) => [r.status, r.n]),
  ) as Record<string, number>;
  const statuses = LIBRARY_FILTERS[filter];
  const search = q.trim().slice(0, 100);
  const rows = await db().execute<{
    id: string;
    title: string;
    url: string;
    publisher: string | null;
    published_at: string | null;
    status: string;
    similarity: number | null;
    dup_title: string | null;
    seen_issue: string | null;
    source_name: string | null;
  }>(sql`
    select a.id, a.title, a.url, a.publisher, a.published_at, a.status, a.similarity,
           d.title as dup_title, si.issue_date as seen_issue, src.name as source_name
    from articles a
    left join articles d on d.id = a.duplicate_of
    left join issues si on si.id = a.seen_in_issue
    left join sources src on src.id = a.source_id
    where a.issue_id = ${issue.id}
      ${statuses ? sql`and a.status in (${sql.join(statuses.map((s) => sql`${s}::article_status`), sql`, `)})` : sql``}
      ${search ? sql`and a.title ilike ${`%${escapeLike(search)}%`}` : sql``}
    order by a.published_at desc nulls last
    limit 300`);
  return { issue, counts, rows: rows.rows };
}

// ---------------------------------------------------------------- operations

export async function operationsData() {
  const [lastIngest] = await db()
    .select({ finishedAt: pipelineRuns.finishedAt, stats: pipelineRuns.stats })
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.job, "ingest"), eq(pipelineRuns.ok, true)))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(1);
  const [feeds] = await db()
    .select({
      failing: sql<number>`count(*) filter (where ${sources.consecutiveFailures} > 0 and ${sources.active})::int`,
      paused: sql<number>`count(*) filter (where not ${sources.active})::int`,
    })
    .from(sources);
  const delivery = await db().execute<{ issue_date: string; sent_at: string | null; sent: number; skipped: number; failed: number }>(sql`
    select i.issue_date, i.sent_at,
           count(*) filter (where l.status = 'sent')::int as sent,
           count(*) filter (where l.status = 'skipped_demo')::int as skipped,
           count(*) filter (where l.status = 'failed')::int as failed
    from send_log l join issues i on i.id = l.issue_id
    group by i.id order by i.issue_date desc limit 8`);
  return {
    lastIngestAt: lastIngest?.finishedAt ?? null,
    failingFeeds: feeds?.failing ?? 0,
    pausedFeeds: feeds?.paused ?? 0,
    delivery: delivery.rows,
  };
}

export async function activeStyleGuide() {
  const [g] = await db()
    .select({ version: styleGuides.version, content: styleGuides.content, createdAt: styleGuides.createdAt })
    .from(styleGuides)
    .where(eq(styleGuides.active, true));
  return g ?? null;
}
