// Posting and refreshing review cards, with every message recorded in
// telegram_messages so later taps and edits can find their card.
import { and, desc, eq, inArray } from "drizzle-orm";
import { telegramMessages } from "@/db/schema";
import { loadReview, type ReviewState } from "@/lib/approval/review";
import { db } from "@/lib/db";
import { configuredFeatures, requireEnv } from "@/lib/env";
import type { Logger } from "@/lib/log";
import { editMessageText, sendMessage } from "./api";
import { type Card, renderAlert, renderFinal, renderHeader, renderReminder, renderStory, renderSuperseded } from "./cards";

export type MessageKind = "header" | "story" | "final" | "reminder" | "alert";

export function shreyaChatId(): number {
  return Number(requireEnv("SHREYA_TG_CHAT_ID").SHREYA_TG_CHAT_ID);
}

export async function postCard(chatId: number, issueId: string, kind: MessageKind, card: Card, storyId: string | null = null): Promise<number> {
  const messageId = await sendMessage(chatId, card.text, { replyMarkup: card.replyMarkup });
  await db().insert(telegramMessages).values({ issueId, storyId, chatId, messageId, kind }).onConflictDoNothing();
  return messageId;
}

/** The issue a tapped card belongs to, if we recorded it. */
export async function issueOfMessage(chatId: number, messageId: number): Promise<string | null> {
  const [row] = await db()
    .select({ issueId: telegramMessages.issueId })
    .from(telegramMessages)
    .where(and(eq(telegramMessages.chatId, chatId), eq(telegramMessages.messageId, messageId)));
  return row?.issueId ?? null;
}

/** Notify: header, one card per live pick in position order, then the final card. */
export async function deliverDraft(issueId: string, chatId: number): Promise<{ messages: number; review: ReviewState }> {
  const review = await loadReview(issueId);
  const { status } = review.summary;
  await postCard(chatId, issueId, "header", renderHeader(review.summary));
  for (const story of review.livePicks) {
    await postCard(chatId, issueId, "story", renderStory(story, review.livePicks.length, status), story.id);
  }
  await postCard(chatId, issueId, "final", renderFinal(review.summary));
  return { messages: review.livePicks.length + 2, review };
}

/** Re-renders every card we posted for these stories (a re-notify can post more than one). */
export async function refreshStoryCards(review: ReviewState, storyIds: readonly string[], chatId: number): Promise<void> {
  if (!storyIds.length) return;
  const rows = await db()
    .select({ storyId: telegramMessages.storyId, messageId: telegramMessages.messageId })
    .from(telegramMessages)
    .where(and(eq(telegramMessages.chatId, chatId), eq(telegramMessages.kind, "story"), inArray(telegramMessages.storyId, [...storyIds])));
  for (const row of rows) {
    const story = review.picks.find((p) => p.id === row.storyId);
    if (!story) continue;
    const card = renderStory(story, review.livePicks.length, review.summary.status);
    await editMessageText(chatId, row.messageId, card.text, card.replyMarkup);
  }
}

/**
 * Keeps one live summary card (final or reminder). In place for small changes;
 * `repost` moves it to the bottom of the chat (after a swap or an edit, whose
 * messages push it out of view) and strips the buttons from the old one.
 */
export async function refreshSummary(review: ReviewState, chatId: number, opts: { repost: boolean }): Promise<void> {
  const issueId = review.issue.id;
  const [latest] = await db()
    .select({ messageId: telegramMessages.messageId, kind: telegramMessages.kind })
    .from(telegramMessages)
    .where(and(eq(telegramMessages.issueId, issueId), eq(telegramMessages.chatId, chatId), inArray(telegramMessages.kind, ["final", "reminder"])))
    .orderBy(desc(telegramMessages.createdAt))
    .limit(1);
  if (latest && !opts.repost) {
    // A reminder only makes sense while the issue is still waiting for Confirm.
    const waiting = review.summary.status === "IN_REVIEW" || review.summary.status === "DRAFTING";
    const card = latest.kind === "reminder" && waiting ? renderReminder(review.summary) : renderFinal(review.summary);
    await editMessageText(chatId, latest.messageId, card.text, card.replyMarkup);
    return;
  }
  if (latest) await editMessageText(chatId, latest.messageId, renderSuperseded().text);
  await postCard(chatId, issueId, "final", renderFinal(review.summary));
}

/** Best effort: an alert must never break the job that raises it. */
export async function alertShreya(issueId: string, title: string, body: readonly string[], log: Logger): Promise<boolean> {
  const f = configuredFeatures();
  if (!f.telegram || !f.telegramAllowlist) {
    log.warn("telegram alert skipped: not configured", { title });
    return false;
  }
  try {
    await postCard(shreyaChatId(), issueId, "alert", renderAlert(title, body));
    return true;
  } catch (err) {
    log.error("telegram alert failed", { title, err });
    return false;
  }
}
