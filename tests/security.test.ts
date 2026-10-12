import { describe, expect, it } from "vitest";
import { bearerToken, isAdminRequest, isAuthorizedBearer, isVercelCron, safeEqual } from "@/lib/security";

const req = (headers: Record<string, string>) => new Request("https://x.test/api/cron/ingest", { headers });

describe("safeEqual", () => {
  it("compares strings of any length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcdef")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("bearer auth", () => {
  const secret = "s3cret-cron-value-123";

  it("parses the bearer token", () => {
    expect(bearerToken(req({ authorization: `Bearer ${secret}` }))).toBe(secret);
    expect(bearerToken(req({ authorization: `bearer   ${secret}` }))).toBe(secret);
    expect(bearerToken(req({ authorization: secret }))).toBeNull();
    expect(bearerToken(req({}))).toBeNull();
  });

  it("accepts only the exact secret", () => {
    expect(isAuthorizedBearer(req({ authorization: `Bearer ${secret}` }), secret)).toBe(true);
    expect(isAuthorizedBearer(req({ authorization: `Bearer ${secret}x` }), secret)).toBe(false);
    expect(isAuthorizedBearer(req({}), secret)).toBe(false);
  });

  it("fails closed when no secret is configured", () => {
    expect(isAuthorizedBearer(req({ authorization: "Bearer anything" }), undefined)).toBe(false);
    expect(isAuthorizedBearer(req({ authorization: "Bearer " }), "")).toBe(false);
  });
});

describe("admin and cron detection", () => {
  it("checks the admin header and fails closed", () => {
    expect(isAdminRequest(req({ "x-admin-token": "admin-token-123456" }), "admin-token-123456")).toBe(true);
    expect(isAdminRequest(req({ "x-admin-token": "wrong" }), "admin-token-123456")).toBe(false);
    expect(isAdminRequest(req({ "x-admin-token": "x" }), undefined)).toBe(false);
  });

  it("recognises Vercel Cron's user agent", () => {
    expect(isVercelCron(req({ "user-agent": "vercel-cron/1.0" }))).toBe(true);
    expect(isVercelCron(req({ "user-agent": "curl/8.0" }))).toBe(false);
  });
});
