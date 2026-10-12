// Webhook update handling (docs/05-INTEGRATIONS.md §3): allowlist → handle →
// always answer callbacks. Only Shreya's Telegram id can act; everyone else is
// ignored and logged. All state changes go through lib/approval/review.ts.
import { eq } from "drizzle-orm";
import { issues, telegramPending } from "@/db/schema";
import { ConfirmRejectedError, IllegalTransitionError, type IssueStatus } from "@/lib/approval/fsm";
import {
  approveAll,
  confirmIssue,
  editStory,
  holdIssue,
  keepStory,
  lintEdit,
  loadReview,
  ReviewError,
  resolveIssue,
  resolveStory,
  swapStory,
} from "@/lib/approval/review";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { Logger } from "@/lib/log";
import { targetIssueDate } from "@/lib/time";
import { answerCallbackQuery, sendMessage } from "./api";
import { escapeHtml, parseCallback, renderEditPrompt, renderStory, storyCallback } from "./cards";
import { issueOfMessage, postCard, refreshStoryCards, refreshSummary } from "./deliver";

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
}
export interface TgMessage {
  message_id: number;
  chat: { id: number; type?: string };
  from?: TgUser;
  text?: string;
  reply_to_message?: { message_id: number };
}
export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  data?: string;
  message?: { message_id: number; chat: { id: number } };
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

/** docs/05 §3: an edit prompt waits 30 minutes for the reply. */
export const EDIT_TTL_MS = 30 * 60_000;

export type Sender = "unconfigured" | "editor" | "stranger";

/** Who sent the update. Before SHREYA_TG_USER_ID is set, only /start is answered. */
export function classifySender(fromId: number, shreyaId: string | undefined): Sender {
  if (!shreyaId) return "unconfigured";
  return String(fromId) === shreyaId ? "editor" : "stranger";
}

export async function handleUpdate(update: TgUpdate, log: Logger): Promise<void> {
  const from = update.message?.from ?? update.callback_query?.from;
  if (!from || from.is_bot) return;
  const sender = classifySender(from.id, env().SHREYA_TG_USER_ID);
  const updateLog = log.child({ updateId: update.update_id, sender });

  if (sender === "stranger") {
    updateLog.warn("ignored update from a non-allowlisted Telegram user", { fromId: from.id });
    // Always answer callbacks (stops the client spinner), but say nothing.
    if (update.callback_query) await answerCallbackQuery(update.callback_query.id);
    return;
  }

  if (update.callback_query) {
    if (sender === "unconfigured") {
      await answerCallbackQuery(update.callback_query.id, "The bot is not set up yet.");
      return;
    }
    await onCallback(update.callback_query, updateLog);
    return;
  }
  if (update.message) await onMessage(update.message, sender, updateLog);
}

// ---------------------------------------------------------------- messages

async function onMessage(msg: TgMessage, sender: Sender, log: Logger): Promise<void> {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() ?? "";
  const userId = msg.from?.id ?? 0;

  if (/^\/start\b/.test(text)) {
    const ids = `Your Telegram user id: <code>${userId}</code>\nThis chat's id: <code>${chatId}</code>`;
    if (sender === "unconfigured") {
      await sendMessage(chatId, `${ids}\n\nPut these in the environment as SHREYA_TG_USER_ID and SHREYA_TG_CHAT_ID, then redeploy. Until then the bot ignores everything else.`);
    } else {
      await sendMessage(chatId, `You're set up as the editor of The Dispatch. Drafts arrive here on Wednesday evening.\n\n${ids}`);
    }
    log.info("start command", { configured: sender === "editor" });
    return;
  }
  if (sender !== "editor") return;

  if (/^\/status\b/.test(text)) {
    await postStatus(chatId);
    return;
  }

  const [pending] = await db().select().from(telegramPending).where(eq(telegramPending.chatId, chatId));
  if (!pending || !text || text.startsWith("/")) {
    await sendMessage(chatId, "I work through the buttons on the draft cards. Send /status for this week's summary.");
    return;
  }
  if (pending.expiresAt.getTime() < Date.now()) {
    await db().delete(telegramPending).where(eq(telegramPending.chatId, chatId));
    await sendMessage(chatId, "That edit request expired (30 minutes). Tap ✏️ Edit on the story again.");
    return;
  }

  const errors = await lintEdit(text);
  if (errors.length) {
    await db().update(telegramPending).set({ pendingText: text }).where(eq(telegramPending.chatId, chatId));
    await sendMessage(
      chatId,
      [
        "That version doesn't pass the voice check:",
        ...errors.map((e) => `• ${escapeHtml(e)}`),
        "",
        "Send a corrected version, or use this one anyway (you're the editor; the override is logged).",
      ].join("\n"),
      { replyMarkup: { inline_keyboard: [[{ text: "Use anyway", callback_data: storyCallback("use_anyway", pending.storyId) }]] } },
    );
    log.info("edit failed voice lint", { storyId: pending.storyId, errors });
    return;
  }
  await saveEdit(chatId, userId, pending.issueId, pending.storyId, text, [], log);
}

async function saveEdit(
  chatId: number,
  actorTgId: number,
  issueId: string,
  storyId: string,
  text: string,
  lintOverride: string[],
  log: Logger,
): Promise<void> {
  try {
    const result = await editStory(issueId, storyId, text, { actorTgId, lintOverride });
    await db().delete(telegramPending).where(eq(telegramPending.chatId, chatId));
    const review = await loadReview(issueId);
    const story = review.picks.find((p) => p.id === storyId);
    await sendMessage(chatId, `✏️ Saved story ${story?.position ?? ""}.${lintOverride.length ? " (Voice check overridden.)" : ""}`);
    if (result.confirmationVoided) await sendMessage(chatId, "⚠ Draft changed after confirmation, please confirm again.");
    await refreshStoryCards(review, [storyId], chatId);
    await refreshSummary(review, chatId, { repost: true });
    log.info("story edited", { storyId, similarity: result.similarity, override: lintOverride.length > 0, voided: result.confirmationVoided });
  } catch (err) {
    await db().delete(telegramPending).where(eq(telegramPending.chatId, chatId));
    if (err instanceof ReviewError) {
      await sendMessage(chatId, reviewErrorText(err));
      return;
    }
    throw err;
  }
}

async function postStatus(chatId: number): Promise<void> {
  const [issue] = await db().select({ id: issues.id }).from(issues).where(eq(issues.issueDate, targetIssueDate(new Date())));
  if (!issue) {
    await sendMessage(chatId, "No draft for this Thursday yet.");
    return;
  }
  const review = await loadReview(issue.id);
  if (!review.livePicks.length) {
    await sendMessage(chatId, "No draft for this Thursday yet.");
    return;
  }
  await refreshSummary(review, chatId, { repost: true });
}

// ---------------------------------------------------------------- callbacks

const STATUS_WORDS: Partial<Record<IssueStatus, string>> = {
  SENDING: "is being sent",
  SENT: "has already gone out",
  COLLECTING: "has no draft yet",
};

export function reviewErrorText(err: ReviewError): string {
  switch (err.reason) {
    case "not_found":
      return "This card is from an older or replaced draft. Send /status for the current one.";
    case "ambiguous":
      return "I couldn't tell which story this is. Send /status for fresh cards.";
    case "issue_locked":
      return "This issue can't be changed any more.";
    case "not_a_live_pick":
      return "That story was swapped out, so it can't be changed.";
    case "no_backups":
      return "No backups left to swap in. Edit the commentary instead.";
    case "empty_text":
      return err.message === "text too long" ? "That's too long for a commentary." : "That message was empty.";
    default:
      return "That didn't work.";
  }
}

async function onCallback(q: TgCallbackQuery, log: Logger): Promise<void> {
  let answered = false;
  const answer = async (text?: string, alert = false) => {
    if (answered) return;
    answered = true;
    await answerCallbackQuery(q.id, text, alert);
  };
  const chatId = q.message?.chat.id;
  const parsed = q.data ? parseCallback(q.data) : null;
  try {
    if (!parsed || chatId === undefined) {
      await answer("This button isn't recognised.");
      return;
    }
    if (parsed.kind === "story") {
      const issueId = (q.message && (await issueOfMessage(chatId, q.message.message_id))) ?? (await currentIssueId());
      if (!issueId) throw new ReviewError("not_found");
      const storyId = await resolveStory(issueId, parsed.story8);
      await onStoryAction(parsed.action, issueId, storyId, chatId, q.from.id, answer, log);
      return;
    }
    const issueId = await resolveIssue(parsed.issue8);
    if (parsed.kind === "confirm") {
      await onConfirm(issueId, parsed.hash8, chatId, q.from.id, answer, log);
      return;
    }
    await onIssueAction(parsed.action, issueId, chatId, q.from.id, answer, log);
  } catch (err) {
    if (err instanceof ReviewError) {
      await answer(reviewErrorText(err), true);
      return;
    }
    log.error("callback failed", { data: q.data, err });
    await answer("Something went wrong. Try again in a moment.", true);
  } finally {
    await answer().catch(() => undefined);
  }
}

type Answer = (text?: string, alert?: boolean) => Promise<void>;

async function currentIssueId(): Promise<string | null> {
  const [issue] = await db().select({ id: issues.id }).from(issues).where(eq(issues.issueDate, targetIssueDate(new Date())));
  return issue?.id ?? null;
}

async function onStoryAction(
  action: "keep" | "edit" | "swap" | "use_anyway",
  issueId: string,
  storyId: string,
  chatId: number,
  actorTgId: number,
  answer: Answer,
  log: Logger,
): Promise<void> {
  if (action === "keep") {
    const { changed } = await keepStory(issueId, storyId, { actorTgId });
    await answer(changed ? "Kept" : "Already reviewed");
    const review = await loadReview(issueId);
    await refreshStoryCards(review, [storyId], chatId);
    if (changed) await refreshSummary(review, chatId, { repost: false });
    return;
  }

  if (action === "edit") {
    const review = await loadReview(issueId);
    const story = review.livePicks.find((p) => p.id === storyId);
    if (!story) throw new ReviewError("not_a_live_pick");
    if (!["DRAFTING", "IN_REVIEW", "HELD", "CONFIRMED"].includes(review.issue.status)) throw new ReviewError("issue_locked");
    await answer("Reply with the new text");
    const promptMessageId = await sendMessage(chatId, renderEditPrompt(story.position, story.commentary), {
      replyMarkup: { force_reply: true, input_field_placeholder: "2–3 sentences, at most 65 words" },
    });
    const row = { issueId, storyId, promptMessageId, pendingText: null, expiresAt: new Date(Date.now() + EDIT_TTL_MS) };
    await db()
      .insert(telegramPending)
      .values({ chatId, ...row })
      .onConflictDoUpdate({ target: telegramPending.chatId, set: row });
    return;
  }

  if (action === "use_anyway") {
    const [pending] = await db().select().from(telegramPending).where(eq(telegramPending.chatId, chatId));
    if (!pending || pending.storyId !== storyId || !pending.pendingText || pending.expiresAt.getTime() < Date.now()) {
      await answer("That edit is no longer waiting. Tap ✏️ Edit again.", true);
      return;
    }
    await answer("Saving your version");
    await saveEdit(chatId, actorTgId, issueId, storyId, pending.pendingText, await lintEdit(pending.pendingText), log);
    return;
  }

  // swap
  const result = await swapStory(issueId, storyId, { actorTgId });
  await answer(`Swapped in a backup for story ${result.position}`);
  const review = await loadReview(issueId);
  await refreshStoryCards(review, [result.oldId], chatId);
  const replacement = review.picks.find((p) => p.id === result.replacementId);
  if (replacement) {
    await postCard(chatId, issueId, "story", renderStory(replacement, review.livePicks.length, review.summary.status), replacement.id);
  }
  if (!result.spreadOk) await sendMessage(chatId, "⚠ No backup keeps the picks across 3 topics; the closest one was used. Consider another swap or an edit.");
  if (result.confirmationVoided) await sendMessage(chatId, "⚠ Draft changed after confirmation, please confirm again.");
  await refreshSummary(review, chatId, { repost: true });
  log.info("story swapped", { oldId: result.oldId, replacementId: result.replacementId, spreadOk: result.spreadOk });
}

async function onConfirm(issueId: string, hash8: string, chatId: number, actorTgId: number, answer: Answer, log: Logger): Promise<void> {
  try {
    await confirmIssue(issueId, { actorTgId, cardHash: hash8 });
  } catch (err) {
    if (!(err instanceof ConfirmRejectedError) && !(err instanceof IllegalTransitionError)) throw err;
    const review = await loadReview(issueId);
    const failures = err instanceof ConfirmRejectedError ? err.failures : ["illegal_status" as const];
    log.info("confirm refused", { failures });
    if (failures.includes("illegal_status")) {
      const s = review.issue.status;
      await answer(s === "CONFIRMED" ? "Already confirmed." : `This issue ${STATUS_WORDS[s] ?? `is ${s}`}.`, true);
      return;
    }
    if (failures.includes("stories_pending")) {
      const n = review.summary.counts.PENDING;
      await answer(`${n} ${n === 1 ? "story is" : "stories are"} still pending. Keep, edit or swap them, or tap Approve all remaining.`, true);
      return;
    }
    if (failures.includes("stale_card")) {
      await answer("This card is out of date: the draft changed after it was posted. The current summary is below.", true);
      await refreshSummary(review, chatId, { repost: true });
      return;
    }
    await answer("Only the editor can confirm.", true);
    return;
  }
  await answer("Confirmed");
  const review = await loadReview(issueId);
  await sendMessage(chatId, "🚀 Confirmed. It will go out Thursday morning.");
  await refreshSummary(review, chatId, { repost: false });
  log.info("issue confirmed", { issueId });
}

async function onIssueAction(
  action: "approve_all" | "hold" | "send_now",
  issueId: string,
  chatId: number,
  actorTgId: number,
  answer: Answer,
  log: Logger,
): Promise<void> {
  if (action === "approve_all") {
    const { kept } = await approveAll(issueId, { actorTgId });
    await answer(kept.length ? `Kept ${kept.length} ${kept.length === 1 ? "story" : "stories"}` : "Nothing was pending");
    const review = await loadReview(issueId);
    await refreshStoryCards(review, kept, chatId);
    await refreshSummary(review, chatId, { repost: false });
    return;
  }
  if (action === "hold") {
    try {
      await holdIssue(issueId, { actorTgId });
    } catch (err) {
      if (!(err instanceof IllegalTransitionError)) throw err;
      await answer(err.from === "HELD" ? "Already on hold." : `This issue ${STATUS_WORDS[err.from] ?? `is ${err.from}`}.`, true);
      return;
    }
    await answer("Held");
    await sendMessage(chatId, "⏸ Held. Nothing will be sent until you confirm again.");
    await refreshSummary(await loadReview(issueId), chatId, { repost: false });
    log.info("issue held", { issueId });
    return;
  }
  // send_now: arrives with email delivery (docs/07 Phase 7).
  await answer("Send now isn't available yet. Confirm instead and it goes out Thursday morning.", true);
}
