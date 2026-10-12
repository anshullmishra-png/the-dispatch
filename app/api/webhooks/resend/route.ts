import { NextResponse } from "next/server";
import { emailEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/log";
import { verifySvix } from "@/lib/mail/svix";
import { isPermanentBounce, markBounced, markComplained, subscriberIdByEmail } from "@/lib/subscribers/hygiene";

export const runtime = "nodejs";

interface ResendEvent {
  type?: string;
  data?: { email_id?: string; to?: string[]; bounce?: { type?: string; subType?: string } };
}

export async function POST(req: Request) {
  const log = createLogger({ route: "webhooks/resend" });
  const raw = await req.text(); // verify the raw body, before parsing
  if (!verifySvix(raw, req.headers, env().RESEND_WEBHOOK_SECRET)) {
    log.warn("rejected resend webhook: bad signature");
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const event = JSON.parse(raw) as ResendEvent;
  const type = event.type ?? "unknown";
  const email = event.data?.to?.[0]?.toLowerCase();
  const subscriberId = email ? await subscriberIdByEmail(email) : null;
  const inserted = await db()
    .insert(emailEvents)
    .values({ svixId: req.headers.get("svix-id") as string, resendId: event.data?.email_id ?? null, type, subscriberId, payload: event })
    .onConflictDoNothing({ target: emailEvents.svixId })
    .returning({ id: emailEvents.id });
  if (!inserted.length) return NextResponse.json({ ok: true, duplicate: true });

  let applied: string | null = null;
  if (email && type === "email.bounced" && isPermanentBounce(event.data?.bounce?.type)) {
    const bounceType = event.data?.bounce?.subType || event.data?.bounce?.type || "Permanent";
    applied = (await markBounced(email, bounceType)) ? "bounced" : null;
  } else if (email && type === "email.complained") {
    applied = (await markComplained(email)) ? "complained" : null;
  }
  log.info("resend event", { type, matched: subscriberId !== null, applied });
  return NextResponse.json({ ok: true, applied });
}
