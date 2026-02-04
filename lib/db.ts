import { Pool } from "pg";

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to .env and configure Postgres."
      );
    }
    _pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
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
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return (result.rows as T[]) ?? [];
  } finally {
    client.release();
  }
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
