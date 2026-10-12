// Read-only data for the public pages. Counts only: no subscriber emails leave here.
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { articles, issues, issueStories, pipelineRuns, sources, styleExamples, subscribers } from "@/db/schema";
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
    },
    topicCounts,
    runs,
    sources: sourceRows,
    subscribers: subs,
    voice: { total: voice?.total ?? 0, unedited: voice?.unedited ?? 0 },
  };
}

export type DashboardData = Awaited<ReturnType<typeof dashboardData>>;
