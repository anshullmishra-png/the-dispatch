import Link from "next/link";
import { sentIssues } from "@/lib/site/queries";
import { formatIssueDateShort } from "@/lib/time";
import { SubscribeForm } from "./subscribe-form";

export const dynamic = "force-dynamic";

export default async function Home() {
  const latest = (await sentIssues())[0];
  return (
    <>
      <section className="masthead">
        <h1 className="marquee">
          THE
          <span className="marquee-diamond" aria-hidden="true">
            ◆
          </span>
          DISPATCH
        </h1>
        <p className="eyebrow">A weekly read on India&rsquo;s startup ecosystem</p>
      </section>

      <section className="section" id="subscribe">
        <div className="split">
          <div className="stack">
            <h2 className="section-heading">Eight to ten stories. Every Thursday.</h2>
            <p>
              Each week we read hundreds of headlines from Indian business and tech outlets, drop the duplicates and the stories you saw
              last month, and pick the few that matter. Each one comes with two or three sentences on why it matters.
            </p>
            <p>An AI does the reading. Shreya, our editor, keeps, rewrites or swaps every story before the issue goes out.</p>
            <SubscribeForm />
          </div>
          <div className="card-red">
            <p className="eyebrow" style={{ color: "var(--white)", fontSize: 18 }}>
              {latest ? `Latest issue · ${formatIssueDateShort(latest.issueDate)}` : "First issue coming Thursday"}
            </p>
            {latest ? (
              <>
                <ul className="latest-list">
                  {latest.headlines.slice(0, 6).map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
                <p style={{ marginTop: 24, fontSize: 18, fontWeight: 700 }}>
                  <Link href={`/issues/${latest.slug}`}>Read the full issue →</Link>
                </p>
              </>
            ) : null}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="grid-3">
          {[
            ["Collected", "Twenty RSS feeds and a news search run three times a week. Duplicates and repeats from the last four issues are dropped."],
            ["Curated", "Gemini picks eight to ten stories across at least three topics and drafts a short take on each, in Shreya's voice."],
            ["Confirmed", "Shreya reviews every story on her phone. Nothing is sent until she confirms the final draft."],
          ].map(([title, text], i) => (
            <div className="card" key={title}>
              <p className="step-number">{["I", "II", "III"][i]}.</p>
              <h3 className="card-heading">{title}</h3>
              <p style={{ marginTop: 8 }}>{text}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
