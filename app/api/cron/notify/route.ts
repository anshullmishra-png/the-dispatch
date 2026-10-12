import { NextResponse } from "next/server";
import { draftDeliverable, loadDraftShape, transition } from "@/lib/approval/fsm";
import { configuredFeatures, env } from "@/lib/env";
import { getOrCreateIssue } from "@/lib/issues";
import { createLogger } from "@/lib/log";
import { finishRun, hasBlockingRun, startRun } from "@/lib/runs";
import { isAuthorizedBearer, isVercelCron } from "@/lib/security";
import { TelegramError } from "@/lib/telegram/api";
import { alertShreya, deliverDraft, shreyaChatId } from "@/lib/telegram/deliver";
import { formatIssueDateShort } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Statuses whose cards can be (re)delivered with ?force=1. Only DRAFTING moves to IN_REVIEW. */
const REDELIVERABLE = new Set(["DRAFTING", "IN_REVIEW", "HELD", "CONFIRMED"]);

export async function GET(req: Request) {
  const log = createLogger({ route: "cron/notify" });
  if (!isAuthorizedBearer(req, env().CRON_SECRET)) {
    log.warn("unauthorised cron call");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const f = configuredFeatures();
  if (!f.telegram || !f.telegramAllowlist) {
    return NextResponse.json({ ok: false, error: "telegram_not_configured" }, { status: 503 });
  }

  const force = new URL(req.url).searchParams.get("force") === "1";
  const now = new Date();
  const issue = await getOrCreateIssue("notify", now);
  const date = formatIssueDateShort(issue.issueDate);

  if (issue.status === "IN_REVIEW" && !force) {
    return NextResponse.json({ ok: true, skipped: true, reason: "already_notified", issueDate: issue.issueDate });
  }
  if (issue.status !== "COLLECTING" && !(issue.status === "DRAFTING" || (force && REDELIVERABLE.has(issue.status)))) {
    return NextResponse.json({ ok: false, skipped: true, reason: `issue_${issue.status.toLowerCase()}`, issueDate: issue.issueDate }, { status: 409 });
  }
  if (!force) {
    const blocking = await hasBlockingRun("notify", issue.id, now);
    if (blocking) return NextResponse.json({ ok: true, skipped: true, reason: blocking, issueDate: issue.issueDate });
  }

  const runId = await startRun("notify", issue.id, isVercelCron(req) ? "cron" : "manual");
  const runLog = log.child({ runId, issueDate: issue.issueDate });
  const fail = async (status: number, error: string, alert?: { title: string; body: string[] }) => {
    if (alert) await alertShreya(issue.id, alert.title, alert.body, runLog);
    await finishRun(runId, { ok: false, error });
    return NextResponse.json({ ok: false, runId, error, issueDate: issue.issueDate }, { status });
  };

  try {
    if (issue.status === "COLLECTING") {
      return await fail(409, "no_draft", { title: `No draft for ${date}`, body: ["The curate job hasn't produced a draft. Check the dashboard or re-run curate."] });
    }
    const shape = await loadDraftShape(issue.id);
    if (!draftDeliverable(shape)) {
      return await fail(409, "draft_not_deliverable", {
        title: `Draft for ${date} can't be reviewed`,
        body: [`It has ${shape.livePicks} picks across ${shape.topics} topics. Re-run curate.`],
      });
    }
    const { messages } = await deliverDraft(issue.id, shreyaChatId());
    const moved = issue.status === "DRAFTING" ? await transition(issue.id, "notify") : null;
    const stats = { messages, picks: shape.livePicks, topics: shape.topics, needsAttention: shape.needsAttention, redelivered: !moved };
    await finishRun(runId, { ok: true, stats });
    runLog.info("draft delivered", stats);
    return NextResponse.json({ ok: true, runId, issueDate: issue.issueDate, status: moved?.to ?? issue.status, ...stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(runId, { ok: false, error: message });
    runLog.error("notify failed", { err });
    // docs/02 failure table: after one retry, log and mark the run failed ("draft not delivered").
    const error = err instanceof TelegramError ? "telegram_send_failed" : "notify_failed";
    return NextResponse.json({ ok: false, runId, error }, { status: err instanceof TelegramError ? 502 : 500 });
  }
}
