import { NextResponse } from "next/server";
import { pingDb } from "@/lib/db";
import { env } from "@/lib/env";
import { isAdminRequest } from "@/lib/security";
import { getMe } from "@/lib/telegram/api";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Admin-only: proves the DEPLOYED keys work by calling each service once from
 * the server. Returns HTTP statuses only, never a key. Sends no email and no
 * Telegram message; Gemini gets one tiny prompt.
 */
export async function GET(req: Request) {
  const e = env();
  if (!isAdminRequest(req, e.ADMIN_TOKEN)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const status = async (p: Promise<Response>) => {
    try {
      return (await p).status;
    } catch {
      return 0;
    }
  };
  const timeout = () => AbortSignal.timeout(15_000);
  const [db, gemini, gnews, resend, telegram] = await Promise.all([
    pingDb().then(() => 200).catch(() => 0),
    status(
      fetch(`https://generativelanguage.googleapis.com/v1beta/models/${e.GEMINI_MODEL}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": e.GEMINI_API_KEY ?? "" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Reply OK" }] }], generationConfig: { maxOutputTokens: 10 } }),
        signal: timeout(),
      }),
    ),
    status(fetch(`https://gnews.io/api/v4/search?q=startup&max=1&apikey=${encodeURIComponent(e.NEWS_API_KEY ?? "")}`, { signal: timeout() })),
    status(fetch("https://api.resend.com/domains", { headers: { authorization: `Bearer ${e.RESEND_API_KEY ?? ""}` }, signal: timeout() })),
    getMe()
      .then((m) => m.username)
      .catch(() => null),
  ]);
  return NextResponse.json({
    ok: db === 200 && gemini === 200 && [200, 403, 429].includes(gnews) && resend === 200 && telegram !== null,
    db,
    gemini,
    gnews, // 403/429 = key accepted but today's quota used; 401 = bad key
    resend,
    telegram,
  });
}
