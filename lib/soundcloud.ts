/**
 * SoundCloud harvesting via api-v2 (same client_id trick as enrichV1).
 * Harvests followers of seed accounts — organic followers of a promo channel
 * are almost all self-promoting musicians (our exact target).
 */

import { pool } from "@/lib/db";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const JUNK_EMAIL_RE = /(no-?reply|example\.|\.png|\.jpg|sentry|soundcloud\.com)/i;

let cachedClientId: { id: string; at: number } | null = null;

async function getClientId(): Promise<string | null> {
  if (cachedClientId && Date.now() - cachedClientId.at < 3600e3) return cachedClientId.id;
  try {
    const page = await fetch("https://soundcloud.com/discover", { headers: { "User-Agent": UA } }).then((r) => r.text());
    let cid = page.match(/client_id=([a-zA-Z0-9]{20,})/)?.[1] ?? null;
    if (!cid) {
      const scripts = [...page.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/[^"]+)"/g)].map((m) => m[1]);
      for (const s of scripts.reverse()) {
        const js = await fetch(s, { headers: { "User-Agent": UA } }).then((r) => r.text());
        const m = js.match(/client_id:"([a-zA-Z0-9]{20,})"/) || js.match(/client_id=([a-zA-Z0-9]{20,})/);
        if (m) { cid = m[1]; break; }
      }
    }
    if (cid) cachedClientId = { id: cid, at: Date.now() };
    return cid;
  } catch {
    return null;
  }
}

type ScUser = {
  id: number; permalink: string; permalink_url: string; username: string; full_name: string;
  city: string | null; country_code: string | null; description: string | null; avatar_url: string | null;
  track_count: number; followers_count: number; followings_count: number; likes_count: number;
  reposts_count: number; verified: boolean; created_at: string | null; last_modified: string | null;
};

async function api<T>(path: string, clientId: string): Promise<T | null> {
  try {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`https://api-v2.soundcloud.com${path}${sep}client_id=${clientId}`, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function tierFor(u: ScUser): string {
  // A: active artist in the promo sweet spot (real catalog, growing, not a star)
  if (u.track_count >= 5 && u.followers_count >= 50 && u.followers_count <= 20000) return "A";
  if (u.track_count >= 2 && u.followers_count <= 50000) return "B";
  return "C";
}

async function upsertArtist(u: ScUser, seed: string): Promise<boolean> {
  if (u.track_count < 1) return false; // not a musician (listener-only) — skip
  const emailMatch = (u.description ?? "").match(EMAIL_RE)?.[0]?.toLowerCase();
  const email = emailMatch && !JUNK_EMAIL_RE.test(emailMatch) ? emailMatch : null;
  const res = await pool.query(
    `INSERT INTO sc_artists (soundcloud_id, permalink, permalink_url, username, full_name, city, country_code,
        description, avatar_url, track_count, followers_count, followings_count, likes_count, reposts_count,
        verified, sc_created_at, last_modified, email, email_source, tier, source_seed, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,now())
     ON CONFLICT (soundcloud_id) DO UPDATE SET
        track_count=$10, followers_count=$11, followings_count=$12, likes_count=$13, reposts_count=$14,
        description=COALESCE(EXCLUDED.description, sc_artists.description),
        email=COALESCE(sc_artists.email, EXCLUDED.email),
        email_source=COALESCE(sc_artists.email_source, EXCLUDED.email_source),
        tier=$20, last_modified=$17, updated_at=now()`,
    [u.id, u.permalink, u.permalink_url, u.username, u.full_name || null, u.city, u.country_code,
     u.description, u.avatar_url, u.track_count, u.followers_count, u.followings_count, u.likes_count ?? 0,
     u.reposts_count ?? 0, u.verified ?? false, u.created_at, u.last_modified, email, email ? "bio" : null,
     tierFor(u), seed]
  );
  return (res.rowCount ?? 0) > 0;
}

/** Harvest one page of a seed account's followers; resumable via stored cursor. */
export async function harvestSeedFollowers(permalink: string, maxPages = 4): Promise<{ harvested: number; withEmail: number; done: boolean; error?: string }> {
  const clientId = await getClientId();
  if (!clientId) return { harvested: 0, withEmail: 0, done: false, error: "no client_id" };

  const seed = await pool.query<{ soundcloud_id: string | null; cursor: string | null }>(
    `SELECT soundcloud_id, cursor FROM sc_seed_accounts WHERE permalink = $1`, [permalink]
  ).then((r) => r.rows[0]);
  if (!seed) return { harvested: 0, withEmail: 0, done: true, error: "seed not found" };

  let userId = seed.soundcloud_id;
  if (!userId) {
    const resolved = await api<ScUser>(`/resolve?url=${encodeURIComponent(`https://soundcloud.com/${permalink}`)}`, clientId);
    if (!resolved?.id) return { harvested: 0, withEmail: 0, done: false, error: "resolve failed" };
    userId = String(resolved.id);
    await pool.query(`UPDATE sc_seed_accounts SET soundcloud_id=$1, username=$2, followers_count=$3 WHERE permalink=$4`,
      [resolved.id, resolved.username, resolved.followers_count, permalink]);
  }

  let cursor = seed.cursor;
  let harvested = 0, withEmail = 0, done = false;
  for (let page = 0; page < maxPages; page++) {
    const path = cursor
      ? cursor.replace("https://api-v2.soundcloud.com", "")
      : `/users/${userId}/followers?limit=200`;
    const data = await api<{ collection: ScUser[]; next_href: string | null }>(path, clientId);
    if (!data?.collection) { done = true; break; }
    for (const u of data.collection) {
      const isNew = await upsertArtist(u, permalink);
      if (isNew) harvested++;
      if ((u.description ?? "").match(EMAIL_RE)) withEmail++;
    }
    cursor = data.next_href;
    if (!cursor) { done = true; break; }
  }
  await pool.query(`UPDATE sc_seed_accounts SET cursor=$1, last_harvested_at=now() WHERE permalink=$2`,
    [done ? null : cursor, permalink]);
  return { harvested, withEmail, done };
}
