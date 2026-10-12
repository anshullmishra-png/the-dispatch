// The ONLY module allowed to send subscriber email (CLAUDE.md §4). Its first
// action is the send gate. Algorithm: docs/05-INTEGRATIONS.md §4.
import { and, eq, inArray, sql } from "drizzle-orm";
import { Resend } from "resend";
import { issues, sendLog, subscribers } from "@/db/schema";
import { assertSendAllowed, transition } from "@/lib/approval/fsm";
import { db } from "@/lib/db";
import { env, requireEnv } from "@/lib/env";
import type { Logger } from "@/lib/log";
import { loadIssueEmail } from "./content";
import { renderIssueHtml, renderIssueText } from "./render";
import { makeUnsubToken, unsubscribeUrls } from "./tokens";

export const BATCH_SIZE = 100;
/** Resend allows 10 req/s per team; stay far below it (docs/05 §4). */
export const BATCH_SPACING_MS = 600;

/** Resend's own test inboxes (docs/05 §4), approved for real sends in demo mode. */
const RESEND_TEST = /^(delivered|bounced|complained)(\+[^@]*)?@resend\.dev$/i;

/**
 * Demo mode: only SEND_ALLOWLIST and Resend test inboxes get real mail; every
 * other subscriber is logged as skipped_demo. Outside demo mode, everyone does.
 */
export function shouldReallySend(email: string, demoMode: boolean, allowlist: readonly string[]): boolean {
  if (!demoMode) return true;
  const e = email.toLowerCase();
  return allowlist.includes(e) || RESEND_TEST.test(e);
}

export interface SendReport {
  complete: boolean;
  batches: number;
  counts: Record<string, number>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sendIssue(
  issueId: string,
  opts: { log: Logger; deadline?: number; resuming?: boolean },
): Promise<SendReport> {
  await assertSendAllowed(issueId, { resuming: opts.resuming });

  const { RESEND_API_KEY, MAIL_FROM, APP_URL, UNSUB_SIGNING_KEY } = requireEnv("RESEND_API_KEY", "MAIL_FROM", "APP_URL", "UNSUB_SIGNING_KEY");
  const { DEMO_MODE, SEND_ALLOWLIST, MAIL_REPLY_TO } = env();
  const deadline = opts.deadline ?? Date.now() + 240_000;
  const resend = new Resend(RESEND_API_KEY);
  const issue = await loadIssueEmail(issueId);
  // The key names the confirmed content, so a retry of this batch dedupes at Resend
  // but a re-confirmed (changed) issue never collides with an earlier send.
  const [{ contentHash } = { contentHash: null }] = await db().select({ contentHash: issues.contentHash }).from(issues).where(eq(issues.id, issueId));
  const keyPrefix = `${issueId}-${(contentHash ?? "nohash").slice(0, 12)}`;
  if (issue.status === "CONFIRMED") await transition(issueId, "start_send");

  const [{ maxBatch } = { maxBatch: 0 }] = await db()
    .select({ maxBatch: sql<number>`coalesce(max(${sendLog.batchNo}), 0)::int` })
    .from(sendLog)
    .where(eq(sendLog.issueId, issueId));
  let batchNo = maxBatch;
  let batches = 0;
  let complete = false;

  while (Date.now() < deadline) {
    batchNo += 1;
    // Claim: the unique (issue_id, subscriber_id) row makes a re-run or an
    // overlapping run skip anyone already claimed, so nobody gets two copies.
    const claimed = await db().execute<{ subscriber_id: string }>(sql`
      insert into send_log (issue_id, subscriber_id, batch_no, status)
      select ${issueId}, s.id, ${batchNo}, 'queued' from subscribers s
      where s.status = 'active'
        and not exists (select 1 from send_log l where l.issue_id = ${issueId} and l.subscriber_id = s.id)
      order by s.created_at, s.id
      limit ${BATCH_SIZE}
      on conflict (issue_id, subscriber_id) do nothing
      returning subscriber_id`);
    const ids = claimed.rows.map((r) => r.subscriber_id);
    if (ids.length === 0) {
      complete = true;
      break;
    }
    batches += 1;
    const subs = await db().select({ id: subscribers.id, email: subscribers.email }).from(subscribers).where(inArray(subscribers.id, ids));
    const real = subs.filter((s) => shouldReallySend(s.email, DEMO_MODE, SEND_ALLOWLIST));
    const skipped = subs.filter((s) => !real.includes(s)).map((s) => s.id);
    const rows = (status: "sent" | "skipped_demo" | "failed", subIds: string[], extra: { resendId?: string; error?: string } = {}) =>
      subIds.length
        ? db()
            .update(sendLog)
            .set({ status, resendId: extra.resendId ?? null, error: extra.error ?? null, at: sql`now()` })
            .where(and(eq(sendLog.issueId, issueId), inArray(sendLog.subscriberId, subIds)))
        : Promise.resolve();
    await rows("skipped_demo", skipped);

    if (real.length) {
      const emails = real.map((s) => {
        const urls = unsubscribeUrls(APP_URL, makeUnsubToken(s.id, UNSUB_SIGNING_KEY));
        const links = { appUrl: APP_URL, unsubscribeUrl: urls.page };
        return {
          from: MAIL_FROM,
          to: [s.email],
          subject: issue.subject,
          html: renderIssueHtml(issue, links),
          text: renderIssueText(issue, links),
          ...(MAIL_REPLY_TO ? { replyTo: MAIL_REPLY_TO } : {}),
          headers: { "List-Unsubscribe": `<${urls.oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          tags: [{ name: "issue", value: issue.issueDate }],
        };
      });
      const { data, error } = await resend.batch.send(emails, { idempotencyKey: `${keyPrefix}-b${batchNo}` });
      if (error || !data) {
        const message = (error?.message ?? "no data").slice(0, 500);
        opts.log.error("resend batch failed", { batchNo, recipients: real.length, error: message });
        await rows("failed", real.map((s) => s.id), { error: message });
      } else {
        // Results come back in request order.
        for (const [i, s] of real.entries()) {
          const id = data.data[i]?.id;
          await rows(id ? "sent" : "failed", [s.id], id ? { resendId: id } : { error: "missing id in batch response" });
        }
      }
      await sleep(BATCH_SPACING_MS);
    }
  }

  if (complete) await transition(issueId, "finish_send");
  const totals = await db()
    .select({ status: sendLog.status, n: sql<number>`count(*)::int` })
    .from(sendLog)
    .where(eq(sendLog.issueId, issueId))
    .groupBy(sendLog.status);
  const counts = Object.fromEntries(totals.map((t) => [t.status, t.n]));
  opts.log.info("send finished", { complete, batches, counts });
  return { complete, batches, counts };
}
