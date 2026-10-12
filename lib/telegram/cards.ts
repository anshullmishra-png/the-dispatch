// Telegram review cards (docs/05-INTEGRATIONS.md §3). Pure: text + buttons only.
import type { IssueStatus } from "@/lib/approval/fsm";
import { formatIssueDateShort, formatIstDateTime } from "@/lib/time";
import type { InlineButton, InlineKeyboard } from "./api";

export type StoryState = "PENDING" | "KEPT" | "EDITED" | "SWAPPED_OUT";

export const TOPIC_LABELS: Record<string, string> = {
  funding_vc: "Funding & VC",
  fintech: "Fintech",
  ai_saas: "AI & SaaS",
  consumer_d2c: "Consumer & D2C",
  commerce_logistics: "Commerce & Logistics",
  policy_regulation: "Policy & Regulation",
  climate_deeptech: "Climate & Deeptech",
  health_bio: "Health & Bio",
  exits_markets: "Exits & Markets",
};
const SIGNAL_LABELS: Record<string, string> = {
  counterintuitive: "counterintuitive",
  under_reported: "under-reported",
  trend_link: "trend link",
};

export const topicLabel = (t: string) => TOPIC_LABELS[t] ?? t;

/** Telegram HTML mode needs only & < > escaped in text (docs/05 §3). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** `ungrounded_number:42%` → `ungrounded number: 42%`. */
export function formatFlag(flag: string): string {
  const i = flag.indexOf(":");
  const code = (i < 0 ? flag : flag.slice(0, i)).replace(/_/g, " ");
  return i < 0 ? code : `${code}: ${flag.slice(i + 1)}`;
}

// ---------------------------------------------------------------- callback data

export type StoryAction = "keep" | "edit" | "swap" | "remove" | "use_anyway";
export type IssueAction = "approve_all" | "hold" | "send_now";
export type Callback =
  | { kind: "story"; action: StoryAction; story8: string }
  | { kind: "issue"; action: IssueAction; issue8: string }
  | { kind: "confirm"; issue8: string; hash8: string };

const STORY_CODES: Record<string, StoryAction> = { k: "keep", e: "edit", s: "swap", r: "remove", u: "use_anyway" };
const ISSUE_CODES: Record<string, IssueAction> = { a: "approve_all", h: "hold", n: "send_now" };
const code = (map: Record<string, string>, action: string) => Object.keys(map).find((k) => map[k] === action) as string;

export const id8 = (uuid: string) => uuid.replace(/-/g, "").slice(0, 8).toLowerCase();

export function storyCallback(action: StoryAction, storyId: string): string {
  return `${code(STORY_CODES, action)}:${id8(storyId)}`;
}
export function issueCallback(action: IssueAction, issueId: string): string {
  return `${code(ISSUE_CODES, action)}:${id8(issueId)}`;
}
export function confirmCallback(issueId: string, contentHash: string): string {
  return `c:${id8(issueId)}:${contentHash.slice(0, 8)}`;
}

export function parseCallback(data: string): Callback | null {
  let m = /^([kesru]):([0-9a-f]{8})$/.exec(data);
  if (m) return { kind: "story", action: STORY_CODES[m[1] as string] as StoryAction, story8: m[2] as string };
  m = /^([ahn]):([0-9a-f]{8})$/.exec(data);
  if (m) return { kind: "issue", action: ISSUE_CODES[m[1] as string] as IssueAction, issue8: m[2] as string };
  m = /^c:([0-9a-f]{8}):([0-9a-f]{8})$/.exec(data);
  if (m) return { kind: "confirm", issue8: m[1] as string, hash8: m[2] as string };
  return null;
}

// ---------------------------------------------------------------- cards

export interface Card {
  text: string;
  replyMarkup?: InlineKeyboard;
}

export interface CardStory {
  id: string;
  position: number;
  topic: string;
  signalType: string;
  headline: string;
  publisher: string | null;
  url: string;
  commentary: string;
  rationale: string;
  flags: readonly string[];
  state: StoryState;
  /** Set on a backup promoted by Swap. */
  replacedPosition?: boolean;
  /** Out of the issue with no replacement (Remove). */
  removed?: boolean;
}

export interface DraftSummary {
  issueId: string;
  issueDate: string;
  status: IssueStatus;
  contentHash: string;
  confirmedAt: Date | null;
  counts: Record<StoryState, number>;
  /** topic → live picks */
  topics: Record<string, number>;
  backupsLeft: number;
  warnings: readonly string[];
  /** True once the scheduled Thursday send has passed: a confirmed issue can then go out now. */
  sendNowAvailable?: boolean;
}

const isHttpUrl = (u: string) => /^https?:\/\/[^\s]+$/i.test(u);
const readButton = (url: string): InlineButton[] => (isHttpUrl(url) ? [{ text: "🔗 Read", url }] : []);

/** Statuses in which a story can still be changed (the FSM's `edit` event). */
const REVIEWABLE: readonly IssueStatus[] = ["DRAFTING", "IN_REVIEW", "HELD", "CONFIRMED"];

export function renderHeader(s: DraftSummary): Card {
  const live = s.counts.PENDING + s.counts.KEPT + s.counts.EDITED;
  const topics = Object.keys(s.topics).length;
  const lines = [
    `<b>The Dispatch — draft for ${escapeHtml(formatIssueDateShort(s.issueDate))}</b> · ${live} stories · ${topics} topics`,
    "Review each story below, then confirm on the last card. Nothing is sent without your confirmation.",
    ...s.warnings.map((w) => `⚠ ${escapeHtml(w)}`),
  ];
  return { text: lines.join("\n") };
}

export function renderStory(story: CardStory, total: number, status: IssueStatus): Card {
  const meta = [`${story.position}/${total}`, topicLabel(story.topic).toUpperCase(), SIGNAL_LABELS[story.signalType] ?? story.signalType];
  const publisher = story.publisher ? ` (${escapeHtml(clip(story.publisher, 60))})` : "";
  const headline = escapeHtml(clip(story.headline, 300));

  if (story.state === "SWAPPED_OUT") {
    const label = story.removed ? "🗑 <b>Removed</b>" : `🔄 <b>Swapped out</b> · story ${story.position}`;
    return {
      text: [label, `<s>${headline}</s>${publisher}`].join("\n"),
      replyMarkup: { inline_keyboard: [readButton(story.url)].filter((r) => r.length) },
    };
  }

  const stateLine = story.state === "KEPT" ? "✅ Kept" : story.state === "EDITED" ? "✏️ Edited" : null;
  const lines = [
    escapeHtml(meta.join(" · ")),
    ...(story.replacedPosition ? [`🔄 Replacement for story ${story.position}`] : []),
    `<b>${headline}</b>${publisher}`,
    escapeHtml(clip(story.commentary, 1200)),
    `<i>Why: ${escapeHtml(clip(story.rationale, 400))}</i>`,
    ...story.flags.slice(0, 10).map((f) => `⚠ ${escapeHtml(clip(formatFlag(f), 120))}`),
    ...(stateLine ? [stateLine] : []),
  ];

  const actions: InlineButton[] = [];
  if (REVIEWABLE.includes(status)) {
    if (story.state === "PENDING") actions.push({ text: "✅ Keep", callback_data: storyCallback("keep", story.id) });
    actions.push({ text: "✏️ Edit", callback_data: storyCallback("edit", story.id) });
    actions.push({ text: "🔄 Swap", callback_data: storyCallback("swap", story.id) });
  }
  // Two rows: four labelled buttons in one row truncate on phones.
  const rows: InlineButton[][] = [[...actions, ...readButton(story.url)]];
  if (REVIEWABLE.includes(status)) rows.push([{ text: "🗑 Remove", callback_data: storyCallback("remove", story.id) }]);
  return { text: lines.join("\n"), replyMarkup: { inline_keyboard: rows } };
}

function summaryLines(s: DraftSummary): string[] {
  const c = s.counts;
  const counts = [`✅ Kept ${c.KEPT}`, `✏️ Edited ${c.EDITED}`, `⏳ Pending ${c.PENDING}`, ...(c.SWAPPED_OUT ? [`🔄 Out ${c.SWAPPED_OUT}`] : [])];
  const topics = Object.entries(s.topics)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t, n]) => `${topicLabel(t)} ${n}`);
  return [
    counts.join(" · "),
    `Topics (${topics.length}): ${escapeHtml(topics.join(" · "))}`,
    `Backups left for Swap: ${s.backupsLeft}`,
    ...s.warnings.map((w) => `⚠ ${escapeHtml(w)}`),
  ];
}

function statusLine(s: DraftSummary): string {
  switch (s.status) {
    case "CONFIRMED":
      return `🚀 <b>Confirmed</b>${s.confirmedAt ? ` ${escapeHtml(formatIstDateTime(s.confirmedAt))}` : ""}. It will go out Thursday morning.`;
    case "HELD":
      return "⏸ <b>Held.</b> Nothing will be sent until you confirm again.";
    case "SENDING":
      return "📤 <b>Sending now.</b>";
    case "SENT":
      return "📬 <b>Sent.</b>";
    default:
      return s.counts.PENDING > 0
        ? `Status: in review. Review the ${s.counts.PENDING} pending ${s.counts.PENDING === 1 ? "story" : "stories"}, or approve them all, then confirm.`
        : "Status: in review. Every story is reviewed; confirm when ready.";
  }
}

function decisionButtons(s: DraftSummary): InlineButton[][] {
  const rows: InlineButton[][] = [];
  const open = s.status === "DRAFTING" || s.status === "IN_REVIEW" || s.status === "HELD";
  if (open && s.counts.PENDING > 0) rows.push([{ text: "✅ Approve all remaining", callback_data: issueCallback("approve_all", s.issueId) }]);
  if (open) rows.push([{ text: "🚀 Confirm final draft", callback_data: confirmCallback(s.issueId, s.contentHash) }]);
  if (s.status === "CONFIRMED" && s.sendNowAvailable) rows.push([{ text: "📤 Send now", callback_data: issueCallback("send_now", s.issueId) }]);
  if (s.status === "DRAFTING" || s.status === "IN_REVIEW" || s.status === "CONFIRMED") {
    rows.push([{ text: "⏸ Hold", callback_data: issueCallback("hold", s.issueId) }]);
  }
  return rows;
}

export function renderFinal(s: DraftSummary): Card {
  const text = [`<b>Final check</b> · ${escapeHtml(formatIssueDateShort(s.issueDate))}`, ...summaryLines(s), "", statusLine(s)].join("\n");
  return { text, replyMarkup: { inline_keyboard: decisionButtons(s) } };
}

export function renderReminder(s: DraftSummary): Card {
  const text = [
    `⏰ <b>No confirmation yet for Thursday's issue</b> (${escapeHtml(formatIssueDateShort(s.issueDate))})`,
    ...summaryLines(s),
    "",
    "If you don't confirm, the Thursday job will hold the issue and send nothing.",
  ].join("\n");
  return { text, replyMarkup: { inline_keyboard: decisionButtons(s) } };
}

export function renderSuperseded(): Card {
  return { text: "<i>Superseded. The latest summary card is further down.</i>" };
}

export function renderAlert(title: string, body: readonly string[] = []): Card {
  return { text: [`🚨 <b>${escapeHtml(title)}</b>`, ...body.map(escapeHtml)].join("\n") };
}

export function renderEditPrompt(position: number, current: string): string {
  return [
    `✏️ <b>Send the new commentary for story ${position}</b> as a reply to this message.`,
    "2–3 sentences, at most 65 words. Current text (tap to copy):",
    `<code>${escapeHtml(clip(current, 1500))}</code>`,
  ].join("\n");
}
