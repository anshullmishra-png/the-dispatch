import { eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { sendLog } from "@/db/schema";
import { loadReview, type ReviewState } from "@/lib/approval/review";
import { db } from "@/lib/db";
import { jobAlerts, lastFourChecks, sendAttempts, voiceChecks } from "@/lib/site/proof";
import { dashboardData } from "@/lib/site/queries";
import { upcomingJobs } from "@/lib/site/schedule";
import { formatFlag, topicLabel } from "@/lib/telegram/cards";
import { formatIssueDateShort, formatIstDateTime, istParts } from "@/lib/time";
import {
  approveAllAction,
  confirmAction,
  editAction,
  holdAction,
  keepAction,
  removeAction,
  swapAction,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Editor's desk · The Dispatch", robots: { index: false } };

type Props = { searchParams: Promise<{ msg?: string }> };

const SIGNALS: Record<string, string> = { counterintuitive: "Counterintuitive", under_reported: "Under-reported", trend_link: "Trend link" };
const OPEN = new Set(["DRAFTING", "IN_REVIEW", "HELD", "CONFIRMED"]);

function greeting(now: Date): string {
  const h = istParts(now).hour;
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** One sentence and one primary action for the issue's state. */
function nextStep(status: string, pending: number): { line: string; primary: "review" | "confirm" | "preview" } {
  if (status === "SENT") return { line: "This issue has gone out.", primary: "preview" };
  if (status === "CONFIRMED") return { line: "Your issue is confirmed. It goes out on Thursday morning.", primary: "preview" };
  if (status === "HELD") return pending ? { line: "Your issue is on hold. Review the open stories, then confirm.", primary: "review" } : { line: "Your issue is on hold. Confirm it to send.", primary: "confirm" };
  if (pending) return { line: "Your next issue is ready for review.", primary: "review" };
  return { line: "Every story is reviewed. Confirm when you're ready.", primary: "confirm" };
}

function editorialStatus(r: ReviewState): { label: string; alert: boolean } {
  const st = r.issue.status;
  if (st === "IN_REVIEW") return { label: r.summary.counts.PENDING ? `Awaiting you · ${r.summary.counts.PENDING} open` : "Reviewed · not confirmed", alert: false };
  if (st === "HELD") return { label: "Held", alert: true };
  if (st === "DRAFTING") return { label: "Drafted", alert: false };
  return { label: `Confirmed${r.issue.confirmedAt ? ` ${formatIstDateTime(r.issue.confirmedAt).slice(11, 16)}` : ""}`, alert: false };
}

export default async function Desk({ searchParams }: Props) {
  const { msg } = await searchParams;
  // Open desk (user decision): every visitor can act, as Shreya, through the same gate.
  const canEdit = true;
  const [d, attempts] = await Promise.all([dashboardData(), sendAttempts()]);
  const review = d.issue && d.figures.picked ? await loadReview(d.issue.id) : null;
  const sendRun = upcomingJobs(new Date()).find((j) => j.job === "send");

  if (!d.issue || !review) {
    return (
      <section className="section">
        <p className="eyebrow">Editor&rsquo;s desk</p>
        <h1 className="page-title">No draft yet</h1>
        <p style={{ marginTop: 16 }}>
          Articles for {d.issue ? formatIssueDateShort(d.issue.issueDate) : "this Thursday"} are being collected ({d.figures.fetched} so far). Gemini drafts the
          issue on Wednesday afternoon and the cards arrive on your Telegram that evening.
        </p>
      </section>
    );
  }

  const issueId = review.issue.id;
  const status = review.issue.status;
  const ed = editorialStatus(review);
  const pending = review.summary.counts.PENDING;
  const step = nextStep(status, pending);
  const open = OPEN.has(status);
  const [delivered] = status === "SENT"
    ? await db()
        .select({
          sent: sql<number>`count(*) filter (where ${sendLog.status} = 'sent')::int`,
          skipped: sql<number>`count(*) filter (where ${sendLog.status} = 'skipped_demo')::int`,
          failed: sql<number>`count(*) filter (where ${sendLog.status} = 'failed')::int`,
        })
        .from(sendLog)
        .where(eq(sendLog.issueId, issueId))
    : [];
  // Only while the issue is actually held: a later Confirm makes an old held run history, not the outcome.
  const heldRun = status === "HELD" ? attempts.find((a) => a.issueDate === review.issue.issueDate && a.outcome.includes("held")) : undefined;
  const voice = await voiceChecks(review.livePicks.map((p) => ({ id: p.id, text: p.commentary })));
  const [l4, alerts] = await Promise.all([lastFourChecks(review.issue.issueDate, review.livePicks), jobAlerts(issueId, status)]);
  const flagged = review.livePicks.filter((p) => p.flags.some((f) => f.startsWith("ungrounded"))).length;
  const out = review.picks.filter((p) => p.state === "SWAPPED_OUT");
  const attention = [
    ...alerts,
    ...(flagged && open && status !== "CONFIRMED" ? [`${flagged} ${flagged === 1 ? "story has" : "stories have"} a ⚠ fact flag: a number or name not found in the source. Check before confirming.`] : []),
    ...review.summary.warnings,
  ];

  const idInputs = <input type="hidden" name="issueId" value={issueId} />;
  return (
    <>
      <section className="section desk-hero">
        <p className="eyebrow">Weekly edition · {formatIssueDateShort(review.issue.issueDate)}</p>
        <h1 className="section-heading">
          {greeting(new Date())}, Shreya.
          <br />
          {step.line}
        </h1>
        <p className="hero-summary">
          {review.livePicks.length} stories · {Object.keys(review.summary.topics).length} topics · picked from {d.figures.fetched.toLocaleString("en-IN")} articles
          this week
        </p>
        {msg ? (
          <p className="notice" role="status">
            {msg}
          </p>
        ) : null}

        <div className="hero-actions">
          {step.primary === "review" ? (
            <a className="button button-solid" href="#stories">
              Review the {pending} open {pending === 1 ? "story" : "stories"}
            </a>
          ) : step.primary === "confirm" && open ? (
            <form action={confirmAction}>
              {idInputs}
              <input type="hidden" name="hash8" value={review.summary.contentHash.slice(0, 8)} />
              <button className="button button-solid" type="submit">
                Confirm the final issue
              </button>
            </form>
          ) : (
            <a className="button button-solid" href="/preview" target="_blank" rel="noopener">
              Preview the email
            </a>
          )}
          {open && pending > 0 && status !== "CONFIRMED" ? (
            <form action={approveAllAction}>
              {idInputs}
              <button className="ghost hero-link" type="submit">
                Keep all {pending} as drafted
              </button>
            </form>
          ) : null}
          {open && status !== "HELD" ? (
            <form action={holdAction}>
              {idInputs}
              <button className="ghost hero-link" type="submit">
                Hold the issue
              </button>
            </form>
          ) : null}
        </div>

        <dl className="status-row">
          <div className={ed.alert ? "alert" : undefined}>
            <dt>Your review</dt>
            <dd>{ed.label}</dd>
          </div>
          <div>
            <dt>Scheduled delivery</dt>
            <dd>{status === "SENT" ? "Done" : `Thu 07:30–08:29 IST${status === "CONFIRMED" && sendRun ? "" : ", if confirmed"}`}</dd>
          </div>
          <div className={heldRun && status !== "SENT" ? "alert" : undefined}>
            <dt>Delivery outcome</dt>
            <dd>
              {status === "SENT" && delivered
                ? `Sent · ${delivered.sent} real, ${delivered.skipped.toLocaleString("en-IN")} demo-skipped${delivered.failed ? `, ${delivered.failed} failed` : ""}`
                : heldRun
                  ? `Held by the gate ${formatIstDateTime(heldRun.at).slice(11, 16)}`
                  : "Not sent yet"}
            </dd>
          </div>
        </dl>

        {attention.length ? (
          <ul className="checks attention" aria-label="Needs your attention">
            {attention.map((x) => (
              <li key={x} className="no">
                <span aria-hidden="true">!</span> {x}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="muted hero-note">
          Same issue as your Telegram cards; a change in either place updates both. Open for the demo; in demo mode the email reaches only the
          allowlisted inbox. <Link href="/status">Settings &amp; status</Link>
        </p>
      </section>

      <section className="section" id="stories">
        <div className="desk-head">
          <h2 className="section-heading">The stories</h2>
          <a className="red-link" href="/preview" target="_blank" rel="noopener">
            Preview the email →
          </a>
        </div>
        <ol className="desk-stories">
          {review.livePicks.map((p) => {
            const v = voice[p.id];
            const problems = [...(v?.errors.length ? [`Voice check: ${v.errors.join(", ")}`] : []), ...(l4[p.id] ? [`Matches a story in the ${l4[p.id]} issue`] : [])];
            return (
              <li key={p.id} id={`s-${p.id}`} className="desk-story">
                <span className="dropcap">{p.position}</span>
                <div className="desk-body">
                  <p className="story-topic">
                    {topicLabel(p.topic)} · {SIGNALS[p.signalType] ?? p.signalType}
                    {p.state === "PENDING" ? <span className="desk-state pending">needs a decision</span> : p.state === "EDITED" ? <span className="desk-state">edited</span> : null}
                  </p>
                  <h3 className="card-heading">
                    <a href={p.url} target="_blank" rel="noopener noreferrer">
                      {p.headline}
                    </a>
                  </h3>
                  <p className="desk-meta">
                    {p.publisher ?? ""}
                    {p.replacedPosition ? " · swapped in from the alternatives" : ""}
                  </p>
                  <p className="desk-commentary">{p.commentary}</p>
                  <p className="desk-why">Why: {p.rationale}</p>
                  {p.flags.map((f) => (
                    <p key={f} className="flag">
                      ⚠ {formatFlag(f)}
                    </p>
                  ))}
                  {problems.map((x) => (
                    <p key={x} className="flag">
                      ! {x}
                    </p>
                  ))}

                  {canEdit && open ? (
                    <div className="desk-actions">
                      {p.state === "PENDING" ? (
                        <form action={keepAction}>
                          {idInputs}
                          <input type="hidden" name="storyId" value={p.id} />
                          <button className="button" type="submit">
                            Keep
                          </button>
                        </form>
                      ) : null}
                      <details className="desk-change">
                        <summary>Change</summary>
                        <div className="desk-change-body">
                          <form action={editAction} className="stack">
                            {idInputs}
                            <input type="hidden" name="storyId" value={p.id} />
                            <label className="eyebrow" htmlFor={`t-${p.id}`}>
                              Edit the commentary (2–3 sentences, at most 65 words)
                            </label>
                            <textarea id={`t-${p.id}`} name="text" defaultValue={p.commentary} rows={4} required />
                            <label style={{ fontSize: 15 }}>
                              <input type="checkbox" name="override" /> Use anyway if the voice check fails
                            </label>
                            <button className="button" type="submit">
                              Save
                            </button>
                          </form>
                          {review.unusedBackups.length ? (
                            <form action={swapAction} className="desk-swap">
                              {idInputs}
                              <input type="hidden" name="storyId" value={p.id} />
                              <select name="backupId" aria-label={`Replace story ${p.position} with`}>
                                <option value="">Best alternative (keeps 3+ topics)</option>
                                {review.unusedBackups.map((b) => (
                                  <option key={b.id} value={b.id}>
                                    {topicLabel(b.topic)}: {b.headline.length > 70 ? `${b.headline.slice(0, 68)}…` : b.headline}
                                  </option>
                                ))}
                              </select>
                              <button className="button" type="submit">
                                Replace
                              </button>
                            </form>
                          ) : null}
                          <form action={removeAction}>
                            {idInputs}
                            <input type="hidden" name="storyId" value={p.id} />
                            <button className="ghost hero-link" type="submit">
                              Remove this story
                            </button>
                          </form>
                        </div>
                      </details>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
        {open && status !== "CONFIRMED" && pending === 0 ? (
          <form action={confirmAction} className="desk-confirm">
            {idInputs}
            <input type="hidden" name="hash8" value={review.summary.contentHash.slice(0, 8)} />
            <button className="button button-solid" type="submit">
              Confirm the final issue
            </button>
          </form>
        ) : null}
      </section>

      {review.unusedBackups.length ? (
        <section className="section">
          <p className="eyebrow">Ranked by Gemini, already written in your voice</p>
          <h2 className="card-heading">Alternatives ({review.unusedBackups.length})</h2>
          <ol className="desk-alts">
            {review.unusedBackups.map((b) => (
              <li key={b.id}>
                <p className="story-topic">
                  {topicLabel(b.topic)} · {SIGNALS[b.signalType] ?? b.signalType}
                </p>
                <p>
                  <a href={b.url} target="_blank" rel="noopener noreferrer">
                    <b>{b.headline}</b>
                  </a>
                </p>
                <p style={{ fontSize: 16 }}>{b.commentary}</p>
                <p className="eyebrow" style={{ marginTop: 4 }}>
                  Why: {b.rationale}
                </p>
              </li>
            ))}
          </ol>
          <p className="muted" style={{ fontSize: 15, marginTop: 8 }}>
            To use one, pick it in a story&rsquo;s Swap menu or tap 🔄 Swap on Telegram.
          </p>
        </section>
      ) : null}

      {out.length ? (
        <section className="section">
          <details>
            <summary className="card-heading" style={{ cursor: "pointer" }}>
              Swapped and removed ({out.length})
            </summary>
            <ul className="past-list" style={{ marginTop: 16 }}>
              {out.map((p) => (
                <li key={p.id}>
                  <span className="ui-label">{p.removed ? "Removed" : "Swapped out"}</span> {p.headline}
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}

      <section className="section">
        <details>
          <summary className="card-heading" style={{ cursor: "pointer" }}>
            Email preview
          </summary>
          <iframe src="/preview" title="Email preview" className="preview-frame" />
        </details>
      </section>
    </>
  );
}
