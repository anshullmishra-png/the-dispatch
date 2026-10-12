// Issue email (docs/06-DESIGN.md §8): table layout, inline CSS, Georgia,
// 600 px rulebox, no images. Pure; also used for the web preview.
import { topicLabel } from "@/lib/telegram/cards";
import { formatIssueDateShort } from "@/lib/time";

export interface EmailStory {
  position: number;
  topic: string;
  headline: string;
  url: string;
  publisher: string | null;
  commentary: string;
}

export interface IssueEmail {
  issueDate: string;
  subject: string;
  stories: readonly EmailStory[];
}

export interface RenderLinks {
  appUrl: string;
  /** Personal unsubscribe page; omitted for the web preview. */
  unsubscribeUrl?: string;
}

const PAPER = "#F9F8F2";
const INK = "#333333";
const RED = "#DA4143";
const SERIF = "Georgia, 'Times New Roman', serif";

/** Escapes text and attribute values. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? esc(url) : "#");
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
};

function storyRow(s: EmailStory): string {
  const publisher = esc(s.publisher || hostOf(s.url));
  return `
<tr><td style="padding:28px 40px 0 40px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td width="32" height="32" valign="middle" align="center" style="width:32px;height:32px;background:${INK};color:#FFFFFF;font-family:${SERIF};font-size:16px;font-weight:bold;line-height:32px;">${s.position}</td>
    <td style="padding-left:14px;font-family:${SERIF};font-size:14px;font-style:italic;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${RED};">${esc(topicLabel(s.topic))}</td>
  </tr></table>
  <h2 style="margin:12px 0 8px 0;font-family:${SERIF};font-size:22px;line-height:1.3;font-weight:bold;color:${INK};">
    <a href="${safeHref(s.url)}" style="color:${INK};text-decoration:none;">${esc(s.headline)}</a>
  </h2>
  <p style="margin:0 0 10px 0;font-family:${SERIF};font-size:16px;line-height:1.5;color:${INK};">${esc(s.commentary)}</p>
  <p style="margin:0;font-family:${SERIF};font-size:15px;line-height:1.5;"><a href="${safeHref(s.url)}" style="color:${RED};text-decoration:underline;">Read at ${publisher} &rarr;</a></p>
</td></tr>`;
}

export function renderIssueHtml(issue: IssueEmail, links: RenderLinks): string {
  const date = esc(formatIssueDateShort(issue.issueDate));
  const preheader = esc(issue.stories[0]?.headline ?? "This week's picks");
  const unsub = links.unsubscribeUrl
    ? `<a href="${esc(links.unsubscribeUrl)}" style="color:${INK};text-decoration:underline;">Unsubscribe</a>`
    : "Unsubscribe";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(issue.subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${PAPER};border:1px solid ${RED};">
<tr><td align="right" style="padding:12px 20px 0 20px;font-family:${SERIF};font-size:12px;color:${INK};">${unsub}</td></tr>
<tr><td align="center" style="padding:8px 40px 0 40px;">
  <div style="font-family:${SERIF};font-size:44px;line-height:1.1;font-weight:bold;letter-spacing:2px;color:${INK};">THE DISPATCH</div>
  <div style="font-family:${SERIF};font-size:16px;color:${RED};padding:6px 0;">&#9670;</div>
  <div style="font-family:${SERIF};font-size:16px;font-style:italic;color:${INK};">${date} &middot; India startups, read closely</div>
</td></tr>
<tr><td style="padding:18px 40px 0 40px;"><div style="border-top:1px solid ${RED};font-size:0;line-height:0;">&nbsp;</div></td></tr>
${issue.stories.map(storyRow).join("")}
<tr><td style="padding:32px 40px 0 40px;"><div style="border-top:1px solid ${RED};font-size:0;line-height:0;">&nbsp;</div></td></tr>
<tr><td style="padding:16px 40px 28px 40px;font-family:${SERIF};font-size:13px;line-height:1.5;color:${INK};">
  You get this because you subscribed to The Dispatch. Picked by AI, reviewed and confirmed by Shreya before sending. ${unsub}.
</td></tr>
</table></td></tr></table>
</body></html>`;
}

export function renderIssueText(issue: IssueEmail, links: RenderLinks): string {
  const lines = [`THE DISPATCH`, `${formatIssueDateShort(issue.issueDate)} · India startups, read closely`, ""];
  for (const s of issue.stories) {
    lines.push(`${s.position}. [${topicLabel(s.topic).toUpperCase()}] ${s.headline}`, s.commentary, `Read at ${s.publisher || hostOf(s.url)}: ${s.url}`, "");
  }
  lines.push("---", "You get this because you subscribed to The Dispatch.");
  if (links.unsubscribeUrl) lines.push(`Unsubscribe: ${links.unsubscribeUrl}`);
  return lines.join("\n");
}
