// The confirmed content of an issue, as the email (and web view) shows it.
import { and, asc, eq, ne } from "drizzle-orm";
import { articles, issues, issueStories } from "@/db/schema";
import { db } from "@/lib/db";
import type { IssueEmail } from "./render";

export async function loadIssueEmail(issueId: string): Promise<IssueEmail & { id: string; status: string }> {
  const [issue] = await db()
    .select({ id: issues.id, issueDate: issues.issueDate, subject: issues.subject, status: issues.status })
    .from(issues)
    .where(eq(issues.id, issueId));
  if (!issue) throw new Error(`issue ${issueId} not found`);
  const stories = await db()
    .select({
      position: issueStories.position,
      topic: issueStories.topic,
      headline: issueStories.headline,
      commentary: issueStories.commentaryFinal,
      url: articles.url,
      publisher: articles.publisher,
    })
    .from(issueStories)
    .innerJoin(articles, eq(articles.id, issueStories.articleId))
    .where(and(eq(issueStories.issueId, issueId), eq(issueStories.role, "pick"), ne(issueStories.state, "SWAPPED_OUT")))
    .orderBy(asc(issueStories.position));
  return {
    id: issue.id,
    status: issue.status,
    issueDate: issue.issueDate,
    subject: issue.subject ?? `The Dispatch · ${issue.issueDate}`,
    stories: stories.map((s) => ({ ...s, position: s.position ?? 0 })),
  };
}
