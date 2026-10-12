import { eq } from "drizzle-orm";
import { type Issue, issues } from "@/db/schema";
import { db } from "@/lib/db";
import { collectingIssueDate, type IsoDate, issueWindow, targetIssueDate } from "@/lib/time";

export type Job = "ingest" | "curate" | "notify" | "remind" | "send";
export const JOBS: readonly Job[] = ["ingest", "curate", "notify", "remind", "send"];

/** ingest collects for next Thursday; the Wed/Thu jobs act on this Thursday. */
export function issueDateForJob(job: Job, now: Date): IsoDate {
  return job === "ingest" ? collectingIssueDate(now) : targetIssueDate(now);
}

export async function getOrCreateIssue(job: Job, now: Date): Promise<Issue> {
  const issueDate = issueDateForJob(job, now);
  const { start, end } = issueWindow(issueDate);
  await db()
    .insert(issues)
    .values({ issueDate, slug: issueDate, status: "COLLECTING", windowStart: start, windowEnd: end })
    .onConflictDoNothing({ target: issues.issueDate });
  const [issue] = await db().select().from(issues).where(eq(issues.issueDate, issueDate));
  if (!issue) throw new Error(`issue ${issueDate} missing after upsert`);
  return issue;
}
