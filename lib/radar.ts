/**
 * Radar — shared helpers for the multi-source hot-lead discovery hub.
 * Sources (instagram / reddit / youtube / playlisting) all flow through here:
 * extract email + platform links, score "heat", upsert into radar_leads.
 */
import { pool } from "@/lib/db";

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const JUNK_EMAIL_RE = /(^(support|help|admin|webmaster|postmaster|abuse|hostmaster|billing|noc|sysadmin|security|privacy|feedback|info|contact|hello|team|mail|no-?reply)@)|(@(bandcamp|example|sentry|wixpress|godaddy|reddit|redditmail|youtube|sentry)\.)|(\.(png|jpg|gif)$)|(\.(ru|su|by)$)|(yandex\.)/i;

export function extractEmail(text: string, explicit?: string | null): string | null {
  const cands = [explicit, ...(text.match(EMAIL_RE) ?? [])].filter(Boolean) as string[];
  for (const raw of cands) {
    const e = raw.trim().toLowerCase().replace(/[.,;:]+$/, "");
    if (!JUNK_EMAIL_RE.test(e) && e.length <= 120) return e;
  }
  return null;
}

export function extractUrl(text: string, host: string): string | null {
  const m = text.match(new RegExp(`https?://[^\\s"')]*(?:${host})[^\\s"')]*`, "i"));
  return m ? m[0].replace(/[.,)]+$/, "") : null;
}

/** Heat score 0-100. Gate: must be on Spotify (caller enforces). */
export function computeHeat(x: {
  releaseDays?: number | null; // days since release
  hasIntent?: boolean;         // explicit promo/feedback ask
  followers?: number | null;   // followers or monthly listeners
  hasEmail?: boolean;
}): number {
  let s = 0;
  if (x.releaseDays != null) s += x.releaseDays <= 7 ? 40 : x.releaseDays <= 30 ? 20 : 0;
  if (x.hasIntent) s += 30;
  const f = x.followers ?? 0;
  if (f >= 500 && f <= 50000) s += 20; // sweet spot: serious enough to pay, small enough to need us
  else if (f > 50000 && f <= 200000) s += 8;
  if (x.hasEmail) s += 30;
  return Math.min(100, s);
}

export type RadarLead = {
  source: string;
  handle: string;
  name?: string | null;
  spotify_url?: string | null;
  soundcloud_url?: string | null;
  website?: string | null;
  email?: string | null;
  email_source?: string | null;
  followers?: number | null;
  monthly_listeners?: number | null;
  release_date?: string | null;
  intent_signal?: string | null;
  source_url?: string | null;
  heat_score?: number;
};

/** Upsert one radar lead. Dedup on (source, handle). Stamps email_found_at when
 * an email first appears. Returns 1 if a row was written/updated. */
export async function upsertRadarLead(l: RadarLead): Promise<number> {
  if (!l.handle || !l.source) return 0;
  const res = await pool.query(
    `INSERT INTO radar_leads (source, handle, name, spotify_url, soundcloud_url, website, email, email_source,
        followers, monthly_listeners, release_date, intent_signal, source_url, heat_score,
        enriched_at, email_found_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now(),
        CASE WHEN $7::text IS NOT NULL THEN now() ELSE NULL END, now())
     ON CONFLICT (source, handle) DO UPDATE SET
        name = COALESCE(EXCLUDED.name, radar_leads.name),
        spotify_url = COALESCE(radar_leads.spotify_url, EXCLUDED.spotify_url),
        soundcloud_url = COALESCE(radar_leads.soundcloud_url, EXCLUDED.soundcloud_url),
        website = COALESCE(radar_leads.website, EXCLUDED.website),
        email = COALESCE(radar_leads.email, EXCLUDED.email),
        email_source = COALESCE(radar_leads.email_source, EXCLUDED.email_source),
        email_found_at = CASE WHEN radar_leads.email IS NULL AND EXCLUDED.email IS NOT NULL THEN now() ELSE radar_leads.email_found_at END,
        followers = COALESCE(EXCLUDED.followers, radar_leads.followers),
        release_date = COALESCE(EXCLUDED.release_date, radar_leads.release_date),
        intent_signal = COALESCE(EXCLUDED.intent_signal, radar_leads.intent_signal),
        heat_score = GREATEST(radar_leads.heat_score, EXCLUDED.heat_score),
        enriched_at = now(), updated_at = now()`,
    [l.source, l.handle, l.name ?? null, l.spotify_url ?? null, l.soundcloud_url ?? null, l.website ?? null,
     l.email ?? null, l.email_source ?? null, l.followers ?? null, l.monthly_listeners ?? null,
     l.release_date ?? null, l.intent_signal ?? null, l.source_url ?? null, l.heat_score ?? 0]
  );
  return res.rowCount ?? 0;
}
