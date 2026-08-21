import { pool } from "@/lib/db";

/**
 * Best-effort single-flight lease. Vercel cron delivery is at-least-once — it
 * can fire the same schedule twice, which for an email sender means a duplicate
 * send. This grabs a short time-boxed lease in app_settings so only one instance
 * proceeds; the lease auto-expires (no explicit release needed) well within the
 * gap to the next scheduled run.
 *
 * Returns true if THIS instance may proceed. Fail-OPEN on DB error so a lock
 * hiccup never silently halts outreach.
 */
export async function acquireLease(name: string, minutes = 6): Promise<boolean> {
  return pool
    .query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, 'held', now())
       ON CONFLICT (key) DO UPDATE SET value = 'held', updated_at = now()
       WHERE app_settings.updated_at < now() - ($2 || ' minutes')::interval`,
      [`lease:${name}`, String(minutes)]
    )
    .then((r) => (r.rowCount ?? 0) > 0)
    .catch(() => true);
}
