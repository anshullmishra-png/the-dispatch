// Creates (once) the Resend webhook pointing at APP_URL/api/webhooks/resend and
// writes its signing secret to .env.local as RESEND_WEBHOOK_SECRET. Plain fetch:
// only lib/mail/send.ts imports the Resend SDK. Prints no secret.
import "./_env";
import { appendFileSync, readFileSync } from "node:fs";
import { requireEnv } from "@/lib/env";

const EVENTS = ["email.delivered", "email.bounced", "email.complained", "email.delivery_delayed", "email.failed", "email.suppressed"];

async function main() {
  const { RESEND_API_KEY, APP_URL } = requireEnv("RESEND_API_KEY", "APP_URL");
  const endpoint = new URL("/api/webhooks/resend", APP_URL).toString();
  const api = (path: string, init: RequestInit = {}) =>
    fetch(`https://api.resend.com${path}`, {
      ...init,
      headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> }));

  const list = await api("/webhooks");
  const existing = ((list.body.data as { id: string; endpoint: string }[] | undefined) ?? []).find((w) => w.endpoint === endpoint);
  if (existing && /^RESEND_WEBHOOK_SECRET=/m.test(readFileSync(".env.local", "utf8"))) {
    console.log(`webhook already exists (${existing.id}) and the secret is in .env.local`);
    return;
  }
  if (existing) await api(`/webhooks/${existing.id}`, { method: "DELETE" });
  const created = await api("/webhooks", { method: "POST", body: JSON.stringify({ endpoint, events: EVENTS }) });
  const secret = created.body.signing_secret;
  if (created.status >= 300 || typeof secret !== "string") throw new Error(`create failed: HTTP ${created.status} ${JSON.stringify(created.body.message ?? "")}`);
  appendFileSync(".env.local", `\nRESEND_WEBHOOK_SECRET=${secret}\n`);
  console.log(`created webhook ${String(created.body.id)} -> ${endpoint}; secret written to .env.local`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
