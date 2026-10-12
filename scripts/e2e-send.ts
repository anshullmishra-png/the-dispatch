// End-to-end check of Phase 7 against the deployed app (docs/07 Phase 7 "Done when"):
// gate holds an unconfirmed issue; a confirmed one goes only to the allowlist and
// Resend test inboxes (demo mode); no double send; unsubscribe; webhook + simulate.
// Usage: npm run e2e:send
import "./_env";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { emailEvents, issues, issueStories, sendLog, subscribers, telegramMessages } from "@/db/schema";
import { computeContentHash } from "@/lib/approval/fsm";
import { db } from "@/lib/db";
import { requireEnv } from "@/lib/env";
import { signSvix } from "@/lib/mail/svix";
import { makeUnsubToken } from "@/lib/mail/tokens";
import { confirmCallback, storyCallback } from "@/lib/telegram/cards";
import { targetIssueDate } from "@/lib/time";

const env = requireEnv("TELEGRAM_WEBHOOK_SECRET", "SHREYA_TG_USER_ID", "CRON_SECRET", "ADMIN_TOKEN", "APP_URL", "RESEND_WEBHOOK_SECRET", "UNSUB_SIGNING_KEY");
const base = env.APP_URL;
const SHREYA = Number(env.SHREYA_TG_USER_ID);
let updateId = Math.floor(Date.now() / 1000) + 5000;
let failures = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

async function webhook(update: Record<string, unknown>) {
  updateId += 1;
  const res = await fetch(new URL("/api/telegram/webhook", base), {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET },
    body: JSON.stringify({ update_id: updateId, ...update }),
  });
  if (res.status !== 200) throw new Error(`telegram webhook returned ${res.status}`);
}
const tap = (data: string) =>
  webhook({ callback_query: { id: `e2e-${updateId}`, from: { id: SHREYA }, data, message: { message_id: 1, chat: { id: SHREYA } } } });
const say = (text: string) =>
  webhook({ message: { message_id: updateId, chat: { id: SHREYA, type: "private" }, from: { id: SHREYA }, text, date: Math.floor(Date.now() / 1000) } });
const cron = (path: string) => fetch(new URL(path, base), { headers: { authorization: `Bearer ${env.CRON_SECRET}` } });

async function main() {
  const [issue] = await db().select().from(issues).where(eq(issues.issueDate, targetIssueDate(new Date())));
  if (!issue) throw new Error("no target issue");
  const id = issue.id;
  const status = async () => (await db().select({ s: issues.status }).from(issues).where(eq(issues.id, id)))[0]?.s;
  const logCounts = async () =>
    Object.fromEntries(
      (await db().select({ s: sendLog.status, n: sql<number>`count(*)::int` }).from(sendLog).where(eq(sendLog.issueId, id)).groupBy(sendLog.status)).map((r) => [r.s, r.n]),
    ) as Record<string, number>;
  const alerts = async () =>
    (await db().select({ n: sql<number>`count(*)::int` }).from(telegramMessages).where(and(eq(telegramMessages.issueId, id), eq(telegramMessages.kind, "alert"))))[0]?.n ?? 0;
  console.log(`Issue ${issue.issueDate} (${issue.status}) at ${base}\n`);
  if (issue.status === "SENT") throw new Error("issue already sent; nothing to test");

  // 1. Unconfirmed → the send job holds, sends nothing, alerts Shreya (R12).
  if ((await status()) === "CONFIRMED") {
    const [story] = await db()
      .select()
      .from(issueStories)
      .where(and(eq(issueStories.issueId, id), eq(issueStories.role, "pick"), eq(issueStories.position, 1)));
    if (!story) throw new Error("no story 1");
    await tap(storyCallback("edit", story.id));
    await say(story.commentaryFinal); // same text: an edit nonetheless voids the confirmation
  }
  check("issue is unconfirmed before the send job", (await status()) === "IN_REVIEW");
  const a0 = await alerts();
  const held = await cron("/api/cron/send");
  check("send job refuses an unconfirmed issue", held.status === 409, `HTTP ${held.status}`);
  check("issue is now HELD", (await status()) === "HELD");
  check("no email was sent or logged", Object.keys(await logCounts()).length === 0);
  check("Shreya got a Telegram alert", (await alerts()) === a0 + 1);

  // 2. Confirm, then send: only allowlist + Resend test inboxes get real mail (demo mode).
  await tap(confirmCallback(id, await computeContentHash(id)));
  check("Shreya re-confirms from HELD", (await status()) === "CONFIRMED");
  const active = (await db().select({ n: sql<number>`count(*)::int` }).from(subscribers).where(eq(subscribers.status, "active")))[0]?.n ?? 0;
  const sent = await cron("/api/cron/send");
  const body = (await sent.json()) as { kind?: string };
  check("send job sends a confirmed issue", sent.status === 200 && body.kind === "sent", `HTTP ${sent.status} ${body.kind}`);
  check("issue is SENT", (await status()) === "SENT");
  const c = await logCounts();
  check("every active subscriber has exactly one send_log row", (c.sent ?? 0) + (c.skipped_demo ?? 0) + (c.failed ?? 0) === active, JSON.stringify(c));
  check("real sends are only the allowlist and Resend test inboxes", (c.sent ?? 0) >= 1 && (c.sent ?? 0) <= 4 && (c.failed ?? 0) === 0, `sent=${c.sent} failed=${c.failed ?? 0}`);
  const [mine] = await db()
    .select({ s: sendLog.status })
    .from(sendLog)
    .innerJoin(subscribers, eq(subscribers.id, sendLog.subscriberId))
    .where(and(eq(sendLog.issueId, id), eq(subscribers.email, "anshullmishra@gmail.com")));
  check("the allowlisted inbox was really sent", mine?.s === "sent");
  const again = (await (await cron("/api/cron/send")).json()) as { reason?: string };
  check("a second send run does not send again", again.reason === "already_sent");

  // 3. Unsubscribe: GET shows a page only; POST (one-click) unsubscribes, idempotently.
  const [victim] = await db().select().from(subscribers).where(eq(subscribers.email, "delivered@resend.dev"));
  if (victim) {
    const token = makeUnsubToken(victim.id, env.UNSUB_SIGNING_KEY);
    const page = await fetch(new URL(`/unsubscribe?t=${token}`, base));
    const pageText = await page.text();
    const stillActive = (await db().select({ s: subscribers.status }).from(subscribers).where(eq(subscribers.id, victim.id)))[0]?.s;
    check("the unsubscribe link opens a confirmation page and changes nothing", page.ok && pageText.includes("Unsubscribe from The Dispatch?") && stillActive === victim.status);
    const one = await fetch(new URL(`/api/unsubscribe?t=${token}`, base), { method: "POST", body: new URLSearchParams({ "List-Unsubscribe": "One-Click" }) });
    const after = (await db().select({ s: subscribers.status }).from(subscribers).where(eq(subscribers.id, victim.id)))[0]?.s;
    check("one-click POST unsubscribes", one.ok && after === "unsubscribed");
    const twice = (await (await fetch(new URL(`/api/unsubscribe?t=${token}`, base), { method: "POST" })).json()) as { changed?: boolean };
    check("unsubscribing twice is a no-op", twice.changed === false);
    const forged = await fetch(new URL(`/api/unsubscribe?t=${token.slice(0, -3)}xyz`, base), { method: "POST" });
    check("a forged token is rejected", forged.status === 400);
  }

  // 4. Resend webhook: unsigned rejected; a signed bounce marks the subscriber; duplicates ignored.
  const unsigned = await fetch(new URL("/api/webhooks/resend", base), { method: "POST", body: "{}" });
  check("unsigned Resend webhook is rejected", unsigned.status === 401);
  const target = "user0001@example.invalid";
  const payload = JSON.stringify({ type: "email.bounced", data: { email_id: randomUUID(), to: [target], bounce: { type: "Permanent", subType: "General" } } });
  const svixId = `msg_e2e_${randomUUID()}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const signed = () =>
    fetch(new URL("/api/webhooks/resend", base), {
      method: "POST",
      headers: { "content-type": "application/json", "svix-id": svixId, "svix-timestamp": ts, "svix-signature": `v1,${signSvix(env.RESEND_WEBHOOK_SECRET, svixId, ts, payload)}` },
      body: payload,
    });
  const w1 = await signed();
  const bounced = (await db().select({ s: subscribers.status }).from(subscribers).where(eq(subscribers.email, target)))[0]?.s;
  check("a signed permanent bounce marks the subscriber bounced", w1.ok && bounced === "bounced");
  const w2 = (await (await signed()).json()) as { duplicate?: boolean };
  check("the same event delivered twice is recorded once", w2.duplicate === true);

  // 5. Simulator (X6) uses the same hygiene code.
  const sim = await fetch(new URL("/api/admin/simulate", base), {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": env.ADMIN_TOKEN },
    body: JSON.stringify({ action: "complaint", email: "user0002@example.invalid" }),
  });
  const complained = (await db().select({ s: subscribers.status }).from(subscribers).where(eq(subscribers.email, "user0002@example.invalid")))[0]?.s;
  check("simulate complaint marks the subscriber complained", sim.ok && complained === "complained");

  // 6. Real events from Resend for the test inboxes (bounced@ / complained@ resend.dev).
  let real: string[] = [];
  for (let i = 0; i < 12 && !real.includes("email.bounced"); i += 1) {
    await sleep(5000);
    real = (await db().select({ t: emailEvents.type }).from(emailEvents).where(sql`${emailEvents.svixId} not like 'msg_e2e_%'`)).map((r) => r.t);
  }
  const bouncedTest = (await db().select({ s: subscribers.status }).from(subscribers).where(eq(subscribers.email, "bounced@resend.dev")))[0]?.s;
  check("Resend's real bounce event for bounced@resend.dev arrived and was applied", real.includes("email.bounced") && bouncedTest === "bounced", `events: ${[...new Set(real)].join(", ") || "none yet"}`);

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
