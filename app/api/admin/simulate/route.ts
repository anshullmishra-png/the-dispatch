import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { isAdminRequest } from "@/lib/security";
import { markBounced, markComplained, unsubscribe } from "@/lib/subscribers/hygiene";

export const runtime = "nodejs";

const Body = z.object({ action: z.enum(["bounce", "complaint", "unsubscribe"]), email: z.email() });

/** X6: demo R15/R16 without a real bounce, via the same hygiene functions as the webhook. */
export async function POST(req: Request) {
  const e = env();
  if (!isAdminRequest(req, e.ADMIN_TOKEN)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!e.DEMO_MODE) return NextResponse.json({ ok: false, error: "demo_mode_only" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  const { action, email } = parsed.data;
  const changed =
    action === "bounce"
      ? (await markBounced(email, "Simulated")) !== null
      : action === "complaint"
        ? (await markComplained(email)) !== null
        : await unsubscribe({ email });
  return NextResponse.json({ ok: true, action, changed });
}
