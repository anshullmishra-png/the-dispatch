"use client";

import { useState } from "react";

type Result = {
  ok: boolean;
  error?: string;
  normalized?: string;
  entities?: string[];
  week?: { title: string; publisher: string | null; similarity: number; shared: number; duplicate: boolean } | null;
  lastFour?: { issueDate: string; headline: string; similarity: number; shared: number } | null;
  lastFourSize?: number;
};

const pct = (n: number) => n.toFixed(2);

/** Lets anyone run the real dedupe rule on a headline: this week's batch and the last four issues. */
export function HeadlineCheck({ examples }: { examples: string[] }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);

  async function run(headline: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/dedupe-check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ headline }) });
      setRes((await r.json()) as Result);
    } catch {
      setRes({ ok: false, error: "Check failed. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <p className="eyebrow">Try the dedupe yourself</p>
      <h2 className="card-heading">Check a headline</h2>
      <p style={{ marginTop: 8, fontSize: 16 }}>
        Paste any headline. The same code ingest uses compares it with this week&rsquo;s articles and with every story in the last four issues. Nothing
        is stored.
      </p>
      <form
        className="form-row"
        style={{ marginTop: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          void run(value);
        }}
      >
        <div className="field">
          <label htmlFor="headline">Headline</label>
          <input id="headline" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. a headline from the archive" />
        </div>
        <button type="submit" className="button" disabled={busy || value.trim().length < 8}>
          {busy ? "Checking…" : "Check"}
        </button>
      </form>
      {examples.length ? (
        <p style={{ marginTop: 12, fontSize: 15 }}>
          Try one from a past issue:{" "}
          {examples.map((ex, i) => (
            <span key={ex}>
              {i ? " · " : ""}
              <button
                type="button"
                className="ghost"
                style={{ textDecoration: "underline", fontSize: 15 }}
                onClick={() => {
                  setValue(ex);
                  void run(ex);
                }}
              >
                {ex.length > 60 ? `${ex.slice(0, 58)}…` : ex}
              </button>
            </span>
          ))}
        </p>
      ) : null}
      <div role="status" aria-live="polite" style={{ marginTop: 16 }}>
        {res && !res.ok ? <p>{res.error}</p> : null}
        {res?.ok ? (
          <div className="stack" style={{ fontSize: 16 }}>
            <p>
              <span className="ui-label">Last four issues: </span>
              {res.lastFour
                ? `! Already covered in the ${res.lastFour.issueDate} issue as “${res.lastFour.headline}” (similarity ${pct(res.lastFour.similarity)}, ${res.lastFour.shared} shared names). Ingest marks this seen_before and Gemini never sees it.`
                : `○ Not covered in any of the last four issues (${res.lastFourSize} stories checked).`}
            </p>
            <p>
              <span className="ui-label">This week: </span>
              {res.week?.duplicate
                ? `! Same story as “${res.week.title}”${res.week.publisher ? ` (${res.week.publisher})` : ""}, similarity ${pct(res.week.similarity)}, ${res.week.shared} shared names. Ingest marks it duplicate.`
                : res.week
                  ? `○ Not a duplicate. Closest: “${res.week.title}” (similarity ${pct(res.week.similarity)}, ${res.week.shared} shared names: below the rule).`
                  : "○ Nothing similar collected this week."}
            </p>
            <p className="muted" style={{ fontSize: 14 }}>
              Normalised: “{res.normalized}” · names and numbers: {res.entities?.length ? res.entities.join(", ") : "none"}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
