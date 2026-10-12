// The only module that calls Gemini (docs/04 §1). No tools, no send path.
import { createHash } from "node:crypto";
import { ApiError, GoogleGenAI } from "@google/genai";
import { env, requireEnv } from "@/lib/env";
import type { Logger } from "@/lib/log";

export const CALL_TIMEOUT_MS = 50_000;
export const RETRY_DELAYS_MS = [2_000, 6_000, 15_000];
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
/** Do not start an attempt that cannot finish before the caller's deadline. */
const MIN_ATTEMPT_MS = 10_000;

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly kind: "unavailable" | "invalid_json" | "invalid_shape" | "deadline",
    readonly attempts: number,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

/** Minimal surface of the SDK client, so tests can inject a fake. */
export interface GeminiClient {
  models: {
    generateContent(req: {
      model: string;
      contents: string;
      config: Record<string, unknown>;
    }): Promise<{
      text?: string;
      modelVersion?: string;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    }>;
  };
}

export interface GenerateJsonOptions<T> {
  system: string;
  user: string;
  /** Sent to Gemini as `responseJsonSchema`. */
  jsonSchema: Record<string, unknown>;
  /** Validates the decoded JSON (throws on mismatch). */
  parse: (raw: unknown) => T;
  label: string;
  log: Logger;
  temperature?: number;
  maxOutputTokens?: number;
  /** Epoch ms by which the whole call (including retries) must finish. */
  deadline?: number;
  /** GEMINI_MOCK=true: returned instead of calling the API. */
  mock?: () => unknown;
  client?: GeminiClient;
  sleep?: (ms: number) => Promise<void>;
}

export interface GenerateJsonResult<T> {
  data: T;
  usage: { in: number; out: number; thoughts: number };
  attempts: number;
  latencyMs: number;
  model: string;
  promptHash: string;
}

// Concurrency 1: free-tier rate limits, so calls queue behind each other.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

let defaultClient: GeminiClient | undefined;
function getClient(): GeminiClient {
  if (!defaultClient) {
    const { GEMINI_API_KEY } = requireEnv("GEMINI_API_KEY");
    defaultClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY }) as unknown as GeminiClient;
  }
  return defaultClient;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof ApiError) return RETRYABLE_STATUS.has(err.status);
  if (err instanceof Error) return err.name === "AbortError" || err.name === "TimeoutError" || err.name === "TypeError";
  return false;
}

function describe(err: unknown): string {
  if (err instanceof ApiError) return `HTTP ${err.status}`;
  if (err instanceof Error) return err.name === "AbortError" || err.name === "TimeoutError" ? "timeout" : err.name;
  return "unknown";
}

export function promptHash(system: string, user: string): string {
  return createHash("sha256").update(system).update("\u0000").update(user).digest("hex").slice(0, 16);
}

export async function generateJson<T>(opts: GenerateJsonOptions<T>): Promise<GenerateJsonResult<T>> {
  const hash = promptHash(opts.system, opts.user);
  const e = env();

  if (e.GEMINI_MOCK && opts.mock) {
    opts.log.info("gemini mock", { label: opts.label, promptHash: hash });
    return {
      data: opts.parse(opts.mock()),
      usage: { in: 0, out: 0, thoughts: 0 },
      attempts: 0,
      latencyMs: 0,
      model: "mock",
      promptHash: hash,
    };
  }

  const { GEMINI_MODEL } = requireEnv("GEMINI_MODEL");
  // Attempts rotate primary → fallbacks → primary…, sharing one backoff schedule.
  const models = [GEMINI_MODEL, ...e.GEMINI_FALLBACK_MODELS.filter((m) => m !== GEMINI_MODEL)];
  const client = opts.client ?? getClient();
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  return serial(async () => {
    const started = Date.now();
    let attempts = 0;
    let lastError: unknown;
    let outOfTime = false;

    for (let i = 0; i <= RETRY_DELAYS_MS.length; i += 1) {
      if (i > 0) {
        const delay = (RETRY_DELAYS_MS[i - 1] ?? 0) + Math.floor(Math.random() * 1000);
        if (opts.deadline && Date.now() + delay + MIN_ATTEMPT_MS > opts.deadline) {
          outOfTime = true;
          break;
        }
        await sleep(delay);
      }
      const remaining = opts.deadline ? opts.deadline - Date.now() : CALL_TIMEOUT_MS;
      if (remaining < MIN_ATTEMPT_MS) {
        outOfTime = true;
        break;
      }

      attempts += 1;
      const model = models[(attempts - 1) % models.length] as string;
      try {
        const res = await client.models.generateContent({
          model,
          contents: opts.user,
          config: {
            systemInstruction: opts.system,
            responseMimeType: "application/json",
            responseJsonSchema: opts.jsonSchema,
            temperature: opts.temperature ?? 0.4,
            thinkingConfig: { thinkingLevel: e.GEMINI_THINKING_LEVEL },
            ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
            abortSignal: AbortSignal.timeout(Math.min(CALL_TIMEOUT_MS, remaining)),
          },
        });

        let raw: unknown;
        try {
          raw = JSON.parse(res.text ?? "");
        } catch {
          throw new GeminiError("Gemini returned text that is not valid JSON", "invalid_json", attempts);
        }
        let data: T;
        try {
          data = opts.parse(raw);
        } catch (err) {
          throw new GeminiError(`Gemini JSON did not match the expected shape: ${(err as Error).message.slice(0, 300)}`, "invalid_shape", attempts);
        }

        const usage = {
          in: res.usageMetadata?.promptTokenCount ?? 0,
          out: res.usageMetadata?.candidatesTokenCount ?? 0,
          thoughts: res.usageMetadata?.thoughtsTokenCount ?? 0,
        };
        const latencyMs = Date.now() - started;
        const used = res.modelVersion ?? model;
        opts.log.info("gemini ok", { label: opts.label, attempts, latencyMs, usage, model: used, promptHash: hash });
        return { data, usage, attempts, latencyMs, model: used, promptHash: hash };
      } catch (err) {
        if (err instanceof GeminiError) throw err;
        lastError = err;
        opts.log.warn("gemini attempt failed", { label: opts.label, attempt: attempts, model, error: describe(err), promptHash: hash });
        if (!isRetryable(err)) break;
      }
    }

    throw new GeminiError(
      `Gemini unavailable after ${attempts} attempt(s): ${describe(lastError)}${outOfTime ? " (stopped: deadline)" : ""}`,
      outOfTime ? "deadline" : "unavailable",
      attempts,
    );
  });
}
