import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/log";
import { safeEqual } from "@/lib/security";
import { handleUpdate, type TgUpdate } from "@/lib/telegram/handlers";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Telegram sends the secret given to setWebhook in this header on every update. */
const SECRET_HEADER = "x-telegram-bot-api-secret-token";

export async function POST(req: Request) {
  const log = createLogger({ route: "telegram/webhook" });
  const secret = env().TELEGRAM_WEBHOOK_SECRET;
  const presented = req.headers.get(SECRET_HEADER);
  // Fails closed: no configured secret means no update is trusted.
  if (!secret || !presented || !safeEqual(presented, secret)) {
    log.warn("rejected webhook call: bad or missing secret");
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  if (!update || typeof update.update_id !== "number") return NextResponse.json({ ok: true });
  try {
    await handleUpdate(update, log);
  } catch (err) {
    // Still 200: a non-2xx makes Telegram redeliver the same update in a loop.
    log.error("update handling failed", { updateId: update.update_id, err });
  }
  return NextResponse.json({ ok: true });
}
