import { NextResponse } from "next/server";
import { z } from "zod";
import { checkHeadline } from "@/lib/site/proof";

export const runtime = "nodejs";

const Body = z.object({ headline: z.string().trim().min(8).max(300) });

/** Public, read-only: runs the ingest dedupe rule on a pasted headline. Stores nothing. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Paste a headline of 8–300 characters." }, { status: 400 });
  return NextResponse.json({ ok: true, ...(await checkHeadline(parsed.data.headline)) });
}
