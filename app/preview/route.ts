import { eq } from "drizzle-orm";
import { issues } from "@/db/schema";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { loadIssueEmail } from "@/lib/mail/content";
import { renderIssueHtml } from "@/lib/mail/render";
import { targetIssueDate } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The exact HTML email the send job would build for this week's issue (public
 * draft, user decision). The personal unsubscribe link is left out of the preview.
 */
export async function GET() {
  const [issue] = await db().select({ id: issues.id }).from(issues).where(eq(issues.issueDate, targetIssueDate(new Date())));
  const email = issue ? await loadIssueEmail(issue.id) : null;
  if (!email || email.stories.length === 0) {
    return new Response("No draft for this week yet.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const html = renderIssueHtml(email, { appUrl: env().APP_URL ?? "https://the-dispatch-pi.vercel.app" });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" } });
}
