import type { subscribers } from "@/db/schema";

type SubscriberRow = typeof subscribers.$inferInsert;

export const TOTAL_SUBSCRIBERS = 2200;

/** Resend's test inboxes accept mail without a verified domain (user-approved). */
export const RESEND_TEST_ADDRESSES = [
  "delivered@resend.dev",
  "bounced@resend.dev",
  "complained@resend.dev",
];

/**
 * 2,200 rows: the user's real allowlisted inbox(es), Resend test addresses,
 * one unsubscribed and one bounced example, and synthetic `.invalid` addresses
 * that demo mode never really emails.
 */
export function buildSubscriberRows(allowlist: string[], now: Date): SubscriberRow[] {
  const rows: SubscriberRow[] = [];
  for (const email of allowlist) {
    rows.push({ email, status: "active", source: "seed", isTest: false });
  }
  for (const email of RESEND_TEST_ADDRESSES) {
    rows.push({ email, status: "active", source: "seed", isTest: true });
  }
  rows.push({
    email: "unsubscribed.example@example.invalid",
    status: "unsubscribed",
    source: "seed",
    isTest: true,
    unsubscribedAt: now,
    lastEvent: "seed:unsubscribed",
  });
  rows.push({
    email: "bounced.example@example.invalid",
    status: "bounced",
    source: "seed",
    isTest: true,
    bouncedAt: now,
    bounceType: "Permanent",
    lastEvent: "seed:bounced",
  });
  for (let n = 1; rows.length < TOTAL_SUBSCRIBERS; n += 1) {
    rows.push({
      email: `user${String(n).padStart(4, "0")}@example.invalid`,
      status: "active",
      source: "seed",
      isTest: true,
    });
  }
  return rows;
}
