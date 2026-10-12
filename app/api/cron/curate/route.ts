import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { pipelineRuns } from "@/db/schema";
import { GeminiError } from "@/lib/ai/gemini";
import { DraftExistsError, DraftLockedError, LOCKED_STATUSES, persistDraft } from "@/lib/curate/draft";
import { CurateBlockedError, runSelection, summarize } from "@/lib/curate/select";
import { db } from "@/lib/db";
import { classifyNewArticles } from "@/lib/dedupe/classify";
import { env } from "@/lib/env";
import { getOrCreateIssue } from "@/lib/issues";
import { createLogger } from "@/lib/log";
import { finishRun, hasBlockingRun, startRun } from "@/lib/runs";
import { isAuthorizedBearer, isVercelCron } from "@/lib/security";

export const runtime = "nodejs";
export const maxDuration = 300;
/** Leave headroom under maxDuration for the DB writes after Gemini returns. */
const SELECTION_BUDGET_MS = 260_000;

export async function GET(req: Request) {
  const started = Date.now();
  const log = createLogger({ route: "cron/curate" });
  if (!isAuthorizedBearer(req, env().CRON_SECRET)) {
    log.warn("unauthorised cron call");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const force = new URL(req.url).searchParams.get("force") === "1";
  const now = new Date();
  const issue = await getOrCreateIssue("curate", now);

  if ((LOCKED_STATUSES as readonly string[]).includes(issue.status)) {
    return NextResponse.json({ ok: false, skipped: true, reason: `issue_${issue.status.toLowerCase()}`, issueDate: issue.issueDate }, { status: 409 });
  }
  if (!force) {
    const blocking = await hasBlockingRun("curate", issue.id, now);
    if (blocking) return NextResponse.json({ ok: true, skipped: true, reason: blocking, issueDate: issue.issueDate });
  }
  // Guard (docs/02 §6): at least one successful ingest for this issue.
  const [ingested] = await db()
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.job, "ingest"), eq(pipelineRuns.issueId, issue.id), eq(pipelineRuns.ok, true)))
    .limit(1);
  if (!ingested) {
    return NextResponse.json({ ok: false, skipped: true, reason: "no_ingest", issueDate: issue.issueDate }, { status: 409 });
  }

  const runId = await startRun("curate", issue.id, isVercelCron(req) ? "cron" : "manual");
  const runLog = log.child({ runId, issueDate: issue.issueDate });
  try {
    const dedupe = await classifyNewArticles(issue, { log: runLog });
    const result = await runSelection(issue, { log: runLog, deadline: started + SELECTION_BUDGET_MS });
    const { replaced } = await persistDraft(issue, result, { force });
    const stats = {
      dedupe: { processed: dedupe.processed, duplicate: dedupe.duplicate, seenBefore: dedupe.seenBefore, candidate: dedupe.candidate },
      selection: summarize(result),
      model: result.model,
      styleGuideVersion: result.styleGuideVersion,
      candidatesSent: result.candidatesSent,
      candidatesTotal: result.candidatesTotal,
      usage: result.usage,
      attempts: result.attempts,
      notes: result.notes,
      replacedDraft: replaced,
    };
    await finishRun(runId, { ok: true, stats });
    runLog.info("curate finished", { selection: stats.selection, usage: stats.usage });
    return NextResponse.json({ ok: true, runId, issueDate: issue.issueDate, ...stats, attempts: result.attempts.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(runId, { ok: false, error: message });
    if (err instanceof CurateBlockedError) {
      runLog.warn("curate blocked", { reason: err.reason });
      return NextResponse.json({ ok: false, runId, error: err.reason, message }, { status: 409 });
    }
    if (err instanceof DraftExistsError || err instanceof DraftLockedError) {
      return NextResponse.json({ ok: false, runId, error: err.name, message }, { status: 409 });
    }
    if (err instanceof GeminiError) {
      runLog.error("gemini failed", { kind: err.kind, attempts: err.attempts });
      return NextResponse.json({ ok: false, runId, error: `gemini_${err.kind}`, attempts: err.attempts }, { status: 503 });
    }
    runLog.error("curate failed", { err });
    return NextResponse.json({ ok: false, runId, error: "curate_failed" }, { status: 500 });
  }
}
