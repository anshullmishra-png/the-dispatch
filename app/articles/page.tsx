import type { Metadata } from "next";
import Link from "next/link";
import { lastFourList } from "@/lib/site/proof";
import { articleLibrary, LIBRARY_FILTERS, type LibraryFilter } from "@/lib/site/queries";
import { HeadlineCheck } from "./headline-check";
import { formatIssueDateShort, formatIstDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Articles · The Dispatch" };

type Props = { searchParams: Promise<{ status?: string; q?: string }> };

const LABELS: Record<LibraryFilter, string> = {
  all: "All",
  candidate: "Candidates",
  picked: "Picked",
  duplicate: "Duplicates",
  seen_before: "In last 4 issues",
  rejected: "Swapped or removed",
};

const STATUS_TEXT: Record<string, string> = {
  new: "○ new",
  candidate: "○ candidate",
  selected: "● picked",
  backup: "◐ backup",
  duplicate: "duplicate",
  seen_before: "seen before",
  rejected: "removed",
};

const countFor = (counts: Record<string, number>, f: LibraryFilter) => {
  const keys = LIBRARY_FILTERS[f];
  return keys ? keys.reduce((n, k) => n + (counts[k] ?? 0), 0) : Object.values(counts).reduce((a, b) => a + b, 0);
};

/** Every article collected for this week's issue, with how the pipeline judged it. */
export default async function Articles({ searchParams }: Props) {
  const sp = await searchParams;
  const filter = (sp.status && sp.status in LIBRARY_FILTERS ? sp.status : "all") as LibraryFilter;
  const q = sp.q ?? "";
  const [data, lastFour] = await Promise.all([articleLibrary(filter, q), lastFourList()]);
  if (!data) {
    return (
      <section className="section">
        <h1 className="page-title">Articles</h1>
        <p>Nothing collected for this week yet.</p>
      </section>
    );
  }
  const href = (f: LibraryFilter) => `/articles?status=${f}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  return (
    <section className="section">
      <p className="eyebrow">Collected for the {formatIssueDateShort(data.issue.issueDate)} issue</p>
      <h1 className="page-title">Articles</h1>
      <p style={{ marginTop: 8 }}>
        Everything ingest found from {formatIstDateTime(data.issue.windowStart).slice(0, 10)} to {formatIstDateTime(data.issue.windowEnd).slice(0, 10)},
        and what the pipeline decided: a <b>duplicate</b> of another outlet&rsquo;s story this week, <b>seen before</b> in one of the last
        four issues, a <b>candidate</b> sent to Gemini, or <b>picked</b>.
      </p>

      <div className="grid-2" style={{ marginTop: 32, alignItems: "start" }}>
        <HeadlineCheck examples={lastFour.flatMap((i) => i.headlines.slice(0, 1)).slice(0, 3)} />
        <div className="stack">
          <p className="eyebrow">The exclusion set</p>
          <h2 className="card-heading">Stories from the last four issues</h2>
          <p style={{ fontSize: 16 }}>
            Every new article and every Gemini pick is checked against these {lastFour.reduce((n, i) => n + i.headlines.length, 0)} stories. A match
            becomes <b>seen before</b> and is never sent to Gemini; a pick that still matches is rejected and re-prompted. The count is 0 this week
            because none of this week&rsquo;s stories repeat them. Paste one into the checker to see the rule fire.
          </p>
          <ul className="past-list">
            {lastFour.map((i) => (
              <li key={i.issueDate}>
                <span className="ui-label">{formatIssueDateShort(i.issueDate)}</span> {i.headlines.length} stories: {i.headlines.slice(0, 3).join(" · ")}
                {i.headlines.length > 3 ? " …" : ""}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <nav className="filters" aria-label="Filter by status">
        {(Object.keys(LIBRARY_FILTERS) as LibraryFilter[]).map((f) => (
          <Link key={f} href={href(f)} className={`filter${f === filter ? " active" : ""}`} aria-current={f === filter ? "page" : undefined}>
            {LABELS[f]} <span>{countFor(data.counts, f)}</span>
          </Link>
        ))}
      </nav>
      <form method="get" action="/articles" className="form-row" style={{ marginTop: 16 }}>
        <input type="hidden" name="status" value={filter} />
        <div className="field">
          <label htmlFor="q">Search headlines</label>
          <input id="q" name="q" defaultValue={q} placeholder="e.g. funding, UPI, Zepto" />
        </div>
        <button type="submit" className="button">
          Search
        </button>
      </form>

      <div className="table-wrap" style={{ marginTop: 32 }}>
        <table className="ruled">
          <thead>
            <tr>
              <th scope="col">Headline</th>
              <th scope="col">Source</th>
              <th scope="col">Published (IST)</th>
              <th scope="col">Status</th>
              <th scope="col">Why</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((a) => (
              <tr key={a.id}>
                <td>
                  <a href={a.url} rel="noopener noreferrer" target="_blank">
                    {a.title}
                  </a>
                </td>
                <td>{a.publisher || a.source_name || "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>{a.published_at ? formatIstDateTime(new Date(a.published_at)).replace(" IST", "") : "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>{STATUS_TEXT[a.status] ?? a.status}</td>
                <td className="why">
                  {a.status === "duplicate" && a.dup_title
                    ? `Same story as “${a.dup_title}”${a.similarity !== null ? ` (similarity ${Number(a.similarity).toFixed(2)})` : ""}`
                    : a.status === "seen_before"
                      ? `Covered in the ${a.seen_issue ? formatIssueDateShort(a.seen_issue) : "earlier"} issue`
                      : a.status === "rejected"
                        ? "Swapped or removed during review"
                        : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.rows.length === 0 ? <p style={{ marginTop: 16 }}>No articles match.</p> : null}
        {data.rows.length === 300 ? <p className="muted" style={{ marginTop: 16, fontSize: 16 }}>Showing the newest 300. Narrow with a filter or search.</p> : null}
      </div>
    </section>
  );
}
