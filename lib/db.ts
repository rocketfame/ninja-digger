import { Pool } from "pg";

let _pool: Pool | null = null;

/** Normalize DATABASE_URL: SSL mode. (statement_timeout не підтримується Neon pooled — не додаємо.) */
function normalizeConnectionString(url: string): string {
  return url
    .replace(/([?&])sslmode=require\b/gi, "$1sslmode=verify-full")
    .replace(/([?&])sslmode=prefer\b/gi, "$1sslmode=verify-full")
    .replace(/([?&])sslmode=verify-ca\b/gi, "$1sslmode=verify-full");
}

function getPool(): Pool {
  if (!_pool) {
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
    _pool = new Pool({
      connectionString,
      max: 4,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 12000,
      keepAlive: true,
    });
  }
  return _pool;
}

/**
 * Shared Postgres pool for server-side use.
 * Do not use in client components.
 * Pool is created on first use so the app can run without DATABASE_URL (e.g. static pages).
 */
export const pool = new Proxy({} as Pool, {
  get(_, prop) {
    return (getPool() as unknown as Record<string, unknown>)[prop as string];
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
      if (!/timeout|connect|ECONNRESET|terminat|Connection|socket/i.test(msg)) throw e;
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
