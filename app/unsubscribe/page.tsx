import type { Metadata } from "next";
import Link from "next/link";
import { verifyUnsubToken } from "@/lib/mail/tokens";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe · The Dispatch", robots: { index: false } };

type Props = { searchParams: Promise<{ t?: string; status?: string }> };

/** docs/05 §5: a GET only shows the button (mail scanners prefetch links); the POST unsubscribes. */
export default async function UnsubscribePage({ searchParams }: Props) {
  const { t = "", status } = await searchParams;
  let body: React.ReactNode;
  if (status === "done") {
    body = (
      <>
        <h1 className="section-heading unsub-done">You&rsquo;re off the list</h1>
        <p>You won&rsquo;t get The Dispatch any more. Thanks for reading.</p>
        <p>
          <Link href="/">Back to the front page</Link>
        </p>
      </>
    );
  } else if (status === "invalid" || !verifyUnsubToken(t)) {
    body = (
      <>
        <h1 className="section-heading">This link doesn&rsquo;t work</h1>
        <p>It may be incomplete. Use the unsubscribe link at the bottom of any issue, or reply to the email and we&rsquo;ll remove you.</p>
      </>
    );
  } else {
    body = (
      <>
        <p className="eyebrow">The Dispatch</p>
        <h1 className="section-heading">Unsubscribe from The Dispatch?</h1>
        <p>You&rsquo;ll stop getting the Thursday email. You can subscribe again any time.</p>
        <form method="post" action="/api/unsubscribe">
          <input type="hidden" name="t" value={t} />
          <input type="hidden" name="from" value="page" />
          <button type="submit" className="button">
            Unsubscribe me
          </button>
        </form>
        <p>
          <Link href="/" className="ghost">
            Never mind
          </Link>
        </p>
      </>
    );
  }
  return (
    <div className="narrow">
      <section className="card unsub-card">{body}</section>
    </div>
  );
}
