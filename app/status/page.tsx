import type { Metadata } from "next";
import Link from "next/link";
import { auditTrail, hygiene, sendAttempts, sendGate, settingsData, weekTimeline } from "@/lib/site/proof";
import { dashboardData, operationsData } from "@/lib/site/queries";
import { upcomingJobs } from "@/lib/site/schedule";
import { topicLabel } from "@/lib/telegram/cards";
import { formatIssueDateShort, formatIstDateTime } from "@/lib/time";
import { Refresher } from "./refresher";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings & status · The Dispatch" };

// Status without a second hue (docs/06 §2): glyph + text, red outline for trouble.
const SCHEDULE_TEXT: Record<string, string> = {
  ingest: "Mon–Wed 08:30–09:29",
  curate: "Wed 14:30–15:29",
  notify: "Wed 17:30–18:29",
  remind: "Wed 22:30–23:29 (first window always after 10 PM)",
  send: "Thu 07:30–08:29",
};

const MARKERS: Record<string, { glyph: string; alert?: boolean }> = {
  COLLECTING: { glyph: "○" },
  DRAFTING: { glyph: "○" },
  IN_REVIEW: { glyph: "○" },
  CONFIRMED: { glyph: "●" },
  SENDING: { glyph: "◐" },
  SENT: { glyph: "●" },
  HELD: { glyph: "!", alert: true },
};

function runSummary(job: string, stats: unknown, error: string | null): string {
  if (error) return error.slice(0, 80);
  const s = (stats ?? {}) as Record<string, unknown>;
  const get = (o: unknown, k: string) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined);
  switch (job) {
    case "ingest":
      return `${get(s, "inserted") ?? get(get(s, "totals"), "inserted") ?? "?"} new articles`;
    case "curate":
      return `${get(get(s, "selection"), "picks") ?? "?"} picks · ${get(s, "model") ?? ""}`;
    case "notify":
      return `${get(s, "messages") ?? "?"} Telegram messages`;
    case "remind":
      return `${get(s, "pending") ?? 0} pending`;
    case "send": {
      const c = get(get(s, "report"), "counts") as Record<string, number> | undefined;
      return c ? `${c.sent ?? 0} sent · ${c.skipped_demo ?? 0} skipped (demo)` : String(get(s, "kind") ?? "");
    }
    default:
      return "";
  }
}

function Bars({ data, label }: { data: Record<string, number>; label: (k: string) => string }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <ul className="bars">
      {entries.map(([k, n], i) => (
        <li className="bar-row" key={k}>
          <span>{label(k)}</span>
          <span className="bar-track" aria-hidden="true">
            <span className={`bar-fill${i === 0 ? " highlight" : ""}`} style={{ display: "block", width: `${(n / max) * 100}%` }} />
          </span>
          <span className="bar-value">{n.toLocaleString("en-IN")}</span>
        </li>
      ))}
    </ul>
  );
}


export default async function Dashboard() {
  const now = new Date();
  const [d, ops] = await Promise.all([dashboardData(), operationsData()]);
  const next = upcomingJobs(now)[0];
  const [gate, audit, timeline, attempts, hyg] = await Promise.all([
    d.issue ? sendGate(d.issue.id) : null,
    d.issue ? auditTrail(d.issue.id) : [],
    d.issue ? weekTimeline(d.issue, now) : [],
    sendAttempts(),
    hygiene(),
  ]);
  const settings = await settingsData();
  const jobs = upcomingJobs(now);
  const eligible = d.figures.eligible;
  const status = d.issue?.status ?? "COLLECTING";
  const marker = MARKERS[status] ?? { glyph: "○" };
  const voicePct = d.voice.total ? Math.round((d.voice.unedited / d.voice.total) * 100) : null;
  const duration = (a: Date, b: Date | null) => (b ? `${Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000))} s` : "running");

  return (
    <>
      <Refresher />
      <section className="section">
        <p className="eyebrow">Behind the desk</p>
        <h1 className="page-title">Settings &amp; status</h1>
        <p style={{ marginTop: 8 }}>
          What the pipeline does for the <Link href="/desk">Desk</Link>. Shreya only needs this page when the Desk flags a problem; it is also the
          evidence that each step of the brief runs.
        </p>
        <div className="grid-3" style={{ marginTop: 32 }}>
          <div className="card">
            <p className="eyebrow">Editorial voice</p>
            <h2 className="card-heading">Style guide v{settings.styleGuideVersion ?? "—"}</h2>
            <p style={{ fontSize: 16, marginTop: 8 }}>
              Sent with every Gemini call; every commentary is linted against it. <Link href="/style-guide">Read it →</Link>
            </p>
          </div>
          <div className="card">
            <p className="eyebrow">News sources</p>
            <h2 className="card-heading">
              {settings.rss} RSS feeds · {settings.gnews} news queries
            </h2>
            <p style={{ fontSize: 16, marginTop: 8 }}>
              {ops.failingFeeds ? `! ${ops.failingFeeds} failing at the last run` : "All answering at the last run"}
              {ops.pausedFeeds ? ` · ${ops.pausedFeeds} paused` : ""}. Full list at the bottom of this page.
            </p>
          </div>
          <div className="card">
            <p className="eyebrow">Telegram</p>
            <h2 className="card-heading">{settings.telegram ? "@thedispatchdesk_bot connected" : "! Not configured"}</h2>
            <p style={{ fontSize: 16, marginTop: 8 }}>
              Answers only Shreya&rsquo;s account.{settings.lastTelegramAt ? ` Last message ${formatIstDateTime(settings.lastTelegramAt)}.` : ""}
            </p>
          </div>
        </div>
        <div className="table-wrap" style={{ marginTop: 32 }}>
          <table className="ruled">
            <thead>
              <tr>
                <th scope="col">Scheduled job</th>
                <th scope="col">When (IST)</th>
                <th scope="col">Next run</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.job}>
                  <td>{j.job}</td>
                  <td>{SCHEDULE_TEXT[j.job] ?? j.schedule}</td>
                  <td>{formatIstDateTime(j.next).replace(" IST", "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="issue-head">
          <div className="stamp" aria-hidden="true">
            {status.replace("_", " ")}
          </div>
          <div>
            <p className="eyebrow">This week&rsquo;s issue</p>
            <h2 className="page-title">{d.issue ? formatIssueDateShort(d.issue.issueDate) : "No issue yet"}</h2>
            <p className={`status-marker${marker.alert ? " alert" : ""}`}>
              {marker.glyph} {status.replace("_", " ")}
              {d.issue?.needsAttention ? " · needs attention" : ""}
            </p>
          </div>
        </div>
        <dl className="strip">
          <div>
            <dt>Last ingest</dt>
            <dd>{ops.lastIngestAt ? formatIstDateTime(ops.lastIngestAt) : "never"}</dd>
          </div>
          <div>
            <dt>Next scheduled job</dt>
            <dd>{next ? `${next.job} · ${formatIstDateTime(next.next)}` : "—"}</dd>
          </div>
          <div>
            <dt>Feeds failing / paused</dt>
            <dd>
              {ops.failingFeeds} / {ops.pausedFeeds}
            </dd>
          </div>
          <div>
            <dt>Eligible for Gemini</dt>
            <dd>{eligible.toLocaleString("en-IN")} stories</dd>
          </div>
        </dl>
        <div className="figures" style={{ marginTop: 48 }}>
          {[
            [d.figures.fetched, "articles fetched this week"],
            [d.figures.candidates, "new candidates"],
            [d.figures.duplicates, "duplicates caught"],
            [d.figures.picked, "stories picked"],
          ].map(([value, label]) => (
            <div key={label as string}>
              <p className="figure-value">{Number(value).toLocaleString("en-IN")}</p>
              <p className="figure-label">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {timeline.length ? (
        <section className="section">
          <div className="grid-2" style={{ alignItems: "start" }}>
            <div className="stack">
              <p className="eyebrow">The brief&rsquo;s week, for this issue</p>
              <h2 className="card-heading">Timeline</h2>
              <ol className="timeline">
                {timeline.map((s) => (
                  <li key={s.label} className={`t-${s.state}`}>
                    <span className="t-mark" aria-hidden="true">
                      {s.state === "done" ? "●" : s.state === "failed" ? "!" : s.state === "skipped" ? "–" : "○"}
                    </span>
                    <div>
                      <p>
                        <b>{s.label}</b> <span className="muted">· {s.when}</span>
                      </p>
                      <p className="ui-label">
                        {s.state}
                        {s.at ? ` · ${formatIstDateTime(s.at)}` : ""}
                        {s.note ? ` · ${s.note}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            {gate ? (
              <div className="card">
                <p className="eyebrow">Never sends without Shreya</p>
                <h2 className="card-heading">Send gate, live</h2>
                <p style={{ fontSize: 16, marginTop: 8 }}>
                  The send job runs these checks first; one ✗ and it sends nothing, holds the issue and alerts her on Telegram.
                </p>
                <ul className="checks">
                  {gate.checks.map((c) => (
                    <li key={c.label} className={c.ok ? "ok" : "no"}>
                      <span aria-hidden="true">{c.ok ? "✓" : "✗"}</span> {c.label}
                    </li>
                  ))}
                </ul>
                <p className={`status-marker${gate.allowed ? "" : " alert"}`} style={{ marginTop: 16, display: "inline-block" }}>
                  {gate.allowed ? "● Would send at the next Thursday run" : gate.status === "SENT" ? "● Already sent" : "! Would hold and alert Shreya"}
                </p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="section">
        <p>
          This week&rsquo;s picks, Gemini&rsquo;s reasons, fact flags and review decisions are on the <Link href="/desk">Desk</Link>; every article
          and the dedupe decisions are in <Link href="/articles">Articles</Link>.
        </p>
      </section>

      <section className="section">
        <div className="grid-2">
          <div className="stack">
            <h2 className="card-heading">Topic spread of this week&rsquo;s picks</h2>
            {Object.keys(d.topicCounts).length ? <Bars data={d.topicCounts} label={topicLabel} /> : <p>No picks yet.</p>}
          </div>
          <div className="stack">
            <h2 className="card-heading">Subscribers by status</h2>
            <Bars data={d.subscribers} label={(k) => k[0]?.toUpperCase() + k.slice(1)} />
          </div>
        </div>
        <div className="card" style={{ marginTop: 48 }}>
          <p className="eyebrow">Voice match</p>
          <p className="figure-value">{voicePct === null ? "—" : `${voicePct}%`}</p>
          <p className="figure-label">
            of AI commentary accepted by Shreya without edits
            {d.voice.total ? ` (${d.voice.unedited} of ${d.voice.total} confirmed stories)` : ""}
          </p>
        </div>
      </section>

      <section className="section">
        <p className="eyebrow">Every review action, as saved from Telegram</p>
        <h2 className="card-heading">Audit trail for this issue</h2>
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table className="ruled">
            <thead>
              <tr>
                <th scope="col">When (IST)</th>
                <th scope="col">Who</th>
                <th scope="col">Action</th>
                <th scope="col">Story</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: "nowrap" }}>{formatIstDateTime(a.at).replace(" IST", "")}</td>
                  <td>{a.who}</td>
                  <td>
                    {a.what}
                    {a.extra ? <span className="muted"> · {a.extra}</span> : null}
                  </td>
                  <td>{a.story ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {audit.length === 0 ? <p style={{ marginTop: 16 }}>No review actions yet.</p> : null}
        </div>
        <p className="muted" style={{ marginTop: 16, fontSize: 16 }}>
          Includes the automated end-to-end test runs (<code>npm run e2e:telegram</code>), which press the same buttons through the same signed
          webhook as Shreya&rsquo;s Telegram account. A tap from any other account is ignored and never appears here.
        </p>
      </section>

      <section className="section">
        <div className="grid-2" style={{ alignItems: "start" }}>
          <div className="card">
            <p className="eyebrow">Delivery mode</p>
            <h2 className="card-heading">{hyg.delivery.demoMode ? "Demo mode is on, by design" : "Live delivery"}</h2>
            {hyg.delivery.demoMode ? (
              <p style={{ fontSize: 16, marginTop: 8 }}>
                Shreya&rsquo;s real list isn&rsquo;t available, so the 2,200 subscribers are {hyg.counts.synthetic.toLocaleString("en-IN")} synthetic
                addresses, {hyg.counts.real} real {hyg.counts.real === 1 ? "inbox" : "inboxes"} ({hyg.delivery.allowlisted} on the allowlist) and{" "}
                {hyg.counts.resendTest} Resend test inboxes. Every send still claims and logs all 2,200 rows in batches of 100; only the allowlist and the
                Resend test inboxes get real mail, the rest are logged <i>skipped_demo</i>. The free sender ({hyg.delivery.sender}) can only reach the
                account owner, so sending to synthetic addresses would just fail. Switching to a real list is one setting (<code>DEMO_MODE=false</code>)
                plus a verified domain.
              </p>
            ) : (
              <p style={{ fontSize: 16, marginTop: 8 }}>Every active subscriber gets the email.</p>
            )}
          </div>
          <div className="card">
            <p className="eyebrow">Unsubscribes and bounces</p>
            <h2 className="card-heading">List hygiene</h2>
            <p style={{ fontSize: 16, marginTop: 8 }}>
              {hyg.counts.excluded} addresses are excluded from every send (unsubscribed, bounced or complained); the send job only claims{" "}
              <i>active</i> subscribers ({hyg.counts.active.toLocaleString("en-IN")}). Unsubscribe is one click from the email (RFC 8058 header +
              confirmation page). Bounces and complaints arrive as Svix-signed Resend webhooks.
            </p>
            <ul className="checks" style={{ marginTop: 12 }}>
              {hyg.events.map((ev, i) => (
                <li key={i}>
                  <span aria-hidden="true">{ev.type === "email.bounced" || ev.type === "email.complained" ? "!" : "●"}</span> {ev.type} ·{" "}
                  {formatIstDateTime(ev.at).replace(" IST", "")} · {ev.source}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="section">
        <p className="eyebrow">Every run of the send job, including the ones the gate stopped</p>
        <h2 className="card-heading">Send attempts</h2>
        <p style={{ fontSize: 16, marginTop: 8 }}>
          <b>Rehearsal</b> = run by hand to test the pipeline today; <b>Scheduled</b> = the Thursday Vercel Cron run. Either way, in demo mode only the
          allowlisted inbox and Resend&rsquo;s test inboxes get real mail.{" "}
          {attempts.some((a) => a.trigger === "cron" && a.issueDate === d.issue?.issueDate)
            ? "The scheduled Thursday run for this issue is in the table."
            : `The scheduled Thursday run for ${d.issue ? formatIssueDateShort(d.issue.issueDate) : "this issue"} has not happened yet.`}
        </p>
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table className="ruled">
            <thead>
              <tr>
                <th scope="col">When (IST)</th>
                <th scope="col">Issue</th>
                <th scope="col">Run</th>
                <th scope="col">Outcome</th>
                <th scope="col">Real emails</th>
                <th scope="col">Skipped (demo)</th>
                <th scope="col">Failed</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: "nowrap" }}>{formatIstDateTime(a.at).replace(" IST", "")}</td>
                  <td>{a.issueDate ? formatIssueDateShort(a.issueDate) : "—"}</td>
                  <td>{a.trigger === "cron" ? "Scheduled" : "Rehearsal"}</td>
                  <td>
                    {a.outcome}
                    {a.reason ? <span className="muted"> · {a.reason}</span> : null}
                  </td>
                  <td>{a.sent}</td>
                  <td>{a.skipped.toLocaleString("en-IN")}</td>
                  <td>{a.failed ? `! ${a.failed}` : 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {attempts.length === 0 ? <p style={{ marginTop: 16 }}>No send runs yet.</p> : null}
        </div>
      </section>


      <section className="section">
        <h2 className="card-heading">Last 15 pipeline runs</h2>
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table className="ruled">
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col">Started (IST)</th>
                <th scope="col">Duration</th>
                <th scope="col">Result</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {d.runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.job}</td>
                  <td>{formatIstDateTime(r.startedAt).replace(" IST", "")}</td>
                  <td>{duration(r.startedAt, r.finishedAt)}</td>
                  <td>{r.ok === null ? "◐ running" : r.ok ? "● ok" : "! failed"}</td>
                  <td>{runSummary(r.job, r.stats, r.error)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2 className="card-heading">Sources</h2>
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table className="ruled">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Kind</th>
                <th scope="col">Last OK (IST)</th>
                <th scope="col">Failures</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {d.sources.map((s) => (
                <tr key={`${s.kind}:${s.name}`}>
                  <td>{s.name}</td>
                  <td>{s.kind === "rss" ? "RSS" : "GNews"}</td>
                  <td>{s.lastOkAt ? formatIstDateTime(s.lastOkAt).replace(" IST", "") : "—"}</td>
                  <td>{s.failures}</td>
                  <td>{s.active ? "● active" : "! paused"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ marginTop: 16, fontSize: 16 }}>
          Public and read-only: counts only, no subscriber addresses. Refreshes every 30 seconds.
        </p>
      </section>
    </>
  );
}
