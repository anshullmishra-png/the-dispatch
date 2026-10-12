import { describe, expect, it } from "vitest";
import { type IssueEmail, renderIssueHtml, renderIssueText } from "@/lib/mail/render";
import { shouldReallySend } from "@/lib/mail/send";
import { signSvix, verifySvix } from "@/lib/mail/svix";
import { makeUnsubToken, unsubscribeUrls, verifyUnsubToken } from "@/lib/mail/tokens";
import { isPermanentBounce } from "@/lib/subscribers/hygiene";

const KEY = "k".repeat(40);
const SUB = "0f8b6c1e-2d3a-4b5c-8d9e-0a1b2c3d4e5f";

describe("unsubscribe tokens", () => {
  it("round-trips and rejects tampering", () => {
    const t = makeUnsubToken(SUB, KEY);
    expect(verifyUnsubToken(t, KEY)).toBe(SUB);
    expect(verifyUnsubToken(t, "x".repeat(40))).toBeNull();
    expect(verifyUnsubToken(`${t.slice(0, -2)}AA`, KEY)).toBeNull();
    const other = Buffer.from(`${"1".repeat(8)}-2d3a-4b5c-8d9e-0a1b2c3d4e5f.${Buffer.from(t, "base64url").toString().split(".")[1]}`).toString("base64url");
    expect(verifyUnsubToken(other, KEY)).toBeNull();
    for (const bad of ["", "abc", "x".repeat(400)]) expect(verifyUnsubToken(bad, KEY)).toBeNull();
  });

  it("builds the page and one-click URLs", () => {
    const u = unsubscribeUrls("https://d.example", "tok");
    expect(u.page).toBe("https://d.example/unsubscribe?t=tok");
    expect(u.oneClick).toBe("https://d.example/api/unsubscribe?t=tok");
  });
});

describe("svix verification", () => {
  const secret = `whsec_${Buffer.from("supersecretkey-0123456789").toString("base64")}`;
  const body = '{"type":"email.bounced"}';
  const now = 1_760_000_000_000;
  const ts = String(now / 1000);
  const headers = (sig: string, t = ts) => new Headers({ "svix-id": "msg_1", "svix-timestamp": t, "svix-signature": sig });

  it("accepts a correct v1 signature (also among several)", () => {
    const sig = signSvix(secret, "msg_1", ts, body);
    expect(verifySvix(body, headers(`v1,${sig}`), secret, now)).toBe(true);
    expect(verifySvix(body, headers(`v1,bogus v1,${sig}`), secret, now)).toBe(true);
  });

  it("rejects a changed body, wrong secret, old timestamp, missing headers or no secret", () => {
    const sig = signSvix(secret, "msg_1", ts, body);
    expect(verifySvix(`${body} `, headers(`v1,${sig}`), secret, now)).toBe(false);
    expect(verifySvix(body, headers(`v1,${sig}`), `whsec_${Buffer.from("other").toString("base64")}`, now)).toBe(false);
    expect(verifySvix(body, headers(`v1,${sig}`), secret, now + 10 * 60_000)).toBe(false);
    expect(verifySvix(body, new Headers(), secret, now)).toBe(false);
    expect(verifySvix(body, headers(`v1,${sig}`), undefined, now)).toBe(false);
  });
});

describe("demo mode recipients", () => {
  const allow = ["anshullmishra@gmail.com"];
  it("only the allowlist and Resend test inboxes get real mail in demo mode", () => {
    expect(shouldReallySend("anshullmishra@gmail.com", true, allow)).toBe(true);
    expect(shouldReallySend("Anshullmishra@Gmail.com", true, allow)).toBe(true);
    expect(shouldReallySend("delivered@resend.dev", true, allow)).toBe(true);
    expect(shouldReallySend("bounced+x@resend.dev", true, allow)).toBe(true);
    expect(shouldReallySend("user0042@example.invalid", true, allow)).toBe(false);
    expect(shouldReallySend("evil@resend.dev.attacker.com", true, allow)).toBe(false);
  });
  it("outside demo mode everyone active gets mail", () => {
    expect(shouldReallySend("user0042@example.invalid", false, allow)).toBe(true);
  });
});

describe("bounce types", () => {
  it("treats only permanent bounces as permanent", () => {
    expect(isPermanentBounce("Permanent")).toBe(true);
    expect(isPermanentBounce("hard")).toBe(true);
    expect(isPermanentBounce("Transient")).toBe(false);
    expect(isPermanentBounce(undefined)).toBe(false);
  });
});

describe("issue email", () => {
  const issue: IssueEmail = {
    issueDate: "2026-10-15",
    subject: "The Dispatch · Thu 15 Oct · Test",
    stories: [
      { position: 1, topic: "fintech", headline: `UPI <script>"x"</script>`, url: "https://mint.example/a?b=1&c=2", publisher: "Mint", commentary: "Merchants pay. Banks don't." },
      { position: 2, topic: "ai_saas", headline: "Second", url: "javascript:alert(1)", publisher: null, commentary: "Two. Sentences." },
    ],
  };
  const links = { appUrl: "https://d.example", unsubscribeUrl: "https://d.example/unsubscribe?t=abc" };
  const html = renderIssueHtml(issue, links);

  it("escapes content and refuses non-http links", () => {
    expect(html).not.toContain("<script>");
    expect(html).toContain("UPI &lt;script&gt;&quot;x&quot;&lt;/script&gt;");
    expect(html).toContain('href="https://mint.example/a?b=1&amp;c=2"');
    expect(html).not.toContain("javascript:");
  });

  it("follows the design rules: 600 px rulebox, Georgia, masthead, numbered stories, unsubscribe in header and footer", () => {
    expect(html).toContain("max-width:600px");
    expect(html).toContain("border:1px solid #DA4143");
    expect(html).toContain("Georgia");
    expect(html).toContain("THE DISPATCH");
    expect(html).toContain("Thu 15 Oct");
    expect(html).toContain("Read at Mint &rarr;");
    expect(html.match(/unsubscribe\?t=abc/g)?.length).toBe(2);
    expect(html).not.toMatch(/<img|border-radius|box-shadow|gradient/);
  });

  it("has a plain-text alternative with the same stories", () => {
    const text = renderIssueText(issue, links);
    expect(text).toContain("1. [FINTECH] UPI");
    expect(text).toContain("Merchants pay. Banks don't.");
    expect(text).toContain("Unsubscribe: https://d.example/unsubscribe?t=abc");
  });
});
