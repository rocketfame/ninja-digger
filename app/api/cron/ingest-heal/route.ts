/**
 * GET /api/cron/ingest-heal
 * Morning self-healing ingest, SPLIT OUT of the hourly pipeline so heavy chart
 * collection can never starve the email-send budget again. Runs a few morning
 * hours: if today's charts are missing, collect them once (guarded by a soft
 * 30-min lock in app_settings) and refresh metrics + scores. Pure ingestion —
 * it never sends email. Sending lives in /api/cron/pipeline.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { runBptoptrackerDailyUpdate } from "@/lib/bptoptrackerDaily";
import { syncBptoptrackerToChartEntries } from "@/lib/bptoptrackerSync";
import { refreshArtistMetrics } from "@/segment/normalize";
import { refreshLeadScoresV2 } from "@/segment/score";
import { sendTelegramMessage } from "@/lib/telegram";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const todayRows = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int c FROM bptoptracker_daily WHERE snapshot_date = CURRENT_DATE`
  ).then((r) => r.rows[0]?.c ?? 0).catch(() => -1);

  if (todayRows > 0) {
    return NextResponse.json({ ok: true, skipped: "charts already present", rows: todayRows, ts: new Date().toISOString() });
  }
  if (todayRows === -1) {
    await sendTelegramMessage(`⚠️ <b>ingest-heal</b> — не зміг перевірити наявність чартів (DB недоступна?).`).catch(() => {});
    return NextResponse.json({ ok: false, error: "db check failed" }, { status: 500 });
  }

  // Soft lock: only one instance heals per 30-min window.
  const lock = await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('ingest_heal_lock', to_char(now(), 'YYYY-MM-DD'), now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
     WHERE app_settings.value != to_char(now(), 'YYYY-MM-DD') OR app_settings.updated_at < now() - interval '30 minutes'`
  ).then((r) => (r.rowCount ?? 0) > 0).catch(() => false);

  if (!lock) {
    return NextResponse.json({ ok: true, skipped: "another instance healing", ts: new Date().toISOString() });
  }

  console.log("[cron/ingest-heal] today's charts missing — self-healing ingest");
  const bpt = await runBptoptrackerDailyUpdate();
  if (bpt.inserted === 0) {
    await sendTelegramMessage(
      `🛠 Ранковий збір чартів ще не вдався (BPTT недоступний, ${bpt.errors.length} відмов) — повторю наступного вікна.`
    ).catch(() => {});
    return NextResponse.json({ ok: true, healed: false, note: "BPTT refused, will retry", ts: new Date().toISOString() });
  }
  await syncBptoptrackerToChartEntries();
  const metrics = await refreshArtistMetrics();
  const scores = await refreshLeadScoresV2();
  await sendTelegramMessage(
    `🛠 <b>Самолікування:</b> ранковий збір чартів не відпрацював — зібрав зараз.\n` +
    `+${bpt.inserted} рядків · метрики: ${metrics} · скоринг: ${scores}` +
    (bpt.errors.length ? `\n⚠️ Помилок: ${bpt.errors.length}` : "")
  ).catch(() => {});
  return NextResponse.json({ ok: true, healed: true, inserted: bpt.inserted, metrics, scores, ts: new Date().toISOString() });
}
