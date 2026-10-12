// List hygiene (R15/R16): the webhook and the demo simulator share these.
import { and, eq, inArray, sql } from "drizzle-orm";
import { subscribers } from "@/db/schema";
import { db } from "@/lib/db";

const SENDABLE = ["active", "pending"] as const;

/** Permanent bounces stop future sends; transient ones are only recorded. */
export function isPermanentBounce(type: string | undefined): boolean {
  return /^(permanent|hard)/i.test(type ?? "");
}

export async function markBounced(email: string, bounceType: string): Promise<string | null> {
  const [row] = await db()
    .update(subscribers)
    .set({ status: "bounced", bouncedAt: sql`now()`, bounceType, lastEvent: "email.bounced" })
    .where(and(eq(subscribers.email, email.toLowerCase()), inArray(subscribers.status, [...SENDABLE])))
    .returning({ id: subscribers.id });
  return row?.id ?? null;
}

export async function markComplained(email: string): Promise<string | null> {
  const [row] = await db()
    .update(subscribers)
    .set({ status: "complained", lastEvent: "email.complained" })
    .where(and(eq(subscribers.email, email.toLowerCase()), inArray(subscribers.status, [...SENDABLE])))
    .returning({ id: subscribers.id });
  return row?.id ?? null;
}

/** Idempotent: a second call (or an already-bounced address) changes nothing. */
export async function unsubscribe(where: { id: string } | { email: string }): Promise<boolean> {
  const match = "id" in where ? eq(subscribers.id, where.id) : eq(subscribers.email, where.email.toLowerCase());
  const rows = await db()
    .update(subscribers)
    .set({ status: "unsubscribed", unsubscribedAt: sql`now()`, lastEvent: "unsubscribe" })
    .where(and(match, inArray(subscribers.status, [...SENDABLE])))
    .returning({ id: subscribers.id });
  return rows.length > 0;
}

export async function subscriberIdByEmail(email: string): Promise<string | null> {
  const [row] = await db().select({ id: subscribers.id }).from(subscribers).where(eq(subscribers.email, email.toLowerCase()));
  return row?.id ?? null;
}
