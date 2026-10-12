import { randomUUID } from "node:crypto";

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

export interface Logger {
  readonly requestId: string;
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(fields: Fields): Logger;
}

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  return value;
}

export function createLogger(context: Fields = {}, requestId: string = randomUUID()): Logger {
  const emit = (level: Level, msg: string, fields: Fields = {}) => {
    const entry: Fields = { level, msg, time: new Date().toISOString(), requestId, ...context };
    for (const [key, value] of Object.entries(fields)) entry[key] = serialize(value);
    const line = JSON.stringify(entry);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };

  return {
    requestId,
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (fields) => createLogger({ ...context, ...fields }, requestId),
  };
}

/** `an…@gmail.com` — never log a full address. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "…";
  return `${email.slice(0, Math.min(2, at))}…${email.slice(at)}`;
}
