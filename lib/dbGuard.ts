/**
 * DB space self-defense. The Neon free tier caps at 512MB and a full DB once
 * killed ingestion for months. This runs on the hourly cron so the system
 * heals itself and warns before hitting the wall — no human needed.
 *
 * Thresholds (of 512MB):
 *   RECLAIM (440) — auto-reclaim: TRUNCATE the regenerable cache, drop stale logs
 *   ALERT   (480) — still high after reclaim → Telegram 🔴 (deduped to 1 / 6h)
 * The harvest itself already stops adding rows above 460 (see cron/soundcloud).
 */
import { pool } from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";
import { getSettingOrNull, setSetting } from "@/lib/settings";

const RECLAIM_MB = 440;
const ALERT_MB = 480;
const ALERT_EVERY_MS = 6 * 3600 * 1000;

async function sizeMB(): Promise<number> {
  const r = await pool.query<{ mb: number }>(
    `SELECT (pg_database_size(current_database())/1048576.0)::numeric(10,1) AS mb`
  );
  return Number(r.rows[0].mb);
}


export async function defendDbSpace(): Promise<{ before: number; after: number; reclaimed: boolean; alerted: boolean }> {
  const before = await sizeMB();
  let reclaimed = false;
  let alerted = false;

  if (before >= RECLAIM_MB) {
    // Emergency reclaim — TRUNCATE/DROP free files immediately (unlike DELETE).
    await pool.query(`TRUNCATE url_cache`).catch(() => {});
    await pool.query(`DELETE FROM enrichment_runs WHERE started_at < now() - interval '2 days'`).catch(() => {});
    await pool.query(`DELETE FROM chart_entries WHERE snapshot_date < CURRENT_DATE - 42`).catch(() => {});
    await pool.query(`DELETE FROM bptoptracker_daily WHERE snapshot_date < CURRENT_DATE - 42`).catch(() => {});
    reclaimed = true;

    // Under real pressure only: drop worthless SC leads (tier C, no email, not a
    // promoter, harvested long ago). Valuable leads (with email / A-B / promoters)
    // are never touched. Deep followers like these aren't in refresh page-1, so
    // this won't churn-re-add them.
    if ((await sizeMB()) >= RECLAIM_MB) {
      await pool.query(
        `DELETE FROM sc_artists WHERE tier = 'C' AND email IS NULL AND is_promoter = false
           AND harvested_at < now() - interval '30 days'`
      ).catch(() => {});
    }
  }

  const after = await sizeMB();

  if (after >= ALERT_MB) {
    const last = await getSettingOrNull("db_alert_at");
    const lastMs = last ? Date.parse(last) : 0;
    if (!last || Date.now() - lastMs > ALERT_EVERY_MS) {
      await sendTelegramMessage(
        `🔴 УВАГА: база ${after} MB з 512 (ліміт близько).\n` +
        `Авточистка вже спрацювала${reclaimed ? " (звільнено кеш + старі чарти)" : ""}, але місця мало.\n` +
        `Харвест SC зупинено автоматично, щоб не впасти. Треба глянути, що росте.`
      );
      await setSetting("db_alert_at", new Date().toISOString());
      alerted = true;
    }
  }
  return { before, after, reclaimed, alerted };
}
