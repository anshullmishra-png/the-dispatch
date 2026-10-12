import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, pingDb } from "@/lib/db";
import { configuredFeatures, env, EnvError } from "@/lib/env";
import { createLogger } from "@/lib/log";
import { collectingIssueDate, formatIstDateTime, targetIssueDate } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 10;

type DbStatus =
  | "not_configured"
  | { ok: true; latencyMs: number }
  | { ok: false; error: string };

async function checkDb(configured: boolean): Promise<{ status: DbStatus; lastRuns: Record<string, unknown> }> {
  if (!configured) return { status: "not_configured", lastRuns: {} };
  try {
    const ping = await pingDb();
    const { rows } = await db().execute(sql`
      select distinct on (job) job, started_at, finished_at, ok, trigger
      from pipeline_runs order by job, started_at desc`);
    const lastRuns = Object.fromEntries(rows.map((r) => [String(r.job), r]));
    return { status: ping, lastRuns };
  } catch {
    return { status: { ok: false, error: "unreachable" }, lastRuns: {} };
  }
}

export async function GET() {
  const log = createLogger({ route: "health" });
  const now = new Date();

  try {
    const e = env();
    const features = configuredFeatures(e);
    const { status: dbStatus, lastRuns } = await checkDb(features.database);
    const ok = dbStatus === "not_configured" || dbStatus.ok;
    if (!ok) log.error("database unreachable");

    return NextResponse.json(
      {
        ok,
        service: "the-dispatch",
        now: now.toISOString(),
        nowIst: formatIstDateTime(now),
        collectingIssue: collectingIssueDate(now),
        targetIssue: targetIssueDate(now),
        model: e.GEMINI_MODEL ?? null,
        geminiMock: e.GEMINI_MOCK,
        demoMode: e.DEMO_MODE,
        db: dbStatus,
        lastRuns,
        configured: features,
        region: process.env.VERCEL_REGION ?? null,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null,
      },
      { status: ok ? 200 : 503 },
    );
  } catch (err) {
    if (err instanceof EnvError) {
      log.error("invalid environment", { keys: err.keys });
      return NextResponse.json({ ok: false, error: "invalid_env", keys: err.keys }, { status: 500 });
    }
    log.error("health check failed", { err });
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
