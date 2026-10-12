import { eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { sendLog } from "@/db/schema";
import { loadReview, type ReviewState } from "@/lib/approval/review";
import { db } from "@/lib/db";
import { sendAttempts, voiceChecks } from "@/lib/site/proof";
import { dashboardData } from "@/lib/site/queries";
import { upcomingJobs } from "@/lib/site/schedule";
import { formatFlag, topicLabel } from "@/lib/telegram/cards";
import { formatIssueDateShort, formatIstDateTime } from "@/lib/time";
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
const STATE: Record<string, string> = { PENDING: "○ Needs a decision", KEPT: "● Kept", EDITED: "● Edited" };
const OPEN = new Set(["DRAFTING", "IN_REVIEW", "HELD", "CONFIRMED"]);

function editorial(r: ReviewState): { label: string; detail: string; alert: boolean } {
  const s = r.issue.status;
  const pending = r.summary.counts.PENDING;
  if (s === "COLLECTING") return { label: "No draft yet", detail: "Articles are still being collected. Gemini drafts on Wednesday afternoon.", alert: false };
  if (s === "DRAFTING") return { label: "Drafted, not yet on Telegram", detail: "Cards go to your Telegram on Wednesday evening.", alert: false };
  if (s === "IN_REVIEW")
    return { label: "Awaiting your review", detail: pending ? `${pending} ${pending === 1 ? "story needs" : "stories need"} a decision, then confirm.` : "Every story is reviewed. Confirm when ready.", alert: true };
  if (s === "HELD") return { label: "Held", detail: "Nothing will be sent until you confirm again.", alert: true };
  return { label: "Confirmed by you", detail: r.issue.confirmedAt ? formatIstDateTime(r.issue.confirmedAt) : "", alert: false };
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
  const ed = editorial(review);
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
  const flagged = review.livePicks.filter((p) => p.flags.some((f) => f.startsWith("ungrounded"))).length;
  const out = review.picks.filter((p) => p.state === "SWAPPED_OUT");
  const attention = [
    ...(status === "IN_REVIEW" && review.summary.counts.PENDING ? [`${review.summary.counts.PENDING} ${review.summary.counts.PENDING === 1 ? "story still needs" : "stories still need"} your decision.`] : []),
    ...(flagged && open && status !== "CONFIRMED" ? [`${flagged} ${flagged === 1 ? "story has" : "stories have"} a ⚠ fact flag: a number or name not found in the source. Check before confirming.`] : []),
    ...review.summary.warnings,
    ...(status === "HELD" ? ["The issue is held. Confirm it to send."] : []),
  ];

  return (
    <>
      <section className="section">
        <p className="eyebrow">Editor&rsquo;s desk · Shreya</p>
        <h1 className="page-title">{formatIssueDateShort(review.issue.issueDate)} issue</h1>
        {msg ? (
          <p className="notice" role="status">
            {msg}
          </p>
        ) : null}

        <div className="states">
          <div className={ed.alert ? "state alert" : "state"}>
            <p className="ui-label">1 · Your review</p>
            <p className="state-value">{ed.label}</p>
            <p className="state-detail">{ed.detail}</p>
          </div>
          <div className="state">
            <p className="ui-label">2 · Scheduled delivery</p>
            <p className="state-value">{status === "SENT" ? "Done" : "Thu 07:30–08:29 IST"}</p>
            <p className="state-detail">
              {status === "SENT"
                ? "The Thursday job ran."
                : status === "CONFIRMED"
                  ? `Goes out at the next send run (${sendRun ? formatIstDateTime(sendRun.next) : "Thursday"}).`
                  : "Only if you have confirmed by then; otherwise it is held and you get an alert."}
            </p>
          </div>
          <div className={heldRun && status !== "SENT" ? "state alert" : "state"}>
            <p className="ui-label">3 · Delivery outcome</p>
            <p className="state-value">{status === "SENT" ? "Sent" : heldRun ? "Held by the gate" : "Not sent yet"}</p>
            <p className="state-detail">
              {status === "SENT" && delivered
                ? `${delivered.sent} real ${delivered.sent === 1 ? "email" : "emails"}, ${delivered.skipped.toLocaleString("en-IN")} synthetic addresses skipped (demo mode), ${delivered.failed} failed.`
                : heldRun
                  ? `${formatIstDateTime(heldRun.at)}: not confirmed, nothing was sent.`
                  : "Confirmed is not sent: the email leaves only at the Thursday run."}
            </p>
          </div>
        </div>

        <div className="grid-2" style={{ marginTop: 32, alignItems: "start" }}>
          <div className="stack">
            <h2 className="card-heading">{attention.length ? "Needs your attention" : "Nothing needs you"}</h2>
            {attention.length ? (
              <ul className="checks">
                {attention.map((a) => (
                  <li key={a} className="no">
                    <span aria-hidden="true">!</span> {a}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{status === "SENT" ? "This issue has gone out." : "The issue is confirmed and will go out on Thursday morning."}</p>
            )}
            <p className="muted" style={{ fontSize: 16 }}>
              {d.figures.fetched.toLocaleString("en-IN")} articles read · {d.figures.duplicates} duplicates dropped · {review.livePicks.length} stories picked across{" "}
              {Object.keys(review.summary.topics).length} topics · <Link href="/status">System status</Link>
            </p>
          </div>

          <div className="card">
            {canEdit ? (
              open ? (
                <div className="stack">
                  <h2 className="card-heading">Decide</h2>
                  {review.summary.counts.PENDING > 0 && status !== "CONFIRMED" ? (
                    <form action={approveAllAction}>
                      <input type="hidden" name="issueId" value={issueId} />
                      <button className="button" type="submit">
                        Keep all remaining ({review.summary.counts.PENDING})
                      </button>
                    </form>
                  ) : null}
                  {status !== "CONFIRMED" ? (
                    <form action={confirmAction}>
                      <input type="hidden" name="issueId" value={issueId} />
                      <input type="hidden" name="hash8" value={review.summary.contentHash.slice(0, 8)} />
                      <button className="button button-solid" type="submit">
                        Confirm the final issue
                      </button>
                    </form>
                  ) : (
                    <p>
                      Confirmed. Any change to a story resets this and you confirm again.
                    </p>
                  )}
                  {status !== "HELD" ? (
                    <form action={holdAction}>
                      <input type="hidden" name="issueId" value={issueId} />
                      <button className="ghost" type="submit" style={{ textDecoration: "underline" }}>
                        Hold the issue (send nothing)
                      </button>
                    </form>
                  ) : null}
                  <p className="muted" style={{ fontSize: 15 }}>
                    Same issue as your Telegram cards: everything you do here updates them, and the send gate checks both. This desk is open for
                    the demo; in demo mode the email only reaches the allowlisted inbox.
                  </p>
                </div>
              ) : (
                <p>This issue has been sent; nothing can change.</p>
              )
            ) : null}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="desk-head">
          <h2 className="section-heading">The stories</h2>
          <a className="red-link" href="/preview" target="_blank" rel="noopener">
            Preview the email →
          </a>
        </div>
        <ol className="desk-stories">
          {review.livePicks.map((p) => {
            const v = voice[p.id];
            return (
              <li key={p.id} id={`s-${p.id}`} className="desk-story">
                <span className="dropcap">{p.position}</span>
                <div className="desk-body">
                  <p className="story-topic">
                    {topicLabel(p.topic)} · {SIGNALS[p.signalType] ?? p.signalType}
                    <span className={`desk-state${p.state === "PENDING" ? " pending" : ""}`}>{STATE[p.state] ?? p.state}</span>
                  </p>
                  <h3 className="card-heading">
                    <a href={p.url} target="_blank" rel="noopener noreferrer">
                      {p.headline}
                    </a>
                  </h3>
                  <p className="muted" style={{ fontSize: 15 }}>
                    {p.publisher ?? ""}
                    {p.replacedPosition ? " · swapped in from the alternatives" : ""}
                  </p>
                  <p style={{ marginTop: 8 }}>{p.commentary}</p>
                  <p className="eyebrow" style={{ marginTop: 8 }}>
                    Why Gemini picked it: {p.rationale}
                  </p>
                  {p.flags.map((f) => (
                    <p key={f} className="flag">
                      ⚠ {formatFlag(f)}
                    </p>
                  ))}
                  {v ? (
                    <p className="ui-label" style={{ marginTop: 8 }}>
                      {v.sentences} sentences · {v.words} words · voice check {v.errors.length ? `✗ ${v.errors.join(", ")}` : "✓"}
                    </p>
                  ) : null}

                  {canEdit && open ? (
                    <div className="desk-actions">
                      {p.state === "PENDING" ? (
                        <form action={keepAction}>
                          <input type="hidden" name="issueId" value={issueId} />
                          <input type="hidden" name="storyId" value={p.id} />
                          <button className="button" type="submit">
                            Keep
                          </button>
                        </form>
                      ) : null}
                      <details className="desk-edit">
                        <summary className="button">Edit</summary>
                        <form action={editAction} className="stack">
                          <input type="hidden" name="issueId" value={issueId} />
                          <input type="hidden" name="storyId" value={p.id} />
                          <label className="eyebrow" htmlFor={`t-${p.id}`}>
                            Your commentary (2–3 sentences, at most 65 words)
                          </label>
                          <textarea id={`t-${p.id}`} name="text" defaultValue={p.commentary} rows={5} required />
                          <label style={{ fontSize: 15 }}>
                            <input type="checkbox" name="override" /> Use anyway if the voice check fails
                          </label>
                          <button className="button" type="submit">
                            Save
                          </button>
                        </form>
                      </details>
                      {review.unusedBackups.length ? (
                        <form action={swapAction} className="desk-swap">
                          <input type="hidden" name="issueId" value={issueId} />
                          <input type="hidden" name="storyId" value={p.id} />
                          <select name="backupId" aria-label={`Swap story ${p.position} for`}>
                            <option value="">Best alternative (keeps 3+ topics)</option>
                            {review.unusedBackups.map((b) => (
                              <option key={b.id} value={b.id}>
                                {topicLabel(b.topic)}: {b.headline.length > 70 ? `${b.headline.slice(0, 68)}…` : b.headline}
                              </option>
                            ))}
                          </select>
                          <button className="button" type="submit">
                            Swap
                          </button>
                        </form>
                      ) : null}
                      <form action={removeAction}>
                        <input type="hidden" name="issueId" value={issueId} />
                        <input type="hidden" name="storyId" value={p.id} />
                        <button className="ghost" type="submit" style={{ textDecoration: "underline" }}>
                          Remove
                        </button>
                      </form>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
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
