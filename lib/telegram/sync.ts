// Keeps Shreya's Telegram cards in step with a change made on the web desk.
// Best effort: the change is already committed; a Telegram hiccup only logs.
import { loadReview } from "@/lib/approval/review";
import { configuredFeatures } from "@/lib/env";
import type { Logger } from "@/lib/log";
import { sendMessage } from "./api";
import { renderStory } from "./cards";
import { postCard, refreshStoryCards, refreshSummary, shreyaChatId } from "./deliver";

export async function syncTelegram(
  issueId: string,
  change: { storyIds?: string[]; newStoryId?: string; note?: string; voided?: boolean; allCards?: boolean },
  log: Logger,
): Promise<void> {
  const f = configuredFeatures();
  if (!f.telegram || !f.telegramAllowlist) return;
  try {
    const chatId = shreyaChatId();
    const review = await loadReview(issueId);
    const ids = change.allCards ? review.picks.map((p) => p.id) : (change.storyIds ?? []);
    await refreshStoryCards(review, ids, chatId);
    const fresh = change.newStoryId ? review.picks.find((p) => p.id === change.newStoryId) : undefined;
    if (fresh) await postCard(chatId, issueId, "story", renderStory(fresh, review.livePicks.length, review.summary.status), fresh.id);
    if (change.note) await sendMessage(chatId, change.note);
    if (change.voided) await sendMessage(chatId, "⚠ Draft changed after confirmation (on the web desk), please confirm again.");
    await refreshSummary(review, chatId, { repost: Boolean(fresh || change.note || change.voided) });
  } catch (err) {
    log.error("telegram sync after web action failed", { issueId, err });
  }
}
