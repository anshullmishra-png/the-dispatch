// Unsubscribe tokens (docs/05-INTEGRATIONS.md §5):
// base64url(`subscriberId.HMAC_SHA256(subscriberId, UNSUB_SIGNING_KEY)`).
import { createHmac } from "node:crypto";
import { requireEnv } from "@/lib/env";
import { safeEqual } from "@/lib/security";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sign = (subscriberId: string, key: string) => createHmac("sha256", key).update(subscriberId).digest("base64url");

export function makeUnsubToken(subscriberId: string, key = requireEnv("UNSUB_SIGNING_KEY").UNSUB_SIGNING_KEY): string {
  return Buffer.from(`${subscriberId}.${sign(subscriberId, key)}`).toString("base64url");
}

/** The subscriber id, or null for a forged, truncated or malformed token. */
export function verifyUnsubToken(token: string, key = requireEnv("UNSUB_SIGNING_KEY").UNSUB_SIGNING_KEY): string | null {
  if (!token || token.length > 300) return null;
  const decoded = Buffer.from(token, "base64url").toString("utf8");
  const dot = decoded.indexOf(".");
  if (dot < 0) return null;
  const id = decoded.slice(0, dot);
  const mac = decoded.slice(dot + 1);
  if (!UUID.test(id) || !mac) return null;
  return safeEqual(mac, sign(id, key)) ? id.toLowerCase() : null;
}

export function unsubscribeUrls(appUrl: string, token: string) {
  return {
    /** Confirmation page (a GET never unsubscribes: mail scanners prefetch links). */
    page: new URL(`/unsubscribe?t=${encodeURIComponent(token)}`, appUrl).toString(),
    /** RFC 8058 one-click POST target for the List-Unsubscribe header. */
    oneClick: new URL(`/api/unsubscribe?t=${encodeURIComponent(token)}`, appUrl).toString(),
  };
}
