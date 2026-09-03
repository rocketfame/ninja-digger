/**
 * GET /api/cron/spotify-crawl — server-side email harvester for Spotify leads.
 * Takes leads that have public links (linktree/website) but no email yet, fetches
 * those pages (+ /contact, /about), extracts & filters a real contact email, and
 * writes it back. Fully autonomous — public pages, no Instagram session needed.
 * Runs on a schedule so enrichment → email happens without any manual step.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { pickBestEmail } from "@/lib/emailJunk";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PER_RUN = 40;
const CONCURRENCY = 6;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36";
function pickEmail(html: string): string | null {
  return pickBestEmail(html);
}
async function fetchText(url: string, ms = 10000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, redirect: "follow", signal: ctrl.signal });
    if (!r.ok) return "";
    return (await r.text()).slice(0, 400000);
  } catch { return ""; } finally { clearTimeout(t); }
}
function subpages(base: string): string[] {
  try {
    const u = new URL(base);
    if (/linktr\.ee|beacons|hoo\.be|linktw\.in|straw\.page|snd\.click|bio\.link|komi/i.test(u.host)) return [];
    const root = `${u.protocol}//${u.host}`;
    return [`${root}/contact`, `${root}/about`];
  } catch { return []; }
}
async function findEmail(urls: (string | null)[]): Promise<string | null> {
  for (let url of urls.filter(Boolean) as string[]) {
    if (!/^https?:\/\//.test(url)) url = "https://" + url;
    const html = await fetchText(url);
    if (html) { const e = pickEmail(html); if (e) return e; }
    for (const sp of subpages(url)) {
      const h2 = await fetchText(sp, 7000);
      if (h2) { const e = pickEmail(h2); if (e) return e; }
    }
  }
  return null;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { rows } = await pool.query<{ ig_username: string; linktree: string | null; website: string | null }>(
    `SELECT ig_username, linktree, website FROM spotify_leads
     WHERE email IS NULL AND (linktree IS NOT NULL OR website IS NOT NULL)
       AND (crawl_attempted_at IS NULL OR crawl_attempted_at < now() - interval '14 days')
     ORDER BY followers DESC NULLS LAST LIMIT $1`, [PER_RUN]
  ).catch(() => ({ rows: [] as { ig_username: string; linktree: string | null; website: string | null }[] }));

  let found = 0, done = 0;
  const queue = [...rows];
  async function worker() {
    while (queue.length) {
      const r = queue.shift()!;
      const email = await findEmail([r.linktree, r.website]);
      done++;
      // Mark the attempt regardless of outcome — otherwise the same top-N rows
      // are re-crawled every hour and the rest of the table is never reached.
      await pool.query(`UPDATE spotify_leads SET crawl_attempted_at = now() WHERE ig_username = $1`, [r.ig_username]).catch(() => {});
      if (email) {
        await pool.query(
          `UPDATE spotify_leads SET email=$2, email_source='link_crawl', enriched_at=now(), updated_at=now() WHERE ig_username=$1 AND email IS NULL`,
          [r.ig_username, email]
        ).catch(() => {});
        found++;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const emails = (await pool.query<{ c: number }>(`SELECT COUNT(email)::int c FROM spotify_leads`).catch(() => ({ rows: [{ c: 0 }] }))).rows[0]?.c ?? 0;
  return NextResponse.json({ ok: true, crawled: done, found, totalEmails: emails, ts: new Date().toISOString() });
}
