// Observable evidence for the public dashboard: the live send gate, the audit
// trail, the week's timeline, send attempts and list hygiene. Read-only; no
// subscriber addresses or secrets leave this module.
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { approvals, emailEvents, issues, issueStories, pipelineRuns, sources, styleGuides, subscribers, telegramMessages } from "@/db/schema";
import { checkSendAllowed, computeContentHash, type IssueStatus, type SendFailure } from "@/lib/approval/fsm";
import { parseNeverSay, splitSentences, voiceLint, wordCount } from "@/lib/curate/lint";
import { db } from "@/lib/db";
import { extractEntities, normalizeTitle } from "@/lib/dedupe/normalize";
import { judgePair } from "@/lib/dedupe/engine";
import { loadLastFourSet, matchLastFour } from "@/lib/dedupe/history";
import { configuredFeatures, env } from "@/lib/env";
import { formatIstDateTime, istDate, targetIssueDate } from "@/lib/time";
import { upcomingJobs } from "./schedule";

// ---------------------------------------------------------------- send gate

const GATE_LABELS: [SendFailure, string][] = [
  ["status_not_confirmed", "Status is CONFIRMED"],
  ["wrong_confirmer", "Confirmed by Shreya's Telegram account"],
  ["not_confirmed", "Confirmation time recorded"],
  ["hash_changed", "Content unchanged since she confirmed (SHA-256)"],
  ["no_confirm_approval", "A matching confirm entry in the audit trail"],
  ["already_sent", "Not already sent"],
];

export async function sendGate(issueId: string) {
  const [issue] = await db()
    .select({ status: issues.status, confirmedBy: issues.confirmedBy, confirmedAt: issues.confirmedAt, contentHash: issues.contentHash, sentAt: issues.sentAt })
    .from(issues)
    .where(eq(issues.id, issueId));
  if (!issue) return null;
  const confirms = await db()
    .select({ hash: approvals.contentHash })
    .from(approvals)
    .where(and(eq(approvals.issueId, issueId), eq(approvals.action, "confirm")));
  const shreya = Number(env().SHREYA_TG_USER_ID ?? Number.NaN);
  const failures = checkSendAllowed({
    status: issue.status,
    confirmedBy: issue.confirmedBy,
    confirmedAt: issue.confirmedAt,
    storedHash: issue.contentHash,
    freshHash: await computeContentHash(issueId),
    confirmApprovalHashes: confirms.map((c) => c.hash).filter((h): h is string => h !== null),
    sentAt: issue.sentAt,
    shreyaTgId: shreya,
  });
  return {
    status: issue.status as IssueStatus,
    checks: GATE_LABELS.map(([code, label]) => ({ label, ok: !failures.includes(code) })),
    allowed: failures.length === 0,
  };
}

// ---------------------------------------------------------------- audit trail

const ACTION_TEXT: Record<string, string> = {
  keep: "Kept",
  edit: "Edited commentary",
  swap: "Swapped for a backup",
  remove: "Removed",
  approve_all: "Approved all remaining",
  confirm: "Confirmed the final draft",
  hold: "Held the issue",
  reset_by_edit: "Change after confirming: confirmation reset to review",
  send_now: "Sent now",
  unconfirm: "Unconfirmed",
};

export async function auditTrail(issueId: string) {
  const shreya = env().SHREYA_TG_USER_ID;
  const rows = await db()
    .select({ at: approvals.at, action: approvals.action, actor: approvals.actorTgId, detail: approvals.detail, position: issueStories.position, headline: issueStories.headline })
    .from(approvals)
    .leftJoin(issueStories, eq(issueStories.id, approvals.storyId))
    .where(eq(approvals.issueId, issueId))
    .orderBy(desc(approvals.at))
    .limit(40);
  return rows.map((r) => {
    const d = (r.detail ?? {}) as Record<string, unknown>;
    const extra =
      r.action === "approve_all"
        ? `${d.count ?? "?"} ${d.count === 1 ? "story" : "stories"}`
        : r.action === "edit" && typeof d.similarity === "number"
          ? `${Math.round((1 - d.similarity) * 100)}% changed${d.lintOverride ? ", voice check overridden" : ""}`
          : r.action === "hold" && d.by === "send_job"
            ? "by the Thursday send job (not confirmed)"
            : "";
    return {
      at: r.at,
      what: ACTION_TEXT[r.action] ?? r.action,
      story: r.headline ? `${r.position ?? ""}${r.position ? ". " : ""}${r.headline}` : null,
      extra,
      who: r.actor === null ? "system" : shreya && String(r.actor) === shreya ? "Shreya (Telegram)" : "other",
    };
  });
}

// ---------------------------------------------------------------- settings

export async function settingsData() {
  const [guide] = await db().select({ version: styleGuides.version }).from(styleGuides).where(eq(styleGuides.active, true));
  const [src] = await db()
    .select({
      rss: sql<number>`count(*) filter (where ${sources.kind} = 'rss' and ${sources.active})::int`,
      gnews: sql<number>`count(*) filter (where ${sources.kind} = 'gnews' and ${sources.active})::int`,
    })
    .from(sources);
  const [tg] = await db().select({ at: sql<Date | null>`max(${telegramMessages.createdAt})` }).from(telegramMessages);
  const f = configuredFeatures();
  return {
    styleGuideVersion: guide?.version ?? null,
    rss: src?.rss ?? 0,
    gnews: src?.gnews ?? 0,
    telegram: f.telegram && f.telegramAllowlist,
    lastTelegramAt: tg?.at ? new Date(tg.at) : null,
  };
}

// ---------------------------------------------------------------- job alerts for the desk

/** Plain-language alerts when the latest run of a job for this issue failed (no stack traces). */
export async function jobAlerts(issueId: string, status: IssueStatus): Promise<string[]> {
  const runs = await db()
    .select({ job: pipelineRuns.job, ok: pipelineRuns.ok, error: pipelineRuns.error, startedAt: pipelineRuns.startedAt })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.issueId, issueId))
    .orderBy(desc(pipelineRuns.startedAt));
  const latest = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!latest.has(r.job) && r.ok !== null) latest.set(r.job, r);
  const when = (r: { startedAt: Date }) => formatIstDateTime(r.startedAt);
  const out: string[] = [];
  const ingest = latest.get("ingest");
  if (ingest && !ingest.ok) out.push(`Article collection failed at ${when(ingest)}. It retries at the next scheduled run.`);
  const curate = latest.get("curate");
  if (curate && !curate.ok) {
    out.push(
      /gemini/i.test(curate.error ?? "")
        ? `Gemini couldn't draft at ${when(curate)} (the service was busy). The draft below is from the last successful run.`
        : `Drafting failed at ${when(curate)}. The draft below is from the last successful run.`,
    );
  }
  const notify = latest.get("notify");
  if (notify && !notify.ok) out.push(`The Telegram draft couldn't be delivered at ${when(notify)}. You can review everything here instead.`);
  const remind = latest.get("remind");
  if (remind && !remind.ok) out.push(`The Wednesday reminder couldn't be sent at ${when(remind)}.`);
  const send = latest.get("send");
  if (send && !send.ok && status !== "SENT" && !(send.error ?? "").startsWith("held")) out.push(`The email job failed at ${when(send)}. Nothing was sent.`);
  return out;
}

// ---------------------------------------------------------------- week timeline

export type StepState = "done" | "due" | "skipped" | "failed" | "waiting";

export async function weekTimeline(issue: { id: string; issueDate: string; status: IssueStatus; confirmedAt: Date | null; sentAt: Date | null }, now = new Date()) {
  const runs = await db()
    .select({ job: pipelineRuns.job, startedAt: pipelineRuns.startedAt, ok: pipelineRuns.ok, stats: pipelineRuns.stats, error: pipelineRuns.error })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.issueId, issue.id))
    .orderBy(asc(pipelineRuns.startedAt));
  const last = (job: string) => [...runs].reverse().find((r) => r.job === job);
  const lastOk = (job: string) => [...runs].reverse().find((r) => r.job === job && r.ok);
  const next = Object.fromEntries(upcomingJobs(now).map((j) => [j.job, j.next]));
  const ingestDays = [...new Set(runs.filter((r) => r.job === "ingest" && r.ok).map((r) => istDate(r.startedAt)))];
  const step = (label: string, when: string, state: StepState, at: Date | null, note = "") => ({ label, when, state, at, note });
  const reminder = last("remind");
  const remindNote =
    reminder?.ok && (reminder.stats as Record<string, unknown> | null)?.messageId
      ? "sent: she had not confirmed"
      : issue.confirmedAt
        ? "not needed: already confirmed"
        : "sent only if still unconfirmed";
  const send = last("send");
  const sendKind = (send?.stats as Record<string, unknown> | null)?.kind;
  return [
    step("Ingest (RSS + GNews)", "Mon–Wed 08:30–09:29 IST", ingestDays.length ? "done" : "due", lastOk("ingest")?.startedAt ?? null, `${ingestDays.length} day(s) with a successful run`),
    step("Gemini editorial selection", "Wed 14:30–15:29 IST", lastOk("curate") ? "done" : last("curate") ? "failed" : "due", lastOk("curate")?.startedAt ?? null),
    step("Draft delivered on Telegram", "Wed 17:30–18:29 IST", lastOk("notify") ? "done" : "due", lastOk("notify")?.startedAt ?? null),
    step("Shreya confirms", "any time before the send", issue.confirmedAt ? "done" : "waiting", issue.confirmedAt),
    step(
      "Reminder if not confirmed",
      "Wed, first check at or after 10 PM IST (checks at 21:30–22:29 and 22:30–23:29; never before 10 PM)",
      reminder?.ok ? "done" : issue.confirmedAt ? "skipped" : "due",
      reminder?.startedAt ?? null,
      remindNote,
    ),
    step(
      "Email to subscribers",
      "Thu 07:30–08:29 IST",
      issue.sentAt ? "done" : sendKind === "held" ? "skipped" : "due",
      issue.sentAt ?? (sendKind === "held" ? (send?.startedAt ?? null) : null),
      issue.sentAt ? "sent after confirmation" : sendKind === "held" ? "held by the gate: not confirmed" : next.send ? `next send run ${formatIstDateTime(next.send)}` : "",
    ),
  ];
}

// ---------------------------------------------------------------- send attempts (survive demo resets)

export async function sendAttempts() {
  const rows = await db()
    .select({ startedAt: pipelineRuns.startedAt, ok: pipelineRuns.ok, stats: pipelineRuns.stats, error: pipelineRuns.error, trigger: pipelineRuns.trigger, issueDate: issues.issueDate })
    .from(pipelineRuns)
    .leftJoin(issues, eq(issues.id, pipelineRuns.issueId))
    .where(eq(pipelineRuns.job, "send"))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(12);
  return rows.map((r) => {
    const s = (r.stats ?? {}) as { kind?: string; reason?: string; report?: { counts?: Record<string, number> } };
    const c = s.report?.counts ?? {};
    const outcome =
      s.kind === "sent" ? "● sent" : s.kind === "held" ? "! held by the gate" : s.kind === "partial" ? "◐ partly sent, resuming" : s.kind === "already_sent" ? "already sent" : r.ok === false ? "! failed" : "—";
    return {
      at: r.startedAt,
      issueDate: r.issueDate,
      trigger: r.trigger,
      outcome,
      reason: s.kind === "held" ? (s.reason ?? r.error ?? "").replace(/^status_/, "status was ") : "",
      sent: c.sent ?? 0,
      skipped: c.skipped_demo ?? 0,
      failed: c.failed ?? 0,
    };
  });
}

// ---------------------------------------------------------------- list hygiene + delivery mode

export async function hygiene() {
  const events = await db()
    .select({ type: emailEvents.type, at: emailEvents.at, svixId: emailEvents.svixId })
    .from(emailEvents)
    .orderBy(desc(emailEvents.at))
    .limit(10);
  const [counts] = await db()
    .select({
      active: sql<number>`count(*) filter (where ${subscribers.status} = 'active')::int`,
      excluded: sql<number>`count(*) filter (where ${subscribers.status} <> 'active')::int`,
      real: sql<number>`count(*) filter (where not ${subscribers.isTest})::int`,
      synthetic: sql<number>`count(*) filter (where ${subscribers.isTest} and ${subscribers.email} not like '%@resend.dev')::int`,
      resendTest: sql<number>`count(*) filter (where ${subscribers.email} like '%@resend.dev')::int`,
    })
    .from(subscribers);
  const e = env();
  return {
    events: events.map((ev) => ({ type: ev.type, at: ev.at, source: ev.svixId.startsWith("msg_e2e_") ? "signed test event" : "Resend" })),
    counts: counts ?? { active: 0, excluded: 0, real: 0, synthetic: 0, resendTest: 0 },
    delivery: {
      demoMode: e.DEMO_MODE,
      allowlisted: e.SEND_ALLOWLIST.length,
      sender: (e.MAIL_FROM ?? "").replace(/^.*<|>.*$/g, "").replace(/^[^@]*@/, "@"),
    },
  };
}

// ---------------------------------------------------------------- per-pick voice check

export async function voiceChecks(commentaries: readonly { id: string; text: string }[]) {
  const [guide] = await db().select({ content: styleGuides.content }).from(styleGuides).where(eq(styleGuides.active, true));
  const neverSay = guide ? parseNeverSay(guide.content) : [];
  return Object.fromEntries(
    commentaries.map((c) => [c.id, { sentences: splitSentences(c.text).length, words: wordCount(c.text), errors: voiceLint(c.text, neverSay).errors }]),
  );
}

/** Runs the Last-4 match on each live pick right now (not just trusting curate's validator). */
export async function lastFourChecks(issueDate: string, picks: readonly { id: string; headline: string }[]) {
  const set = await loadLastFourSet(issueDate);
  return Object.fromEntries(
    picks.map((p) => {
      const hit = matchLastFour({ titleNorm: normalizeTitle(p.headline), entities: extractEntities(p.headline), canonicalHash: "" }, set);
      return [p.id, hit ? hit.entry.issueDate : null];
    }),
  );
}

// ---------------------------------------------------------------- headline checker (same code as ingest)

export async function checkHeadline(headline: string) {
  const text = headline.trim().slice(0, 300);
  const titleNorm = normalizeTitle(text);
  const entities = extractEntities(text);
  const [issue] = await db().select({ id: issues.id, issueDate: issues.issueDate }).from(issues).where(eq(issues.issueDate, targetIssueDate(new Date())));
  const lastFour = await loadLastFourSet(issue?.issueDate ?? targetIssueDate(new Date()));
  const hit = matchLastFour({ titleNorm, entities, canonicalHash: "" }, lastFour);
  let week: { title: string; publisher: string | null; similarity: number; shared: number; duplicate: boolean } | null = null;
  if (issue && titleNorm) {
    const { rows } = await db().execute<{ title: string; publisher: string | null; entities: string[]; sim: number }>(sql`
      select title, publisher, entities, similarity(title_norm, ${titleNorm}) as sim
      from articles where issue_id = ${issue.id} and title_norm % ${titleNorm}
      order by sim desc limit 15`);
    const judged = rows.map((r) => ({ ...r, ...judgePair(Number(r.sim), entities, r.entities) }));
    const best = judged.find((r) => r.duplicate) ?? judged[0];
    if (best) week = { title: best.title, publisher: best.publisher, similarity: Number(best.sim), shared: best.shared, duplicate: best.duplicate };
  }
  return {
    normalized: titleNorm,
    entities,
    week,
    lastFour: hit
      ? { issueDate: hit.entry.issueDate, headline: hit.entry.headline, similarity: hit.similarity, shared: hit.shared }
      : null,
    lastFourSize: lastFour.length,
  };
}

export async function lastFourList() {
  const [issue] = await db().select({ issueDate: issues.issueDate }).from(issues).where(eq(issues.issueDate, targetIssueDate(new Date())));
  const set = await loadLastFourSet(issue?.issueDate ?? targetIssueDate(new Date()));
  const byIssue = new Map<string, string[]>();
  for (const e of set) byIssue.set(e.issueDate, [...(byIssue.get(e.issueDate) ?? []), e.headline]);
  return [...byIssue.entries()].map(([issueDate, headlines]) => ({ issueDate, headlines }));
}
