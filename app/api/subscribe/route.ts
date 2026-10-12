import { NextResponse } from "next/server";
import { z } from "zod";
import { subscribers } from "@/db/schema";
import { db } from "@/lib/db";
import { createLogger, maskEmail } from "@/lib/log";

export const runtime = "nodejs";

const Body = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()), website: z.string().optional() });

/** X9: format and duplicate checks. Real mail still only reaches SEND_ALLOWLIST while DEMO_MODE is on. */
export async function POST(req: Request) {
  const log = createLogger({ route: "subscribe" });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "That doesn't look like an email address." }, { status: 400 });
  const { email, website } = parsed.data;
  // Bots fill the hidden field; pretend success and store nothing.
  if (website) return NextResponse.json({ ok: true, message: "You're on the list. See you Thursday." });
  if (email.length > 254) return NextResponse.json({ ok: false, message: "That address is too long." }, { status: 400 });

  const inserted = await db()
    .insert(subscribers)
    .values({ email, status: "active", source: "web", confirmedAt: new Date() })
    .onConflictDoNothing({ target: subscribers.email })
    .returning({ id: subscribers.id });
  log.info("subscribe", { email: maskEmail(email), duplicate: inserted.length === 0 });
  if (!inserted.length) return NextResponse.json({ ok: true, message: "You're already on the list." });
  return NextResponse.json({ ok: true, message: "You're on the list. See you Thursday." });
}
