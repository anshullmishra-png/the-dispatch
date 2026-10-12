import type { Metadata } from "next";
import { dashboardData } from "@/lib/site/queries";
import { topicLabel } from "@/lib/telegram/cards";
import { formatIssueDateShort, formatIstDateTime } from "@/lib/time";
import { Refresher } from "./refresher";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard · The Dispatch" };

// Status without a second hue (docs/06 §2): glyph + text, red outline for trouble.
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
  const d = await dashboardData();
  const status = d.issue?.status ?? "COLLECTING";
  const marker = MARKERS[status] ?? { glyph: "○" };
  const voicePct = d.voice.total ? Math.round((d.voice.unedited / d.voice.total) * 100) : null;
  const duration = (a: Date, b: Date | null) => (b ? `${Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000))} s` : "running");

  return (
    <>
      <Refresher />
      <section className="section">
        <div className="issue-head">
          <div className="stamp" aria-hidden="true">
            {status.replace("_", " ")}
          </div>
          <div>
            <p className="eyebrow">This week&rsquo;s issue</p>
            <h1 className="page-title">{d.issue ? formatIssueDateShort(d.issue.issueDate) : "No issue yet"}</h1>
            <p className={`status-marker${marker.alert ? " alert" : ""}`}>
              {marker.glyph} {status.replace("_", " ")}
              {d.issue?.needsAttention ? " · needs attention" : ""}
            </p>
          </div>
        </div>
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
