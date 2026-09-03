/**
 * GET /api/cron/radar-enrich — server-side enrichment of radar leads that have
 * a link but no email yet. Fetches the artist's aggregator page (linktr.ee /
 * beacons / bandcamp / hypeddit) and SoundCloud, and extracts a contact email
 * from the HTML. Pure server-side — no browser, no IG throttle.
 *
 * link_checked_at is stamped every attempt so we never re-crawl the same page,
 * and email_found_at is stamped by upsert logic when an email first appears.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { extractEmail, extractUrl } from "@/lib/radar";
import { acquireLease } from "@/lib/cronLock";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PER_RUN = 40;
const CONCURRENCY = 6;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

type Lead = { id: number; website: string | null; soundcloud_url: string | null; spotify_url: string | null };

async function fetchText(url: string): Promise<string> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 9000);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*" }, signal: c.signal, redirect: "follow" });
    if (!r.ok) return "";
    return (await r.text()).slice(0, 400_000);
  } catch { return ""; } finally { clearTimeout(t); }
}

/** Try the lead's links in order of email-likelihood; return the first real email. */
async function enrichOne(lead: Lead): Promise<{ email: string | null; extraSpotify: string | null; extraSc: string | null }> {
  const urls = [lead.website, lead.soundcloud_url].filter(Boolean) as string[];
  let extraSpotify: string | null = null, extraSc: string | null = null;
  for (const u of urls) {
    const html = await fetchText(u);
    if (!html) continue;
    // linktr.ee / beacons embed their links + sometimes an email in a JSON blob
    // in the HTML; extractEmail scans the whole thing and drops junk addresses.
    const email = extractEmail(html);
    if (!extraSpotify) extraSpotify = extractUrl(html, "open\\.spotify\\.com");
    if (!extraSc) extraSc = extractUrl(html, "soundcloud\\.com");
    if (email) return { email, extraSpotify, extraSc };
  }
  return { email: null, extraSpotify, extraSc };
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await acquireLease("radar-enrich", 6))) {
    return NextResponse.json({ ok: true, skipped: "locked" });
  }

  const leads = await pool
    .query<Lead>(
      `SELECT id, website, soundcloud_url, spotify_url FROM radar_leads
       WHERE email IS NULL AND (link_checked_at IS NULL OR link_checked_at < now() - interval '14 days')
         AND (website IS NOT NULL OR soundcloud_url IS NOT NULL)
       ORDER BY heat_score DESC, created_at DESC LIMIT $1`,
      [PER_RUN]
    )
    .then((r) => r.rows)
    .catch(() => [] as Lead[]);

  if (leads.length === 0) return NextResponse.json({ ok: true, processed: 0, found: 0, note: "no link-only leads to enrich" });

  let found = 0, processed = 0;
  for (let i = 0; i < leads.length; i += CONCURRENCY) {
    const batch = leads.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (lead) => {
        const { email, extraSpotify, extraSc } = await enrichOne(lead);
        processed++;
        await pool.query(
          `UPDATE radar_leads SET
             email = COALESCE($2, email),
             email_source = CASE WHEN $2 IS NOT NULL THEN 'link_enrich' ELSE email_source END,
             email_found_at = CASE WHEN email IS NULL AND $2 IS NOT NULL THEN now() ELSE email_found_at END,
             spotify_url = COALESCE(spotify_url, $3),
             soundcloud_url = COALESCE(soundcloud_url, $4),
             heat_score = CASE WHEN $2 IS NOT NULL THEN LEAST(100, heat_score + 30) ELSE heat_score END,
             link_checked_at = now(), updated_at = now()
           WHERE id = $1`,
          [lead.id, email, extraSpotify, extraSc]
        ).catch(() => {});
        if (email) found++;
      })
    );
  }
  return NextResponse.json({ ok: true, processed, found, ts: new Date().toISOString() });
}
