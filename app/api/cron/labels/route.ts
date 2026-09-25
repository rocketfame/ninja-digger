/**
 * GET /api/cron/labels — the record-label database, end to end (lib/labels):
 * ingest (charts daily, our own base chunk by chunk) → resolve SoundCloud
 * profile + country policy → crawl the label's site → email filters → sister
 * labels from the follow graph → grade. Once a day a Telegram digest with the
 * yield of every source.
 *
 * The SMTP layer runs locally (scripts/verify-labels.mjs): port 25 is closed here.
 */
import { NextResponse } from "next/server";
import { acquireLease } from "@/lib/cronLock";
import { getSettingOrNull, setSetting } from "@/lib/settings";
import { sendTelegramMessage } from "@/lib/telegram";
import { pool } from "@/lib/db";
import { ingestFromCharts, ingestFromOwnBase, resolveBatch, crawlBatch, expandGraph, gradeLabels, labelSourceStats } from "@/lib/labels";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VIA_UA: Record<string, string> = {
  charts: "Beatport-чарти", our_base_sc: "наша SC-база", our_base_yt: "наш YouTube", our_base_ig: "наш Instagram", sc_graph: "граф підписок",
};

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await acquireLease("labels", 6))) return NextResponse.json({ ok: true, skipped: "locked" });

  const t0 = Date.now();
  const out: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { out[name] = await fn(); } catch (e) { out[name] = { error: String(e).slice(0, 200) }; }
  };

  const today = new Date().toISOString().slice(0, 10);
  if ((await getSettingOrNull("labels_chart_day")) !== today) {
    await step("charts", ingestFromCharts);
    await setSetting("labels_chart_day", today);
  }
  await step("ownBase", ingestFromOwnBase);
  await step("resolve", () => resolveBatch(80));
  await step("crawl", () => crawlBatch(40));
  if (Date.now() - t0 < 200_000) await step("graph", () => expandGraph(4));
  await step("grade", gradeLabels);

  // Daily digest after 09:00 UTC: what the base holds and what each source yields.
  if (new Date().getUTCHours() >= 9 && (await getSettingOrNull("labels_digest_day")) !== today) {
    await setSetting("labels_digest_day", today);
    const t = (await pool.query<{ total: number; resolved: number; a: number; b: number; c: number; pending: number; valid: number }>(
      `SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE status='resolved')::int resolved,
              COUNT(*) FILTER (WHERE grade='A')::int a, COUNT(*) FILTER (WHERE grade='B')::int b, COUNT(*) FILTER (WHERE grade='C')::int c,
              (SELECT COUNT(*) FROM label_db_emails WHERE verdict='pending')::int pending,
              (SELECT COUNT(*) FROM label_db_emails WHERE verdict='valid')::int valid
         FROM label_db`
    )).rows[0];
    const src = (await labelSourceStats())
      .map((s) => `• ${VIA_UA[s.via] ?? s.via}: ${s.total} → з email ${s.with_email} (A ${s.grade_a}), виключено ${s.excluded}`)
      .join("\n");
    await sendTelegramMessage(
      `🏷 База лейблів\n\nУсього ${t.total}, перевірено ${t.resolved}\nA ${t.a} · B ${t.b} · C ${t.c}\n` +
      `Email: valid ${t.valid}, чекають SMTP ${t.pending}${t.pending > 0 ? " → scripts/verify-labels.mjs" : ""}\n\nДжерела:\n${src}`
    ).catch(() => {});
  }

  return NextResponse.json({ ok: true, ms: Date.now() - t0, ...out });
}
