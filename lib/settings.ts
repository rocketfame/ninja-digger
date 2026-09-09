/**
 * app_settings — the runtime knobs (caps, pauses, cursors, promo codes) that we
 * change without a redeploy. Six files carried their own three-line copy of
 * these two functions, each with slightly different failure behaviour.
 *
 * Reads never throw: a knob that cannot be read falls back, because no setting
 * is worth halting a cron over.
 */
import { pool } from "@/lib/db";

export async function getSetting(key: string, fallback = ""): Promise<string> {
  return pool
    .query<{ value: string }>(`SELECT value FROM app_settings WHERE key = $1`, [key])
    .then((r) => r.rows[0]?.value ?? fallback)
    .catch(() => fallback);
}

/** Same, but distinguishes "not set" from an empty value. */
export async function getSettingOrNull(key: string): Promise<string | null> {
  return pool
    .query<{ value: string }>(`SELECT value FROM app_settings WHERE key = $1`, [key])
    .then((r) => r.rows[0]?.value ?? null)
    .catch(() => null);
}

/**
 * Writes THROW. A silently dropped write is how "/pause" reports success while
 * outreach keeps running — the one place where that matters. Callers that
 * genuinely do not care (a cron stamping its own start date) say so with an
 * explicit `.catch(() => {})`.
 */
export async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
}
