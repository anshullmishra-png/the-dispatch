import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/telegram/webhook/route";
import { resetEnvCache } from "@/lib/env";
import { ReviewError } from "@/lib/approval/review";
import { classifySender, reviewErrorText } from "@/lib/telegram/handlers";

const SECRET = "test_webhook_secret-123";
const SHREYA = "111222333";

const update = (fromId: number, extra: Record<string, unknown> = {}) => ({
  update_id: 1,
  message: { message_id: 10, chat: { id: fromId, type: "private" }, from: { id: fromId }, text: "hello" },
  ...extra,
});
const call = (body: unknown, secret?: string) =>
  POST(
    new Request("https://x.test/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:TEST_token");
  vi.stubEnv("SHREYA_TG_USER_ID", SHREYA);
  resetEnvCache();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("webhook secret", () => {
  it("rejects a missing or wrong secret header", async () => {
    expect((await call(update(1))).status).toBe(401);
    expect((await call(update(1), "wrong")).status).toBe(401);
  });

  it("fails closed when no secret is configured", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    resetEnvCache();
    expect((await call(update(1), SECRET)).status).toBe(401);
  });

  it("acknowledges a malformed body without acting", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await call({ nope: true }, SECRET)).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("allowlist", () => {
  it("classifies senders", () => {
    expect(classifySender(111222333, SHREYA)).toBe("editor");
    expect(classifySender(999, SHREYA)).toBe("stranger");
    expect(classifySender(999, undefined)).toBe("unconfigured");
  });

  it("ignores and logs a message from a second account: no reply is sent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await call(update(999), SECRET)).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String((console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0])).toContain("non-allowlisted");
  });

  it("only answers (silently) a button tap from a second account", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: true })));
    vi.stubGlobal("fetch", fetchMock);
    const tap = { update_id: 2, callback_query: { id: "q1", from: { id: 999 }, data: "k:3f2a9c1e", message: { message_id: 5, chat: { id: 999 } } } };
    expect((await call(tap, SECRET)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/answerCallbackQuery$/);
    expect(JSON.parse(String(init.body))).toEqual({ callback_query_id: "q1" });
  });

  it("before setup, /start replies with the sender's ids", async () => {
    vi.stubEnv("SHREYA_TG_USER_ID", "");
    resetEnvCache();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const start = update(4242);
    start.message.text = "/start";
    expect((await call(start, SECRET)).status).toBe(200);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.chat_id).toBe(4242);
    expect(body.text).toContain("<code>4242</code>");
  });
});

describe("reviewErrorText", () => {
  it("has a message for every failure", () => {
    for (const reason of ["not_found", "ambiguous", "issue_locked", "not_a_live_pick", "no_backups", "empty_text"] as const) {
      expect(reviewErrorText(new ReviewError(reason)).length).toBeGreaterThan(5);
    }
  });
});
