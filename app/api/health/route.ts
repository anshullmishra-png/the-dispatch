import { NextResponse } from "next/server";
import { configuredFeatures, env, EnvError } from "@/lib/env";
import { createLogger } from "@/lib/log";
import { collectingIssueDate, formatIstDateTime, targetIssueDate } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET() {
  const log = createLogger({ route: "health" });
  const now = new Date();

  try {
    const e = env();
    return NextResponse.json({
      ok: true,
      service: "the-dispatch",
      now: now.toISOString(),
      nowIst: formatIstDateTime(now),
      collectingIssue: collectingIssueDate(now),
      targetIssue: targetIssueDate(now),
      model: e.GEMINI_MODEL ?? null,
      geminiMock: e.GEMINI_MOCK,
      demoMode: e.DEMO_MODE,
      db: "not_configured",
      configured: configuredFeatures(e),
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    });
  } catch (err) {
    if (err instanceof EnvError) {
      log.error("invalid environment", { keys: err.keys });
      return NextResponse.json({ ok: false, error: "invalid_env", keys: err.keys }, { status: 500 });
    }
    log.error("health check failed", { err });
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
