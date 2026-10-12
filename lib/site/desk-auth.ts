// Editor's desk session. The passcode is ADMIN_TOKEN, typed once; the cookie
// holds an HMAC derived from it (never the token itself). Without it the desk
// is read-only, so nobody else can edit or confirm the issue.
import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/security";

export const DESK_COOKIE = "dispatch_desk";
export const DESK_SESSION_HOURS = 12;

export function deskSessionValue(adminToken: string): string {
  return createHmac("sha256", adminToken).update("desk-session-v1").digest("base64url");
}

export function passcodeMatches(passcode: string): boolean {
  const token = env().ADMIN_TOKEN;
  return Boolean(token && passcode && safeEqual(passcode.trim(), token));
}

export async function isDeskEditor(): Promise<boolean> {
  const token = env().ADMIN_TOKEN;
  if (!token) return false; // fails closed
  const value = (await cookies()).get(DESK_COOKIE)?.value;
  return Boolean(value && safeEqual(value, deskSessionValue(token)));
}
