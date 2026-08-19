/**
 * POST /api/internal/spotify/enrich — receives IG profile info harvested from a
 * logged-in browser session (web_profile_info) and extracts contact/platform data.
 * Body: { items: [{ username, full_name?, bio?, external_url?, email?, followers? }] }
 * Parses bio + external_url for email / Spotify / SoundCloud / Linktree / website.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
export function OPTIONS() { return new NextResponse(null, { headers: CORS }); }

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Same junk hygiene as SoundCloud pipeline — no generic/support inboxes.
const JUNK_EMAIL_RE = /(^(support|help|admin|webmaster|postmaster|abuse|hostmaster|billing|noc|sysadmin|security|privacy|feedback|info|contact|hello|team|mail|no-?reply)@)|(@(bandcamp|example|sentry|wixpress|godaddy)\.)/i;

function pickEmail(text: string, explicit?: string | null): string | null {
  const cands = [explicit, ...(text.match(EMAIL_RE) ?? [])].filter(Boolean) as string[];
  for (const raw of cands) {
    const e = raw.trim().toLowerCase().replace(/[.,;]+$/, "");
    if (!JUNK_EMAIL_RE.test(e) && e.length <= 120) return e;
  }
  return null;
}

function findUrl(text: string, host: RegExp): string | null {
  const re = new RegExp(`https?://[^\\s"')]*${host.source}[^\\s"')]*`, "i");
  const m = text.match(re);
  if (m) return m[0].replace(/[.,)]+$/, "");
  // bare handle like "soundcloud.com/foo" without scheme
  const bare = text.match(new RegExp(`(?:^|\\s)((?:www\\.)?[^\\s"')]*${host.source}[^\\s"')]*)`, "i"));
  return bare ? "https://" + bare[1].replace(/^www\./, "").replace(/[.,)]+$/, "") : null;
}

type Item = { username?: string; full_name?: string; bio?: string; external_url?: string; email?: string; followers?: number };

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const items: Item[] = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ ok: false, error: "no items" }, { status: 400, headers: CORS });

  let updated = 0, withEmail = 0, withPlatform = 0;
  for (const it of items) {
    const username = String(it.username ?? "").trim().replace(/^@/, "").toLowerCase();
    if (!username) continue;
    const blob = `${it.bio ?? ""} ${it.external_url ?? ""}`;
    const email = pickEmail(blob, it.email);
    const spotify = findUrl(blob, /open\.spotify\.com|spotify\.link/);
    const soundcloud = findUrl(blob, /soundcloud\.com/);
    const linktree = findUrl(blob, /linktr\.ee|linktree|beacons\.ai|linkin\.bio|hoo\.be|snd\.click|bio\.link/);
    const website = it.external_url && !spotify && !soundcloud && !linktree ? it.external_url.slice(0, 300) : null;
    if (email) withEmail++;
    if (spotify || soundcloud) withPlatform++;

    const res = await pool.query(
      `UPDATE spotify_leads SET
         full_name = COALESCE($2, full_name),
         bio = COALESCE($3, bio),
         followers = COALESCE($4, followers),
         email = COALESCE($5, email),
         email_source = CASE WHEN email IS NULL AND $5 IS NOT NULL THEN 'ig_bio' ELSE email_source END,
         spotify_url = COALESCE(spotify_url, $6),
         soundcloud_url = COALESCE(soundcloud_url, $7),
         linktree = COALESCE(linktree, $8),
         website = COALESCE(website, $9),
         enriched_at = now(),
         updated_at = now()
       WHERE ig_username = $1`,
      [username, it.full_name ?? null, (it.bio ?? "").slice(0, 1000) || null, it.followers ?? null, email, spotify, soundcloud, linktree, website]
    );
    updated += res.rowCount ?? 0;
  }
  const stats = (await pool.query<{ total: number; emails: number; enriched: number }>(
    `SELECT COUNT(*)::int total, COUNT(email)::int emails, COUNT(enriched_at)::int enriched FROM spotify_leads`
  )).rows[0];
  return NextResponse.json({ ok: true, received: items.length, updated, withEmail, withPlatform, stats }, { headers: CORS });
}
