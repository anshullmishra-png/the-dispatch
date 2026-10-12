import type { Metadata } from "next";
import { activeStyleGuide } from "@/lib/site/queries";
import { formatIstDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Style guide · The Dispatch" };

/** Minimal markdown: headings, bullets, paragraphs. The guide is our own content, rendered as text (no HTML). */
function render(md: string) {
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(<ul key={`ul${out.length}`}>{list.map((l, i) => <li key={i}>{l}</li>)}</ul>);
    list = [];
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      list.push((bullet[1] ?? "").replace(/\*\*/g, ""));
      continue;
    }
    flush();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) out.push(h[1] === "#" ? null : <h2 key={out.length} className="card-heading" style={{ marginTop: 32 }}>{h[2]}</h2>);
    else if (line.trim()) out.push(<p key={out.length}>{line.replace(/\*\*/g, "")}</p>);
  }
  flush();
  return out;
}

export default async function StyleGuide() {
  const guide = await activeStyleGuide();
  return (
    <section className="section">
      <div className="measure prose">
        <p className="eyebrow">The voice Gemini writes in</p>
        <h1 className="page-title">Style guide</h1>
        {guide ? (
          <>
            <p className="muted" style={{ fontSize: 16 }}>
              Version {guide.version}, stored in Neon since {formatIstDateTime(guide.createdAt)}. Sent in full with every curate call; voice lint
              checks every commentary against its &ldquo;Never say&rdquo; list. AI-generated for this project with the owner&rsquo;s permission;
              Shreya&rsquo;s real edits become examples over time.
            </p>
            {render(guide.content)}
          </>
        ) : (
          <p>No active style guide.</p>
        )}
      </div>
    </section>
  );
}
