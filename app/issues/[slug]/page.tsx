import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sentIssueBySlug } from "@/lib/site/queries";
import { topicLabel } from "@/lib/telegram/cards";
import { formatIssueDateShort } from "@/lib/time";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Issue ${slug} · The Dispatch` };
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
};

/** Web view of a sent issue (drafts are never public). */
export default async function IssuePage({ params }: Props) {
  const { slug } = await params;
  const issue = await sentIssueBySlug(slug);
  if (!issue) notFound();
  return (
    <section className="section">
      <div className="measure">
        <header style={{ textAlign: "center", paddingBottom: 32, borderBottom: "var(--rule)" }}>
          <h1 className="page-title">The Dispatch</h1>
          <p className="red-link" style={{ fontStyle: "normal" }} aria-hidden="true">
            ◆
          </p>
          <p className="eyebrow" style={{ fontSize: 20 }}>
            {formatIssueDateShort(issue.issueDate)} · India startups, read closely
          </p>
        </header>
        <div>
          {issue.stories.map((s) => (
            <article className="story" key={s.position}>
              <span className="dropcap" aria-label={`Story ${s.position}`}>
                {s.position}
              </span>
              <div>
                <p className="story-topic">{topicLabel(s.topic)}</p>
                <h2>
                  <a href={s.url} rel="noopener noreferrer" target="_blank">
                    {s.headline}
                  </a>
                </h2>
                <p>{s.commentary}</p>
                <p style={{ marginTop: 8 }}>
                  <a className="red-link" href={s.url} rel="noopener noreferrer" target="_blank">
                    Read at {s.publisher || hostOf(s.url)} →
                  </a>
                </p>
              </div>
            </article>
          ))}
        </div>
        <p style={{ marginTop: 32 }}>
          <Link href="/issues">← All issues</Link>
        </p>
      </div>
    </section>
  );
}
