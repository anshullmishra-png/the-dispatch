import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { pipelineRuns } from "@/db/schema";
import { db } from "@/lib/db";
import type { Job } from "@/lib/issues";
import { istDate, istToUtc } from "@/lib/time";

export type Trigger = "cron" | "manual" | "demo";

/** A run with no finish time older than this is treated as crashed, not running. */
const STALE_RUN_MS = 10 * 60_000;

/**
 * ingest runs once per IST day (Mon–Wed for the same issue); every other job
 * runs once per issue.
 */
export function idempotencyScope(job: Job): "day" | "issue" {
  return job === "ingest" ? "day" : "issue";
}

/**
 * True if this job already succeeded for the issue (in its scope), or a run is
 * in flight right now. Guards against Vercel's best-effort cron double-delivery.
 */
export async function hasBlockingRun(job: Job, issueId: string, now: Date): Promise<false | "already_ok" | "in_progress"> {
  const since = idempotencyScope(job) === "day" ? istToUtc(istDate(now)) : new Date(0);
  const staleBefore = new Date(now.getTime() - STALE_RUN_MS);
  const [run] = await db()
    .select({ ok: pipelineRuns.ok, finishedAt: pipelineRuns.finishedAt })
    .from(pipelineRuns)
    .where(
      and(
        eq(pipelineRuns.job, job),
        eq(pipelineRuns.issueId, issueId),
        gte(pipelineRuns.startedAt, since),
        or(eq(pipelineRuns.ok, true), and(isNull(pipelineRuns.finishedAt), gte(pipelineRuns.startedAt, staleBefore))),
      ),
    )
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(1);
  if (!run) return false;
  return run.finishedAt === null ? "in_progress" : "already_ok";
}

export async function startRun(job: Job, issueId: string | null, trigger: Trigger): Promise<string> {
  const [row] = await db().insert(pipelineRuns).values({ job, issueId, trigger }).returning({ id: pipelineRuns.id });
  if (!row) throw new Error("failed to record pipeline run");
  return row.id;
}

export async function finishRun(
  id: string,
  result: { ok: boolean; stats?: unknown; error?: string },
): Promise<void> {
  await db()
    .update(pipelineRuns)
    .set({
      finishedAt: sql`now()`,
      ok: result.ok,
      stats: result.stats ?? null,
      error: result.error?.slice(0, 1000) ?? null,
    })
    .where(eq(pipelineRuns.id, id));
}
