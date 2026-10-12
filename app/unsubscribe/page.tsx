import type { Metadata } from "next";
import { verifyUnsubToken } from "@/lib/mail/tokens";

export const metadata: Metadata = { title: "Unsubscribe · The Dispatch", robots: { index: false } };

type Props = { searchParams: Promise<{ t?: string; status?: string }> };

/** docs/05 §5: a GET only shows the button; the POST unsubscribes. */
export default async function UnsubscribePage({ searchParams }: Props) {
  const { t = "", status } = await searchParams;
  let body: React.ReactNode;
  if (status === "done") {
    body = (
      <>
        <h1>You&rsquo;re unsubscribed</h1>
        <p>You won&rsquo;t get The Dispatch any more. Sorry to see you go, and thanks for reading.</p>
      </>
    );
  } else if (status === "invalid" || !verifyUnsubToken(t)) {
    body = (
      <>
        <h1>This link doesn&rsquo;t work</h1>
        <p>It may be incomplete. Use the unsubscribe link at the bottom of any issue, or reply to the email and we&rsquo;ll remove you.</p>
      </>
    );
  } else {
    body = (
      <>
        <h1>Unsubscribe from The Dispatch?</h1>
        <p>You&rsquo;ll stop getting the Thursday email. You can subscribe again any time.</p>
        <form method="post" action="/api/unsubscribe">
          <input type="hidden" name="t" value={t} />
          <input type="hidden" name="from" value="page" />
          <button type="submit" className="button">
            Unsubscribe
          </button>
        </form>
      </>
    );
  }
  return (
    <main className="page narrow">
      <section className="rulebox">{body}</section>
    </main>
  );
}
