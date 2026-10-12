import { describe, expect, it } from "vitest";
import { buildSubscriberRows, RESEND_TEST_ADDRESSES, TOTAL_SUBSCRIBERS } from "@/db/seed/subscribers";

const now = new Date("2026-10-12T09:00:00Z");

describe("buildSubscriberRows", () => {
  const rows = buildSubscriberRows(["me@example.com"], now);

  it("produces exactly 2,200 unique addresses", () => {
    expect(rows).toHaveLength(TOTAL_SUBSCRIBERS);
    expect(new Set(rows.map((r) => r.email)).size).toBe(TOTAL_SUBSCRIBERS);
  });

  it("marks only the allowlisted inbox as a real, non-test subscriber", () => {
    const real = rows.filter((r) => !r.isTest);
    expect(real.map((r) => r.email)).toEqual(["me@example.com"]);
  });

  it("includes the Resend test addresses and one unsubscribed + one bounced example", () => {
    const emails = rows.map((r) => r.email);
    for (const t of RESEND_TEST_ADDRESSES) expect(emails).toContain(t);
    expect(rows.filter((r) => r.status === "unsubscribed")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "bounced")).toHaveLength(1);
  });

  it("keeps synthetic addresses on the reserved .invalid TLD", () => {
    const synthetic = rows.filter((r) => r.email.startsWith("user"));
    expect(synthetic.length).toBe(TOTAL_SUBSCRIBERS - 1 - RESEND_TEST_ADDRESSES.length - 2);
    expect(synthetic.every((r) => r.email.endsWith("@example.invalid") && r.isTest)).toBe(true);
  });

  it("still totals 2,200 with a longer allowlist", () => {
    expect(buildSubscriberRows(["a@x.io", "b@x.io"], now)).toHaveLength(TOTAL_SUBSCRIBERS);
  });
});
