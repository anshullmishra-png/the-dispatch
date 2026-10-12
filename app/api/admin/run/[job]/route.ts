import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { JOBS, type Job } from "@/lib/issues";
import { isAdminRequest } from "@/lib/security";

export const runtime = "nodejs";
export const maxDuration = 300;

type Props = { params: Promise<{ job: string }> };

/** docs/02 §5: run any job now (demo), with force, through its own authenticated cron route. */
export async function POST(req: Request, { params }: Props) {
  const e = env();
  if (!isAdminRequest(req, e.ADMIN_TOKEN)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { job } = await params;
  if (!(JOBS as readonly string[]).includes(job)) return NextResponse.json({ ok: false, error: "unknown_job" }, { status: 404 });
  if (!e.CRON_SECRET || !e.APP_URL) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  const res = await fetch(new URL(`/api/cron/${job as Job}?force=1`, e.APP_URL), { headers: { authorization: `Bearer ${e.CRON_SECRET}` } });
  return NextResponse.json(await res.json(), { status: res.status });
}
