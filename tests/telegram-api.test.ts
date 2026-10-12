import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { answerCallbackQuery, editMessageText, sendMessage, TelegramError, tgCall } from "@/lib/telegram/api";

const TOKEN = "123456:TEST_token-value";
const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });
const fail = (code: number, description: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ ok: false, error_code: code, description, ...extra }), { status: code });

beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
  resetEnvCache();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("tgCall", () => {
  it("posts JSON to the bot method and returns the result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ message_id: 7 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(tgCall("sendMessage", { chat_id: 1, text: "hi" })).resolves.toEqual({ message_id: 7 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(JSON.parse(String(init.body))).toEqual({ chat_id: 1, text: "hi" });
  });

  it("never puts the token in an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError(`fetch failed for https://api.telegram.org/bot${TOKEN}/x`)));
    const err = (await tgCall("getMe", {}).catch((e) => e)) as TelegramError;
    expect(err).toBeInstanceOf(TelegramError);
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).not.toContain("TEST_token");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fail(401, "Unauthorized")));
    const err2 = (await tgCall("getMe", {}).catch((e) => e)) as TelegramError;
    expect(err2.code).toBe(401);
    expect(err2.message).not.toContain(TOKEN);
  });

  it("fails closed without a token", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    resetEnvCache();
    await expect(tgCall("getMe", {})).rejects.toThrow(/TELEGRAM_BOT_TOKEN/);
  });
});

describe("sendMessage", () => {
  it("uses HTML parse mode and retries once after a server error", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(fail(502, "Bad Gateway")).mockResolvedValueOnce(ok({ message_id: 42 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMessage(5, "<b>x</b>")).resolves.toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toMatchObject({ chat_id: 5, parse_mode: "HTML" });
  });

  it("does not retry a 400 (the request itself is wrong)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fail(400, "Bad Request: can't parse entities"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMessage(5, "x")).rejects.toBeInstanceOf(TelegramError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after one retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fail(429, "Too Many Requests", { parameters: { retry_after: 1 } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMessage(5, "x")).rejects.toBeInstanceOf(TelegramError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("spaces consecutive sends at least 350 ms apart", async () => {
    const times: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        times.push(Date.now());
        return ok({ message_id: 1 });
      }),
    );
    await sendMessage(5, "a");
    await sendMessage(5, "b");
    await sendMessage(5, "c");
    expect((times[1] as number) - (times[0] as number)).toBeGreaterThanOrEqual(350);
    expect((times[2] as number) - (times[1] as number)).toBeGreaterThanOrEqual(350);
  });
});

describe("editMessageText and answerCallbackQuery", () => {
  it("treats 'message is not modified' as a no-op", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fail(400, "Bad Request: message is not modified")));
    await expect(editMessageText(5, 9, "same")).resolves.toBe(false);
  });

  it("ignores a callback query that is too old to answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fail(400, "Bad Request: query is too old and response timeout expired")));
    await expect(answerCallbackQuery("q1", "Kept")).resolves.toBeUndefined();
  });
});
