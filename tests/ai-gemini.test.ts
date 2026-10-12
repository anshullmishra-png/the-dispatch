import { ApiError } from "@google/genai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type GeminiClient, GeminiError, generateJson, RETRY_DELAYS_MS } from "@/lib/ai/gemini";
import { resetEnvCache } from "@/lib/env";
import { createLogger } from "@/lib/log";

const log = createLogger({ test: "gemini" });
const ok = (text: string) => ({ text, modelVersion: "gemini-3.6-flash", usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } });

function fakeClient(...steps: (() => unknown)[]): GeminiClient & { calls: number } {
  const client = {
    calls: 0,
    models: {
      generateContent: async () => {
        const step = steps[Math.min(client.calls, steps.length - 1)] as () => unknown;
        client.calls += 1;
        return step() as ReturnType<GeminiClient["models"]["generateContent"]>;
      },
    },
  };
  return client;
}
const fail = (status: number) => () => {
  throw new ApiError({ message: `status ${status}`, status });
};

const call = (client: GeminiClient, extra: Partial<Parameters<typeof generateJson>[0]> = {}) =>
  generateJson({
    system: "sys",
    user: "user",
    jsonSchema: { type: "object" },
    parse: (raw) => raw as { ok: boolean },
    label: "test",
    log,
    client,
    sleep: async () => {},
    ...extra,
  });

beforeEach(() => {
  vi.stubEnv("GEMINI_MODEL", "gemini-3.6-flash");
  vi.stubEnv("GEMINI_MOCK", "false");
  resetEnvCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("generateJson", () => {
  it("returns parsed data with usage", async () => {
    const res = await call(fakeClient(() => ok('{"ok":true}')));
    expect(res).toMatchObject({ data: { ok: true }, attempts: 1, usage: { in: 100, out: 20 }, model: "gemini-3.6-flash" });
    expect(res.promptHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("retries on 429 then succeeds", async () => {
    const sleeps: number[] = [];
    const client = fakeClient(fail(429), () => ok('{"ok":true}'));
    const res = await call(client, { sleep: async (ms) => void sleeps.push(ms) });
    expect(res.attempts).toBe(2);
    expect(sleeps[0]).toBeGreaterThanOrEqual(RETRY_DELAYS_MS[0] as number);
    expect(sleeps[0]).toBeLessThan((RETRY_DELAYS_MS[0] as number) + 1000);
  });

  it("gives up after 3 retries on persistent 503", async () => {
    const client = fakeClient(fail(503));
    await expect(call(client)).rejects.toMatchObject({ name: "GeminiError", kind: "unavailable", attempts: 4 });
    expect(client.calls).toBe(4);
  });

  it("rotates to a fallback Flash model when the primary is overloaded", async () => {
    vi.stubEnv("GEMINI_FALLBACK_MODELS", "gemini-3-flash-preview");
    resetEnvCache();
    const models: string[] = [];
    const client: GeminiClient = {
      models: {
        generateContent: async (req) => {
          models.push(req.model);
          if (req.model === "gemini-3.6-flash") throw new ApiError({ message: "busy", status: 503 });
          return { ...ok('{"ok":true}'), modelVersion: req.model };
        },
      },
    };
    const res = await call(client);
    expect(models).toEqual(["gemini-3.6-flash", "gemini-3-flash-preview"]);
    expect(res).toMatchObject({ attempts: 2, model: "gemini-3-flash-preview" });
  });

  it("alternates models across all attempts", async () => {
    vi.stubEnv("GEMINI_FALLBACK_MODELS", "gemini-3-flash-preview, gemini-3.6-flash");
    resetEnvCache();
    const models: string[] = [];
    const client: GeminiClient = {
      models: {
        generateContent: async (req) => {
          models.push(req.model);
          throw new ApiError({ message: "busy", status: 503 });
        },
      },
    };
    await expect(call(client)).rejects.toMatchObject({ attempts: 4 });
    expect(models).toEqual(["gemini-3.6-flash", "gemini-3-flash-preview", "gemini-3.6-flash", "gemini-3-flash-preview"]);
  });

  it("does not retry a non-retryable error", async () => {
    const client = fakeClient(fail(400));
    await expect(call(client)).rejects.toBeInstanceOf(GeminiError);
    expect(client.calls).toBe(1);
  });

  it("stops retrying when the deadline is near", async () => {
    const client = fakeClient(fail(503));
    await expect(call(client, { deadline: Date.now() + 12_000 })).rejects.toMatchObject({ kind: "deadline" });
    expect(client.calls).toBe(1);
  });

  it("surfaces invalid JSON and shape mismatches without retrying", async () => {
    await expect(call(fakeClient(() => ok("not json")))).rejects.toMatchObject({ kind: "invalid_json" });
    const parse = () => {
      throw new Error("missing picks");
    };
    await expect(call(fakeClient(() => ok("{}")), { parse })).rejects.toMatchObject({ kind: "invalid_shape" });
  });

  it("returns the mock in GEMINI_MOCK mode without calling the API", async () => {
    vi.stubEnv("GEMINI_MOCK", "true");
    resetEnvCache();
    const client = fakeClient(fail(500));
    const res = await call(client, { mock: () => ({ ok: true }) });
    expect(res).toMatchObject({ data: { ok: true }, attempts: 0, model: "mock" });
    expect(client.calls).toBe(0);
  });

  it("never runs two calls at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const slow: GeminiClient = {
      models: {
        generateContent: async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 20));
          inFlight -= 1;
          return ok('{"ok":true}');
        },
      },
    };
    await Promise.all([call(slow), call(slow), call(slow)]);
    expect(maxInFlight).toBe(1);
  });
});
