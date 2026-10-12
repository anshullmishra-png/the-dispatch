import type { Metadata } from "next";
import Link from "next/link";
import { sentIssues } from "@/lib/site/queries";
import { topicLabel } from "@/lib/telegram/cards";
import { formatIssueDateShort } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Archive · The Dispatch" };

export default async function Archive() {
  const issues = await sentIssues();
  return (
    <section className="section">
      <div className="measure">
        <p className="eyebrow">Every issue so far</p>
        <h1 className="page-title">Archive</h1>
        <div style={{ marginTop: 32 }}>
          {issues.length === 0 ? <p>No issues yet. The first one goes out on Thursday.</p> : null}
          {issues.map((i) => (
            <Link key={i.id} href={`/issues/${i.slug}`} className="archive-row">
              <span className="ui-label">{formatIssueDateShort(i.issueDate)}</span>
              <span>
                <h2>{i.headlines[0] ?? i.subject}</h2>
                <p className="topic-tags">{i.topics.map(topicLabel).join(" · ")}</p>
              </span>
              <span className="ui-label">{i.stories} stories</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
