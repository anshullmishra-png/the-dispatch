import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { deskSessionValue, passcodeMatches } from "@/lib/site/desk-auth";

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("desk session", () => {
  it("the cookie value is derived from the token, never the token itself", () => {
    const token = "a".repeat(43);
    const v = deskSessionValue(token);
    expect(v).toBe(deskSessionValue(token));
    expect(v).not.toContain(token);
    expect(v).not.toBe(deskSessionValue("b".repeat(43)));
  });

  it("only the exact ADMIN_TOKEN signs in", () => {
    vi.stubEnv("ADMIN_TOKEN", "correct-horse-battery-staple-42");
    resetEnvCache();
    expect(passcodeMatches("correct-horse-battery-staple-42")).toBe(true);
    expect(passcodeMatches("  correct-horse-battery-staple-42  ")).toBe(true);
    expect(passcodeMatches("wrong")).toBe(false);
    expect(passcodeMatches("")).toBe(false);
  });

  it("fails closed when no ADMIN_TOKEN is configured", () => {
    vi.stubEnv("ADMIN_TOKEN", "");
    resetEnvCache();
    expect(passcodeMatches("")).toBe(false);
    expect(passcodeMatches("anything")).toBe(false);
  });
});
