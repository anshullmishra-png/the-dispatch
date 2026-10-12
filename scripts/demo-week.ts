// A whole week in a few minutes (docs/07 Phase 9): ingest ×3 → curate → notify →
// Shreya confirms on Telegram → remind (skips: confirmed) → send. Runs against
// the deployed app through the same authenticated cron routes Vercel calls.
//
//   npm run demo:week                    wait for Shreya to confirm on Telegram
//   npm run demo:week -- --auto-confirm  tap Approve all + Confirm as Shreya
//   npm run demo:week -- --reset         first reset this week's issue to COLLECTING
//                                        (keeps articles; drops draft, reviews, send log)
import "./_env";
import { and, eq, inArray, sql } from "drizzle-orm";
import { approvals, articles, issues, issueStories, sendLog, styleExamples, telegramMessages, telegramPending } from "@/db/schema";
import { computeContentHash } from "@/lib/approval/fsm";
import { db } from "@/lib/db";
import { requireEnv } from "@/lib/env";
import { confirmCallback, issueCallback } from "@/lib/telegram/cards";
import { targetIssueDate } from "@/lib/time";

const env = requireEnv("CRON_SECRET", "APP_URL", "TELEGRAM_WEBHOOK_SECRET", "SHREYA_TG_USER_ID");
const args = new Set(process.argv.slice(2));
const base = env.APP_URL;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s`;

async function job(name: string, query = "force=1") {
  const res = await fetch(new URL(`/api/cron/${name}?${query}`, base), { headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
  const body = (await res.json()) as Record<string, unknown>;
  const pick = (keys: string[]) => Object.fromEntries(keys.filter((k) => k in body).map((k) => [k, body[k]]));
  console.log(`${elapsed()}  ${name.padEnd(7)} HTTP ${res.status}  ${JSON.stringify(pick(["ok", "skipped", "reason", "error", "issueDate", "status", "messages", "kind", "totals", "dedupe", "selection", "model", "report"]))}`);
  return { status: res.status, body };
}

async function resetIssue(id: string) {
  const ids = (await db().select({ id: issueStories.id }).from(issueStories).where(eq(issueStories.issueId, id))).map((r) => r.id);
  await db().delete(sendLog).where(eq(sendLog.issueId, id));
  await db().delete(telegramPending).where(eq(telegramPending.issueId, id));
  await db().delete(telegramMessages).where(eq(telegramMessages.issueId, id));
  await db().delete(styleExamples).where(eq(styleExamples.issueId, id));
  await db().delete(approvals).where(eq(approvals.issueId, id));
  if (ids.length) await db().delete(issueStories).where(inArray(issueStories.id, ids));
  await db()
    .update(articles)
    .set({ status: sql`(case when ${articles.duplicateOf} is null then 'candidate' else 'duplicate' end)::article_status` })
    .where(and(eq(articles.issueId, id), inArray(articles.status, ["selected", "backup", "rejected"])));
  await db()
    .update(issues)
    .set({ status: "COLLECTING", subject: null, needsAttention: false, contentHash: null, confirmedAt: null, confirmedBy: null, sentAt: null, updatedAt: sql`now()` })
    .where(eq(issues.id, id));
}

async function tap(data: string) {
  const res = await fetch(new URL("/api/telegram/webhook", base), {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET },
    body: JSON.stringify({
      update_id: Math.floor(Date.now() / 1000) + 9000,
      callback_query: { id: `demo-${Date.now()}`, from: { id: Number(env.SHREYA_TG_USER_ID) }, data, message: { message_id: 1, chat: { id: Number(env.SHREYA_TG_USER_ID) } } },
    }),
  });
  if (!res.ok) throw new Error(`webhook ${res.status}`);
}

async function main() {
  const issueDate = targetIssueDate(new Date());
  console.log(`Demo week for the ${issueDate} issue at ${base}\n`);
  const find = async () => (await db().select().from(issues).where(eq(issues.issueDate, issueDate)))[0];
  let issue = await find();
  if (issue && args.has("--reset")) {
    await resetIssue(issue.id);
    console.log(`${elapsed()}  reset   issue ${issueDate} → COLLECTING`);
  } else if (issue && ["CONFIRMED", "SENDING", "SENT"].includes(issue.status)) {
    throw new Error(`issue is ${issue.status}; re-run with --reset to rehearse again`);
  }

  for (let i = 1; i <= 3; i += 1) await job("ingest"); // Mon, Tue, Wed
  const curate = await job("curate");
  if (curate.status !== 200) throw new Error("curate failed; see above");
  const notify = await job("notify");
  if (notify.status !== 200) throw new Error("notify failed; see above");

  issue = await find();
  if (!issue) throw new Error("issue vanished");
  const id = issue.id;
  if (args.has("--auto-confirm")) {
    await tap(issueCallback("approve_all", id));
    await tap(confirmCallback(id, await computeContentHash(id)));
    console.log(`${elapsed()}  review  Approve all + Confirm tapped as Shreya`);
  } else {
    console.log(`${elapsed()}  review  waiting for Shreya to confirm on Telegram (up to 30 min)…`);
    for (let i = 0; i < 180; i += 1) {
      const s = (await find())?.status;
      if (s === "CONFIRMED" || s === "HELD") break;
      await sleep(10_000);
    }
  }
  const status = (await find())?.status;
  console.log(`${elapsed()}  status  ${status}`);

  await job("remind"); // skips unless still IN_REVIEW (R13)
  const send = await job("send");
  console.log(`\n${send.status === 200 && send.body.kind === "sent" ? "DEMO WEEK COMPLETE: issue sent" : "DEMO WEEK ENDED WITHOUT A SEND (see above)"}`);
  process.exit(send.status === 200 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
