import { after, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getOrCreateIssue } from "@/lib/issues";
import { createLogger } from "@/lib/log";
import { runSend } from "@/lib/mail/run-send";
import { finishRun, hasBlockingRun, startRun } from "@/lib/runs";
import { isAuthorizedBearer, isVercelCron } from "@/lib/security";

export const runtime = "nodejs";
export const maxDuration = 300;
/** Stop claiming batches with this much of maxDuration used, then resume in a fresh invocation. */
const SEND_BUDGET_MS = 240_000;

export async function GET(req: Request) {
  const started = Date.now();
  const log = createLogger({ route: "cron/send" });
  const e = env();
  if (!isAuthorizedBearer(req, e.CRON_SECRET)) {
    log.warn("unauthorised cron call");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const issue = await getOrCreateIssue("send", new Date());
  if (issue.status === "SENT") return NextResponse.json({ ok: true, skipped: true, reason: "already_sent", issueDate: issue.issueDate });
  const params = new URL(req.url).searchParams;
  const resume = params.get("resume") === "1";
  // force skips only the once-per-issue check; the send gate still decides.
  if (!resume && params.get("force") !== "1") {
    const blocking = await hasBlockingRun("send", issue.id, new Date());
    if (blocking) return NextResponse.json({ ok: true, skipped: true, reason: blocking, issueDate: issue.issueDate });
  }

  const runId = await startRun("send", issue.id, isVercelCron(req) ? "cron" : "manual");
  const runLog = log.child({ runId, issueDate: issue.issueDate });
  try {
    const outcome = await runSend(issue, runLog, started + SEND_BUDGET_MS);
    const ok = outcome.kind !== "held";
    await finishRun(runId, { ok, stats: outcome, error: outcome.kind === "held" ? `held: ${outcome.reason}` : undefined });
    if (outcome.kind === "partial" && e.APP_URL && e.CRON_SECRET) {
      // Out of time: continue in a new invocation; send_log rows make it resume where it stopped.
      const next = new URL("/api/cron/send?resume=1", e.APP_URL);
      const secret = e.CRON_SECRET;
      after(() => fetch(next, { headers: { authorization: `Bearer ${secret}` } }).then(() => undefined));
    }
    return NextResponse.json({ ok, runId, issueDate: issue.issueDate, ...outcome }, { status: ok ? 200 : 409 });
  } catch (err) {
    await finishRun(runId, { ok: false, error: err instanceof Error ? err.message : String(err) });
    runLog.error("send failed", { err });
    return NextResponse.json({ ok: false, runId, error: "send_failed" }, { status: 500 });
  }
}
