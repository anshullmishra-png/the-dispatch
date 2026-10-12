// Svix signature check for Resend webhooks (docs/05 §4), on the RAW body.
// signed = `${svix-id}.${svix-timestamp}.${body}`, HMAC-SHA256 with the
// base64 secret after "whsec_"; header holds space-separated `v1,<sig>`.
import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/security";

/** Replay window for svix-timestamp. */
export const TOLERANCE_S = 5 * 60;

export function signSvix(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}

export function verifySvix(body: string, headers: Headers, secret: string | undefined, nowMs = Date.now()): boolean {
  if (!secret) return false;
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > TOLERANCE_S) return false;
  const expected = signSvix(secret, id, timestamp, body);
  return signatures
    .split(" ")
    .map((s) => s.split(","))
    .some(([version, sig]) => version === "v1" && !!sig && safeEqual(sig, expected));
}
