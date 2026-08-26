/**
 * GET /api/internal/outreach/test-send?to=you@gmail.com
 * TEST TOOL: sends touch 1/2/3 of every channel's copy to `to` (so you can read
 * the full sequence + offers), and registers `to` as a 'Contacted' lead in each
 * channel so your REPLY is caught → drafted → Approve button in Telegram.
 * Delete after testing.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRotatingMailer } from "@/lib/mailer";
import { buildTouchEmail } from "@/lib/touchCopy";
import { buildScEmail } from "@/lib/scOutreachCopy";
import { buildSpotifyEmail } from "@/lib/spotifyOutreachCopy";
import { buildRadarEmail } from "@/lib/radarOutreachCopy";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const to = new URL(request.url).searchParams.get("to");
  if (!to) return NextResponse.json({ ok: false, error: "pass ?to=" }, { status: 400 });
  const name = "there";
  const pct = 25;

  const rm = getRotatingMailer({});
  if (!rm) return NextResponse.json({ ok: false, error: "no mailer" }, { status: 500 });
  const { transporter, from, replyTo } = rm.mailer;

  // Register `to` as Contacted in every channel so a reply routes to each handler.
  await pool.query(`INSERT INTO spotify_leads (ig_username, email, lead_status, sp_touch, source_post, created_at, updated_at)
     VALUES ('test_rf', $1, 'Contacted', 1, 'test', now(), now())
     ON CONFLICT (ig_username) DO UPDATE SET email=$1, lead_status='Contacted', sp_touch=1`, [to]).catch(() => {});
  await pool.query(`INSERT INTO sc_artists (soundcloud_id, permalink, username, email, lead_status, sc_touch, track_count, is_active, tier, harvested_at, created_at, updated_at)
     VALUES ('test_rf', 'test_rf', 'test_rf', $1, 'Contacted', 1, 1, true, 'A', now(), now(), now())
     ON CONFLICT (soundcloud_id) DO UPDATE SET email=$1, lead_status='Contacted', sc_touch=1`, [to]).catch(() => {});
  await pool.query(`INSERT INTO radar_leads (source, handle, name, email, status, touch, heat_score, created_at, updated_at)
     VALUES ('youtube', 'test_rf', 'Test Artist', $1, 'contacted', 1, 90, now(), now())
     ON CONFLICT (source, handle) DO UPDATE SET email=$1, status='contacted', touch=1`, [to]).catch(() => {});
  await pool.query(`INSERT INTO artist_metrics (artist_beatport_id, artist_name) VALUES ('test_rf','Test Artist')
     ON CONFLICT (artist_beatport_id) DO NOTHING`, []).catch(() => {});
  await pool.query(`INSERT INTO artist_contacts (artist_beatport_id, type, value, confidence, status)
     VALUES ('test_rf','email',$1,0.9,'ok') ON CONFLICT DO NOTHING`, [to]).catch(() => {});
  await pool.query(`INSERT INTO lead_profiles (artist_beatport_id, status, updated_at) VALUES ('test_rf','Contacted',now())
     ON CONFLICT (artist_beatport_id) DO UPDATE SET status='Contacted', updated_at=now()`, []).catch(() => {});

  const sent: string[] = [];
  const send = async (tag: string, subject: string, text: string) => {
    try {
      await transporter.sendMail({ from, replyTo, to, subject: `[${tag}] ${subject}`, text });
      sent.push(tag);
      await new Promise((r) => setTimeout(r, 1500));
    } catch { /* skip */ }
  };

  for (const t of [1, 2, 3] as const) {
    const bp = buildTouchEmail(t, name); await send(`Beatport T${t}`, bp.subject, bp.text);
    const sc = buildScEmail(t, { name, pct, code: "SOUND20", unsubUrl: "https://ninja-digger.vercel.app/api/unsubscribe" }); await send(`SoundCloud T${t}`, sc.subject, sc.text);
    const sp = buildSpotifyEmail(t, { name, pct }); await send(`Spotify T${t}`, sp.subject, sp.text);
    const yt = buildRadarEmail("youtube", t, name, pct); await send(`YouTube T${t}`, yt.subject, yt.text);
  }

  return NextResponse.json({ ok: true, to, sentCount: sent.length, sent });
}
