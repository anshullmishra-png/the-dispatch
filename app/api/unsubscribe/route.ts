import { NextResponse } from "next/server";
import { createLogger } from "@/lib/log";
import { verifyUnsubToken } from "@/lib/mail/tokens";
import { unsubscribe } from "@/lib/subscribers/hygiene";

export const runtime = "nodejs";

/**
 * One-click (RFC 8058, from the List-Unsubscribe header) and the confirmation
 * page's form both POST here. Idempotent. A GET never unsubscribes.
 */
export async function POST(req: Request) {
  const log = createLogger({ route: "unsubscribe" });
  const url = new URL(req.url);
  const form = await req.formData().catch(() => null);
  const token = url.searchParams.get("t") || String(form?.get("t") ?? "");
  const fromPage = form?.get("from") === "page";
  const id = verifyUnsubToken(token);
  if (!id) {
    log.warn("invalid unsubscribe token");
    return fromPage
      ? NextResponse.redirect(new URL("/unsubscribe?status=invalid", url), 303)
      : NextResponse.json({ ok: false, error: "invalid_token" }, { status: 400 });
  }
  const changed = await unsubscribe({ id });
  log.info("unsubscribe", { changed });
  return fromPage ? NextResponse.redirect(new URL("/unsubscribe?status=done", url), 303) : NextResponse.json({ ok: true, changed });
}
