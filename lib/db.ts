import { neon, Pool } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle as drizzleHttp, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzleWs, type NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "@/db/schema";
import { requireEnv } from "@/lib/env";

export type Db = NeonHttpDatabase<typeof schema>;
export type TxDb = NeonDatabase<typeof schema>;
export type Tx = Parameters<Parameters<TxDb["transaction"]>[0]>[0];

let httpDb: Db | undefined;

/** HTTP driver: one round trip per query, no transactions. For simple reads/writes. */
export function db(): Db {
  if (!httpDb) {
    const { DATABASE_URL } = requireEnv("DATABASE_URL");
    httpDb = drizzleHttp(neon(DATABASE_URL), { schema });
  }
  return httpDb;
}

/**
 * Runs `fn` in a real transaction over a short-lived WebSocket pool, closed
 * afterwards (serverless functions must not keep idle sockets open).
 * Use for swap, confirm and send-batch claiming.
 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const { DATABASE_URL } = requireEnv("DATABASE_URL");
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    return await drizzleWs(pool, { schema }).transaction(fn);
  } finally {
    await pool.end();
  }
}

/** Resolves on success, throws if the database is unreachable. */
export async function pingDb(): Promise<{ ok: true; latencyMs: number }> {
  const started = Date.now();
  await db().execute(sql`select 1`);
  return { ok: true, latencyMs: Date.now() - started };
}

/** Neon's direct (non-pooled) host is the pooled host without `-pooler`. */
export function toDirectUrl(pooledUrl: string): string {
  const url = new URL(pooledUrl);
  url.hostname = url.hostname.replace(/-pooler(?=\.)/, "");
  return url.toString();
}
