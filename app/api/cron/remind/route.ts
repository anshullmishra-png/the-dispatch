import { NextResponse } from "next/server";
import { loadReview } from "@/lib/approval/review";
import { configuredFeatures, env } from "@/lib/env";
import { getOrCreateIssue } from "@/lib/issues";
import { reminderDeadline } from "@/lib/time";
import { createLogger } from "@/lib/log";
import { finishRun, hasBlockingRun, startRun } from "@/lib/runs";
import { isAuthorizedBearer, isVercelCron } from "@/lib/security";
import { renderReminder } from "@/lib/telegram/cards";
import { postCard, shreyaChatId } from "@/lib/telegram/deliver";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * R13: one reminder once Wednesday 10 PM has passed, only while the issue is
 * still IN_REVIEW. Two daily crons call this (21:30–22:29 and 22:30–23:29 IST,
 * Hobby fires anywhere in the hour): a check before 10 PM skips, so the first
 * check at or after 10 PM reminds and the second is the fallback.
 */
export async function GET(req: Request) {
  const log = createLogger({ route: "cron/remind" });
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
  const issue = await getOrCreateIssue("remind", now);
  const deadline = reminderDeadline(issue.issueDate);
  if (now < deadline && !force) {
    return NextResponse.json({ ok: true, skipped: true, reason: "before_10pm_deadline", deadline: deadline.toISOString(), issueDate: issue.issueDate });
  }
  if (issue.status !== "IN_REVIEW") {
    return NextResponse.json({ ok: true, skipped: true, reason: `issue_${issue.status.toLowerCase()}`, issueDate: issue.issueDate });
  }
  if (!force) {
    const blocking = await hasBlockingRun("remind", issue.id, now);
    if (blocking) return NextResponse.json({ ok: true, skipped: true, reason: blocking, issueDate: issue.issueDate });
  }

  const runId = await startRun("remind", issue.id, isVercelCron(req) ? "cron" : "manual");
  try {
    const review = await loadReview(issue.id);
    const messageId = await postCard(shreyaChatId(), issue.id, "reminder", renderReminder(review.summary));
    const stats = { messageId, pending: review.summary.counts.PENDING };
    await finishRun(runId, { ok: true, stats });
    log.info("reminder sent", { runId, ...stats });
    return NextResponse.json({ ok: true, runId, issueDate: issue.issueDate, ...stats });
  } catch (err) {
    await finishRun(runId, { ok: false, error: err instanceof Error ? err.message : String(err) });
    log.error("remind failed", { runId, err });
    return NextResponse.json({ ok: false, runId, error: "remind_failed" }, { status: 502 });
  }
}
