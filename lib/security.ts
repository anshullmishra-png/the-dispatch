import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time string comparison (hashing first equalises lengths). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

/** Fails closed: with no secret configured, nothing is authorised. */
export function isAuthorizedBearer(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const token = bearerToken(req);
  return token !== null && safeEqual(token, secret);
}

export function isAdminRequest(req: Request, adminToken: string | undefined): boolean {
  if (!adminToken) return false;
  const token = req.headers.get("x-admin-token");
  return token !== null && safeEqual(token, adminToken);
}

/** Vercel Cron identifies itself with this user agent. */
export function isVercelCron(req: Request): boolean {
  return (req.headers.get("user-agent") ?? "").toLowerCase().startsWith("vercel-cron");
}
