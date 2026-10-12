// Telegram Bot API over plain fetch (docs/05-INTEGRATIONS.md §3). No framework.
// Errors carry the method and Telegram's description, never the token.
import { requireEnv } from "@/lib/env";

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}
export interface InlineKeyboard {
  inline_keyboard: InlineButton[][];
}
export interface ForceReply {
  force_reply: true;
  input_field_placeholder?: string;
}
export type ReplyMarkup = InlineKeyboard | ForceReply;

export class TelegramError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    readonly description: string,
    readonly retryAfter?: number,
  ) {
    super(`telegram ${method} failed (${code}): ${description}`);
    this.name = "TelegramError";
  }
}

const API = "https://api.telegram.org";
const CALL_TIMEOUT_MS = 10_000;
/** The chat limit is about 1 msg/s; space sends at least this far apart (docs/05 §3). */
export const SEND_SPACING_MS = 350;
/** docs/02 failure table: retry a failed send once after 2 s. */
export const RETRY_DELAY_MS = 2_000;
export const MAX_MESSAGE_CHARS = 4096;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function tgCall<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const { TELEGRAM_BOT_TOKEN } = requireEnv("TELEGRAM_BOT_TOKEN");
  let res: Response;
  try {
    res = await fetch(`${API}/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (err) {
    // fetch errors can echo the URL, which contains the token: keep only the kind.
    const kind = err instanceof Error && err.name === "TimeoutError" ? "timeout" : "network error";
    throw new TelegramError(method, 0, kind);
  }
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    result?: T;
    description?: string;
    error_code?: number;
    parameters?: { retry_after?: number };
  } | null;
  if (!body?.ok) {
    throw new TelegramError(method, body?.error_code ?? res.status, body?.description ?? `HTTP ${res.status}`, body?.parameters?.retry_after);
  }
  return body.result as T;
}

let lastSendAt = 0;

/** Serialises spacing between outgoing messages within one invocation. */
async function spaced<T>(fn: () => Promise<T>): Promise<T> {
  const wait = lastSendAt + SEND_SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  try {
    return await fn();
  } finally {
    lastSendAt = Date.now();
  }
}

/** One retry: after Telegram's retry_after when it gives one (≤5 s), else 2 s. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TelegramError && err.code >= 400 && err.code < 500 && err.code !== 429) throw err;
    const delay = err instanceof TelegramError && err.retryAfter ? Math.min(err.retryAfter * 1000, 5_000) : RETRY_DELAY_MS;
    await sleep(delay);
    return fn();
  }
}

interface Message {
  message_id: number;
}

export async function sendMessage(
  chatId: number,
  text: string,
  opts: { replyMarkup?: ReplyMarkup; replyTo?: number } = {},
): Promise<number> {
  const msg = await spaced(() =>
    withRetry(() =>
      tgCall<Message>("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(opts.replyMarkup ? { reply_markup: opts.replyMarkup } : {}),
        ...(opts.replyTo ? { reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true } } : {}),
      }),
    ),
  );
  return msg.message_id;
}

/** Edits a card in place. "Not modified" and "message gone" are not failures. */
export async function editMessageText(chatId: number, messageId: number, text: string, replyMarkup?: InlineKeyboard): Promise<boolean> {
  try {
    await spaced(() =>
      tgCall("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: replyMarkup ?? { inline_keyboard: [] },
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof TelegramError && /not modified|message to edit not found|can't be edited/i.test(err.description)) return false;
    throw err;
  }
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string, showAlert = false): Promise<void> {
  try {
    await tgCall("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...(text ? { text: text.slice(0, 200), show_alert: showAlert } : {}),
    });
  } catch (err) {
    // A query older than ~15 minutes can no longer be answered; nothing to do.
    if (err instanceof TelegramError && /query is too old|query ID is invalid/i.test(err.description)) return;
    throw err;
  }
}

export interface WebhookInfo {
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  allowed_updates?: string[];
  ip_address?: string;
}

export async function setWebhook(url: string, secretToken: string): Promise<void> {
  await tgCall("setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
}

export async function getWebhookInfo(): Promise<WebhookInfo> {
  return tgCall<WebhookInfo>("getWebhookInfo", {});
}

export async function getMe(): Promise<{ id: number; username: string }> {
  return tgCall("getMe", {});
}
