import { NextResponse } from "next/server";
import { env, EnvError, requireEnv } from "@/lib/env";
import { createLogger } from "@/lib/log";
import { isAdminRequest } from "@/lib/security";
import { getMe, getWebhookInfo, setWebhook, TelegramError, type WebhookInfo } from "@/lib/telegram/api";

export const runtime = "nodejs";
export const maxDuration = 30;

const describe = (info: WebhookInfo) => ({
  url: info.url || null,
  pendingUpdates: info.pending_update_count,
  allowedUpdates: info.allowed_updates ?? null,
  lastError: info.last_error_message ?? null,
  lastErrorAt: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
});

async function guarded(req: Request, fn: () => Promise<Response>) {
  const log = createLogger({ route: "admin/telegram-setup" });
  if (!isAdminRequest(req, env().ADMIN_TOKEN)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    return await fn();
  } catch (err) {
    if (err instanceof EnvError) return NextResponse.json({ ok: false, error: "not_configured", missing: err.keys }, { status: 503 });
    if (err instanceof TelegramError) {
      log.error("telegram setup failed", { method: err.method, code: err.code });
      return NextResponse.json({ ok: false, error: "telegram_error", method: err.method, description: err.description }, { status: 502 });
    }
    throw err;
  }
}

/** Shows the bot and its current webhook (no secrets). */
export async function GET(req: Request) {
  return guarded(req, async () => {
    const [me, info] = await Promise.all([getMe(), getWebhookInfo()]);
    return NextResponse.json({ ok: true, bot: me.username, webhook: describe(info) });
  });
}

/** Points the bot's webhook at this deployment's APP_URL with the shared secret. */
export async function POST(req: Request) {
  return guarded(req, async () => {
    const { APP_URL, TELEGRAM_WEBHOOK_SECRET } = requireEnv("APP_URL", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_BOT_TOKEN");
    const url = new URL("/api/telegram/webhook", APP_URL).toString();
    await setWebhook(url, TELEGRAM_WEBHOOK_SECRET);
    const [me, info] = await Promise.all([getMe(), getWebhookInfo()]);
    return NextResponse.json({ ok: info.url === url, bot: me.username, webhook: describe(info) });
  });
}
