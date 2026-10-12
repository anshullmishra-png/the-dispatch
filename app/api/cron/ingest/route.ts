import { NextResponse } from "next/server";
import { runIngest } from "@/lib/collect";
import { env } from "@/lib/env";
import { getOrCreateIssue } from "@/lib/issues";
import { createLogger } from "@/lib/log";
import { finishRun, hasBlockingRun, startRun } from "@/lib/runs";
import { isAuthorizedBearer, isVercelCron } from "@/lib/security";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const log = createLogger({ route: "cron/ingest" });
  if (!isAuthorizedBearer(req, env().CRON_SECRET)) {
    log.warn("unauthorised cron call");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const force = new URL(req.url).searchParams.get("force") === "1";
  const trigger = isVercelCron(req) ? "cron" : "manual";
  const now = new Date();
  const issue = await getOrCreateIssue("ingest", now);

  if (!force) {
    const blocking = await hasBlockingRun("ingest", issue.id, now);
    if (blocking) {
      log.info("ingest skipped", { reason: blocking, issueDate: issue.issueDate });
      return NextResponse.json({ ok: true, skipped: true, reason: blocking, issueDate: issue.issueDate });
    }
  }

  const runId = await startRun("ingest", issue.id, trigger);
  const runLog = log.child({ runId, issueDate: issue.issueDate });
  try {
    const stats = await runIngest(issue, { log: runLog, now });
    await finishRun(runId, { ok: true, stats });
    const { processed, duplicate, seenBefore, candidate } = stats.dedupe;
    const dedupe = { processed, duplicate, seenBefore, candidate };
    runLog.info("ingest finished", { totals: stats.totals, gnews: stats.gnews, dedupe });
    return NextResponse.json({ ok: true, runId, issueDate: issue.issueDate, totals: stats.totals, gnews: stats.gnews, dedupe });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(runId, { ok: false, error: message });
    runLog.error("ingest failed", { err });
    return NextResponse.json({ ok: false, runId, error: "ingest_failed" }, { status: 500 });
  }
}
