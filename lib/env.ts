import { z } from "zod";

// Integrations come online phase by phase, so their keys are optional here and
// enforced at the point of use with requireEnv(). Error messages name keys only.

const bool = (fallback: boolean) =>
  z
    .enum(["true", "false"])
    .default(fallback ? "true" : "false")
    .transform((v) => v === "true");

const numericId = z.string().regex(/^-?\d+$/, "must be a numeric Telegram id");

const emailList = z
  .string()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.email()));

export const EnvSchema = z.object({
  DATABASE_URL: z.url().optional(),

  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).optional(),
  // Comma-separated Flash models tried in rotation when the primary is overloaded.
  GEMINI_FALLBACK_MODELS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  // LOW halved latency and avoided overload errors in live tests (2026-10-12).
  GEMINI_THINKING_LEVEL: z.enum(["MINIMAL", "LOW", "MEDIUM", "HIGH"]).default("LOW"),
  GEMINI_MOCK: bool(false),

  NEWS_API_KEY: z.string().min(1).optional(),

  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[\w-]+$/, "not a bot token").optional(),
  // Telegram allows 1–256 chars of A–Z a–z 0–9 _ - for the webhook secret.
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[\w-]{1,256}$/, "invalid characters").optional(),
  SHREYA_TG_USER_ID: numericId.optional(),
  SHREYA_TG_CHAT_ID: numericId.optional(),

  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(3).optional(),
  MAIL_REPLY_TO: z.email().optional(),
  SEND_ALLOWLIST: emailList,
  // Safe default: unless explicitly "false", only SEND_ALLOWLIST receives real mail.
  DEMO_MODE: bool(true),

  CRON_SECRET: z.string().min(16).optional(),
  ADMIN_TOKEN: z.string().min(16).optional(),
  UNSUB_SIGNING_KEY: z.string().min(32).optional(),
  APP_URL: z.url().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export class EnvError extends Error {
  constructor(
    message: string,
    readonly keys: string[],
  ) {
    super(message);
    this.name = "EnvError";
  }
}

function readRaw(source: Record<string, string | undefined>): Record<string, string | undefined> {
  const raw: Record<string, string | undefined> = {};
  for (const key of Object.keys(EnvSchema.shape)) {
    const value = source[key];
    // Blank values (`FOO=` in a dotenv file or dashboard) mean "not set".
    raw[key] = value === undefined || value.trim() === "" ? undefined : value.trim();
  }
  return raw;
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(readRaw(source));
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((i) => String(i.path[0])))];
    const detail = result.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`).join("; ");
    throw new EnvError(`Invalid environment: ${detail}`, keys);
  }
  return result.data;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Test hook: forget the cached env so the next env() re-reads process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}

type RequiredEnv<K extends keyof Env> = { [P in K]-?: NonNullable<Env[P]> };

export function requireEnv<K extends keyof Env>(...keys: K[]): RequiredEnv<K> {
  const current = env();
  const missing = keys.filter((k) => current[k] === undefined);
  if (missing.length > 0) {
    throw new EnvError(`Missing environment variables: ${missing.join(", ")}`, missing);
  }
  return Object.fromEntries(keys.map((k) => [k, current[k]])) as RequiredEnv<K>;
}

/** Which integrations have their keys set. Booleans only; safe to expose. */
export function configuredFeatures(e: Env = env()) {
  return {
    database: Boolean(e.DATABASE_URL),
    gemini: Boolean(e.GEMINI_API_KEY && e.GEMINI_MODEL) || e.GEMINI_MOCK,
    gnews: Boolean(e.NEWS_API_KEY),
    telegram: Boolean(e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_WEBHOOK_SECRET),
    telegramAllowlist: Boolean(e.SHREYA_TG_USER_ID && e.SHREYA_TG_CHAT_ID),
    resend: Boolean(e.RESEND_API_KEY && e.MAIL_FROM),
    resendWebhook: Boolean(e.RESEND_WEBHOOK_SECRET),
    cronAuth: Boolean(e.CRON_SECRET),
    adminAuth: Boolean(e.ADMIN_TOKEN),
    unsubscribeTokens: Boolean(e.UNSUB_SIGNING_KEY),
    appUrl: Boolean(e.APP_URL),
  };
}
