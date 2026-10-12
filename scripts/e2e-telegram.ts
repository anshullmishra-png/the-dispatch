// End-to-end check of the Telegram review flow against a deployed webhook.
// Posts real updates (as Shreya, plus one stranger) to /api/telegram/webhook
// with the shared secret, then checks Neon after each step. The bot's replies
// really arrive in Shreya's chat. Usage: npm run e2e:telegram [-- baseUrl]
import "./_env";
import { and, eq, sql } from "drizzle-orm";
import { approvals, issues, issueStories, telegramMessages, telegramPending } from "@/db/schema";
import { computeContentHash } from "@/lib/approval/fsm";
import { db } from "@/lib/db";
import { requireEnv } from "@/lib/env";
import { confirmCallback, issueCallback, storyCallback } from "@/lib/telegram/cards";
import { targetIssueDate } from "@/lib/time";

const env = requireEnv("TELEGRAM_WEBHOOK_SECRET", "SHREYA_TG_USER_ID", "CRON_SECRET", "APP_URL");
const base = process.argv[2] ?? env.APP_URL;
const SHREYA = Number(env.SHREYA_TG_USER_ID);
const STRANGER = 777000111;
let updateId = Math.floor(Date.now() / 1000);
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

async function post(update: Record<string, unknown>) {
  updateId += 1;
  const res = await fetch(new URL("/api/telegram/webhook", base), {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET },
    body: JSON.stringify({ update_id: updateId, ...update }),
  });
  if (res.status !== 200) throw new Error(`webhook returned ${res.status}`);
}

const tap = (data: string, from = SHREYA) =>
  post({ callback_query: { id: `e2e-${updateId}`, from: { id: from }, data, message: { message_id: 1, chat: { id: from } } } });
const say = (text: string, from = SHREYA) =>
  post({ message: { message_id: updateId, chat: { id: from, type: "private" }, from: { id: from }, text, date: Math.floor(Date.now() / 1000) } });

async function main() {
  const issueDate = targetIssueDate(new Date());
  const [issue] = await db().select().from(issues).where(eq(issues.issueDate, issueDate));
  if (!issue) throw new Error(`no issue for ${issueDate}`);
  const id = issue.id;
  const status = async () => (await db().select({ s: issues.status }).from(issues).where(eq(issues.id, id)))[0]?.s;
  const picks = async () =>
    db()
      .select()
      .from(issueStories)
      .where(and(eq(issueStories.issueId, id), eq(issueStories.role, "pick")))
      .orderBy(issueStories.position);
  const live = async () => (await picks()).filter((p) => p.state !== "SWAPPED_OUT");
  const count = async (action: string) =>
    (await db().select({ n: sql<number>`count(*)::int` }).from(approvals).where(and(eq(approvals.issueId, id), eq(approvals.action, action))))[0]?.n ?? 0;
  console.log(`Issue ${issueDate} (${await status()}) at ${base}\n`);

  // 1. A stranger is ignored.
  const before = await count("keep");
  await say("/start", STRANGER);
  await tap(storyCallback("keep", (await live())[0]?.id ?? ""), STRANGER);
  check("message and tap from a second account change nothing", (await count("keep")) === before);

  // Get to a confirmed issue (the starting point of an edit-after-confirm).
  if ((await status()) !== "CONFIRMED") {
    await tap(issueCallback("approve_all", id));
    await tap(confirmCallback(id, await computeContentHash(id)));
  }
  check("starts CONFIRMED", (await status()) === "CONFIRMED");

  // 2. Edit: a one-sentence reply fails voice lint and waits; a proper one saves.
  const target = (await live())[1];
  if (!target) throw new Error("draft has fewer than 2 picks");
  await tap(storyCallback("edit", target.id));
  const [pending] = await db().select().from(telegramPending).where(eq(telegramPending.chatId, SHREYA));
  check("Edit opens a force-reply prompt (pending edit stored)", pending?.storyId === target.id);
  await say("Just one sentence here.");
  const [held] = await db().select().from(telegramPending).where(eq(telegramPending.chatId, SHREYA));
  check("a one-sentence edit is held back by the voice check", held?.pendingText === "Just one sentence here.");
  const edits = await count("edit");
  await say(target.commentaryFinal);
  const [edited] = await db().select().from(issueStories).where(eq(issueStories.id, target.id));
  check("a valid edit is saved as EDITED", edited?.state === "EDITED" && (await count("edit")) === edits + 1);
  check("an edit after Confirm resets the issue to IN_REVIEW", (await status()) === "IN_REVIEW" && (await count("reset_by_edit")) > 0);

  // 3. Reminder: sent only while IN_REVIEW.
  const reminders = async () =>
    (await db().select({ n: sql<number>`count(*)::int` }).from(telegramMessages).where(and(eq(telegramMessages.issueId, id), eq(telegramMessages.kind, "reminder"))))[0]?.n ?? 0;
  const r0 = await reminders();
  const remind = await fetch(new URL("/api/cron/remind?force=1", base), { headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
  check("remind sends a reminder card while IN_REVIEW", remind.ok && (await reminders()) === r0 + 1);

  // 4. Swap: the old story is swapped out, a backup takes its position, no AI call.
  const staleHash = await computeContentHash(id);
  const victim = (await live())[2];
  if (!victim) throw new Error("draft has fewer than 3 picks");
  await tap(storyCallback("swap", victim.id));
  const after = await picks();
  const replacement = after.find((p) => p.swappedFrom === victim.id);
  check("Swap marks the old story SWAPPED_OUT", after.find((p) => p.id === victim.id)?.state === "SWAPPED_OUT");
  check("a backup takes the same position", replacement?.position === victim.position && replacement?.state === "PENDING");
  check("topic spread stays at least 3", new Set((await live()).map((p) => p.topic)).size >= 3);

  // 4b. Remove: only while at least 8 stories and 3 topics remain; later stories move up.
  const before9 = await live();
  const removable = before9.length > 8 ? before9[before9.length - 1] : undefined;
  if (removable) {
    await tap(storyCallback("remove", removable.id));
    const afterRemove = await live();
    check("Remove takes a story out without a replacement", afterRemove.length === before9.length - 1 && !afterRemove.some((p) => p.id === removable.id));
    check("positions stay 1..n after Remove", afterRemove.map((p) => p.position).join(",") === afterRemove.map((_, i) => i + 1).join(","));
  }
  const atMin = await live();
  if (atMin.length === 8) {
    await tap(storyCallback("remove", atMin[0]?.id ?? ""));
    check("Remove is refused when it would leave fewer than 8 stories", (await live()).length === 8);
  }

  // 5. Stale card and pending stories both block Confirm.
  const confirms = await count("confirm");
  await tap(confirmCallback(id, staleHash));
  check("Confirm from an out-of-date card is refused", (await status()) === "IN_REVIEW" && (await count("confirm")) === confirms);
  await tap(confirmCallback(id, await computeContentHash(id)));
  check("Confirm while a story is pending is refused", (await status()) === "IN_REVIEW" && (await count("confirm")) === confirms);

  // 6. Approve all, then Confirm.
  await tap(issueCallback("approve_all", id));
  check("Approve all leaves nothing pending", (await live()).every((p) => p.state !== "PENDING"));
  const fresh = await computeContentHash(id);
  await tap(confirmCallback(id, fresh));
  const [confirmed] = await db().select().from(issues).where(eq(issues.id, id));
  check("Confirm works once everything is reviewed", confirmed?.status === "CONFIRMED" && confirmed.contentHash === fresh);
  check("confirmed by Shreya's Telegram id", confirmed?.confirmedBy === SHREYA);

  // 7. Hold, then confirm again (leaves the issue CONFIRMED for the send phase).
  await tap(issueCallback("hold", id));
  check("Hold sets HELD", (await status()) === "HELD");
  await tap(confirmCallback(id, await computeContentHash(id)));
  check("a held issue can be confirmed again", (await status()) === "CONFIRMED");

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
