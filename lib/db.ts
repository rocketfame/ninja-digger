import { Pool } from "pg";

let _pool: Pool | null = null;

/** Normalize DATABASE_URL: SSL mode. (statement_timeout не підтримується Neon pooled — не додаємо.) */
function normalizeConnectionString(url: string): string {
  return url
    .replace(/([?&])sslmode=require\b/gi, "$1sslmode=verify-full")
    .replace(/([?&])sslmode=prefer\b/gi, "$1sslmode=verify-full")
    .replace(/([?&])sslmode=verify-ca\b/gi, "$1sslmode=verify-full");
}

function buildPool(): Pool {
  let connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and configure Postgres."
    );
  }
  connectionString = normalizeConnectionString(connectionString);
  // Serverless: each concurrent Vercel instance opens its own pool, so a big
  // `max` multiplied across instances can exhaust Neon's connection limit and
  // make pages hang on connection acquisition. Keep it small and fail fast.
  // NOTE: do NOT lower below 8. Empirically max=4 caused pages/crons to return
  // nulls — a single page needs ~5 concurrent connections, and with several
  // crons in flight max=4 exhausts the pool and requests hang on acquisition.
  // Neon's pooled endpoint tolerates this fine. (Reverted an audit suggestion
  // that ignored this history.)
  const p = new Pool({
    connectionString,
    max: 8,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 12000,
    keepAlive: true,
  });
  // REQUIRED by node-pg: without an 'error' listener, an error on an IDLE client
  // (e.g. Neon severing a pooled connection while this serverless instance was
  // frozen between invocations) throws as an unhandled exception. Handling it
  // lets the pool discard the dead client instead of handing it to the next
  // caller — the root cause of "timeout exceeded when trying to connect" that
  // only some warm instances hit.
  p.on("error", (err) => {
    console.error("[db] idle client error (pool will recycle it):", err instanceof Error ? err.message : err);
  });
  return p;
}

function getPool(): Pool {
  if (!_pool) _pool = buildPool();
  return _pool;
}

/** Drop the current pool so the next call builds a fresh one. Used to recover
 * from a pool full of stale connections after an instance freeze. */
async function resetPool(): Promise<void> {
  const old = _pool;
  _pool = null;
  if (old) { try { await old.end(); } catch { /* dead already */ } }
}

const TRANSIENT_RE = /timeout|connect|ECONNRESET|ETIMEDOUT|terminat|Connection|socket|EPIPE/i;

/** Self-healing pool.query: on a transient connection error (stale pooled conn
 * after a serverless freeze, Neon cold-start, etc.) drop the pool and retry on
 * a fresh one. Every `pool.query(...)` caller in the app gets this for free. */
async function resilientQuery(text: unknown, params?: unknown): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await (getPool().query as (t: unknown, p?: unknown) => Promise<unknown>)(text, params);
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!TRANSIENT_RE.test(msg)) throw e; // real SQL error — surface immediately
      await resetPool();
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/**
 * Shared Postgres pool for server-side use.
 * Do not use in client components.
 * Pool is created on first use so the app can run without DATABASE_URL (e.g. static pages).
 * `.query` is transparently wrapped with connection-error retry + pool reset;
 * all other members (connect, end, on, …) pass through to the live pool.
 */
export const pool = new Proxy({} as Pool, {
  get(_, prop) {
    if (prop === "query") return resilientQuery;
    const real = getPool() as unknown as Record<string, unknown>;
    const val = real[prop as string];
    return typeof val === "function" ? (val as (...a: unknown[]) => unknown).bind(real) : val;
  },
});

/**
 * Run a query and return rows. Use for SELECT and parameterized statements.
 */
export async function query<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  // Neon free-tier compute autosuspends; the first query after idle can fail
  // with "timeout exceeded when trying to connect" while it wakes. Retry a few
  // times with backoff so pages never surface a cold-start blip as an error.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const client = await pool.connect();
      try {
        const result = await client.query(text, params);
        return (result.rows as T[]) ?? [];
      } finally {
        client.release();
      }
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      // Only retry transient connection issues, not SQL errors.
      if (!TRANSIENT_RE.test(msg)) throw e;
      await resetPool(); // stale connection after a freeze — rebuild the pool
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/**
 * Verify DB connectivity. Call once at startup or in health checks.
 */
export async function checkConnection(): Promise<boolean> {
  try {
    await query<{ now: string }>("SELECT NOW() as now");
    return true;
  } catch {
    return false;
  }
}
