import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredFeatures, EnvError, parseEnv, requireEnv, resetEnvCache } from "@/lib/env";
import { maskEmail } from "@/lib/log";

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("parseEnv", () => {
  it("accepts an empty environment with safe defaults", () => {
    const e = parseEnv({});
    expect(e.DEMO_MODE).toBe(true);
    expect(e.GEMINI_MOCK).toBe(false);
    expect(e.SEND_ALLOWLIST).toEqual([]);
    expect(e.DATABASE_URL).toBeUndefined();
  });

  it("treats blank values as unset", () => {
    const e = parseEnv({ GEMINI_MODEL: "   ", DEMO_MODE: "" });
    expect(e.GEMINI_MODEL).toBeUndefined();
    expect(e.DEMO_MODE).toBe(true);
  });

  it("only turns DEMO_MODE off for the literal string false", () => {
    expect(parseEnv({ DEMO_MODE: "false" }).DEMO_MODE).toBe(false);
    expect(() => parseEnv({ DEMO_MODE: "no" })).toThrow(EnvError);
  });

  it("parses and lowercases the send allowlist", () => {
    const e = parseEnv({ SEND_ALLOWLIST: " Me@Example.com, delivered@resend.dev ,," });
    expect(e.SEND_ALLOWLIST).toEqual(["me@example.com", "delivered@resend.dev"]);
  });

  it("accepts a Postgres connection string as a URL", () => {
    const url = "postgresql://user:pw@ep-x-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
    expect(parseEnv({ DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });

  it("reports offending key names without echoing values", () => {
    try {
      parseEnv({ SEND_ALLOWLIST: "not-an-email", UNSUB_SIGNING_KEY: "short-secret-value" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvError);
      const e = err as EnvError;
      expect(e.keys).toEqual(expect.arrayContaining(["SEND_ALLOWLIST", "UNSUB_SIGNING_KEY"]));
      expect(e.message).not.toContain("short-secret-value");
      expect(e.message).not.toContain("not-an-email");
    }
  });

  it("rejects Telegram ids that are not numeric", () => {
    expect(() => parseEnv({ SHREYA_TG_USER_ID: "@shreya" })).toThrow(EnvError);
    expect(parseEnv({ SHREYA_TG_USER_ID: "123456789" }).SHREYA_TG_USER_ID).toBe("123456789");
  });
});

describe("requireEnv", () => {
  it("names every missing key", () => {
    vi.stubEnv("GEMINI_MODEL", "gemini-3.8-flash");
    expect(() => requireEnv("GEMINI_MODEL", "GEMINI_API_KEY", "DATABASE_URL")).toThrow(
      "Missing environment variables: GEMINI_API_KEY, DATABASE_URL",
    );
  });

  it("returns the requested values when present", () => {
    vi.stubEnv("GEMINI_MODEL", "gemini-3.8-flash");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    expect(requireEnv("GEMINI_MODEL", "GEMINI_API_KEY")).toEqual({
      GEMINI_MODEL: "gemini-3.8-flash",
      GEMINI_API_KEY: "test-key",
    });
  });
});

describe("configuredFeatures", () => {
  it("reports booleans only", () => {
    const features = configuredFeatures(parseEnv({ NEWS_API_KEY: "abc" }));
    expect(features.gnews).toBe(true);
    expect(features.database).toBe(false);
    expect(Object.values(features).every((v) => typeof v === "boolean")).toBe(true);
  });
});

describe("maskEmail", () => {
  it("keeps two characters and the domain", () => {
    expect(maskEmail("anshull@gmail.com")).toBe("an…@gmail.com");
    expect(maskEmail("a@x.io")).toBe("a…@x.io");
    expect(maskEmail("garbage")).toBe("…");
  });
});
