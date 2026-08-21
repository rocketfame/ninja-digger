/**
 * SoundCloud harvesting via api-v2 (same client_id trick as enrichV1).
 * Harvests followers of seed accounts — organic followers of a promo channel
 * are almost all self-promoting musicians (our exact target).
 */

import { pool } from "@/lib/db";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const JUNK_EMAIL_RE = /(no-?reply|example\.|\.png|\.jpg|sentry|soundcloud\.com|bandcamp\.com|^(support|help|admin|webmaster|postmaster|abuse|hostmaster|billing|noc|sysadmin|security|privacy|feedback)@)/i;

let cachedClientId: { id: string; at: number } | null = null;

// All SoundCloud fetches must be bounded — without a timeout a slow/hung SC
// endpoint burns the whole 120s cron budget and the run produces nothing.
const SC_TIMEOUT_MS = 12000;
function scFetch(url: string): Promise<Response> {
  return fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SC_TIMEOUT_MS) });
}

export async function getClientId(): Promise<string | null> {
  if (cachedClientId && Date.now() - cachedClientId.at < 3600e3) return cachedClientId.id;
  try {
    const page = await scFetch("https://soundcloud.com/discover").then((r) => r.text());
    let cid = page.match(/client_id=([a-zA-Z0-9]{20,})/)?.[1] ?? null;
    if (!cid) {
      const scripts = [...page.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/[^"]+)"/g)].map((m) => m[1]);
      for (const s of scripts.reverse()) {
        const js = await scFetch(s).then((r) => r.text());
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

/** Fetch a user's current SoundCloud bio/description (where booking emails live). */
export async function fetchScDescription(soundcloudId: string | number): Promise<string | null> {
  const clientId = await getClientId();
  if (!clientId) return null;
  const u = await api<{ description: string | null }>(`/users/${soundcloudId}`, clientId);
  return u?.description ?? null;
}

async function api<T>(path: string, clientId: string): Promise<T | null> {
  try {
    const sep = path.includes("?") ? "&" : "?";
    const res = await scFetch(`https://api-v2.soundcloud.com${path}${sep}client_id=${clientId}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Alive = recent profile activity and not a mass-follower bot. */
function isAlive(u: ScUser): boolean {
  const modifiedMs = u.last_modified ? Date.parse(u.last_modified) : 0;
  const activeRecently = modifiedMs > Date.now() - 180 * 86400e3; // 6 months
  const notBot = u.followings_count < 2000 && (u.followers_count === 0 || u.followings_count < u.followers_count * 10);
  return activeRecently && notBot;
}

function tierFor(u: ScUser): string {
  // A (perlina): active artist, real catalog, growing, not a star, and ALIVE
  if (isAlive(u) && u.track_count >= 5 && u.followers_count >= 50 && u.followers_count <= 20000) return "A";
  // B: has a catalog but weaker or less-fresh signals
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
        verified, sc_created_at, last_modified, email, email_source, tier, is_active, source_seed, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,now())
     ON CONFLICT (soundcloud_id) DO UPDATE SET
        track_count=$10, followers_count=$11, followings_count=$12, likes_count=$13, reposts_count=$14,
        description=COALESCE(EXCLUDED.description, sc_artists.description),
        email=COALESCE(sc_artists.email, EXCLUDED.email),
        email_source=COALESCE(sc_artists.email_source, EXCLUDED.email_source),
        tier=$20, is_active=$21, last_modified=$17, updated_at=now()`,
    [u.id, u.permalink, u.permalink_url, u.username, u.full_name || null, u.city, u.country_code,
     u.description, u.avatar_url, u.track_count, u.followers_count, u.followings_count, u.likes_count ?? 0,
     u.reposts_count ?? 0, u.verified ?? false, u.created_at, u.last_modified, email, email ? "bio" : null,
     tierFor(u), isAlive(u), seed]
  );
  return (res.rowCount ?? 0) > 0;
}

/** Add a seed account from a SoundCloud URL or bare permalink. Resolves it live. */
export async function addSeed(input: string): Promise<{ ok: boolean; permalink?: string; followers?: number; error?: string }> {
  const clientId = await getClientId();
  if (!clientId) return { ok: false, error: "no client_id" };
  const permalink = input.trim().replace(/\/+$/, "").replace(/^https?:\/\/(www\.)?soundcloud\.com\//i, "").split(/[?#]/)[0];
  if (!permalink || permalink.includes("/")) return { ok: false, error: "невірний профіль (очікую soundcloud.com/username)" };
  const u = await api<ScUser>(`/resolve?url=${encodeURIComponent(`https://soundcloud.com/${permalink}`)}`, clientId);
  if (!u?.id) return { ok: false, error: "профіль не знайдено на SoundCloud" };
  await pool.query(
    `INSERT INTO sc_seed_accounts (permalink, soundcloud_id, username, followers_count, active)
     VALUES ($1,$2,$3,$4,true)
     ON CONFLICT (permalink) DO UPDATE SET soundcloud_id=$2, username=$3, followers_count=$4, active=true`,
    [permalink, u.id, u.username, u.followers_count]
  );
  return { ok: true, permalink, followers: u.followers_count };
}

/** Deep-verify tier-A candidates: fetch latest track date, drop non-posters to B. */
export async function verifyActiveArtists(limit = 60): Promise<{ checked: number; confirmed: number }> {
  const clientId = await getClientId();
  if (!clientId) return { checked: 0, confirmed: 0 };
  const rows = (await pool.query<{ soundcloud_id: string }>(
    `SELECT soundcloud_id FROM sc_artists WHERE tier='A' AND verified_at IS NULL ORDER BY followers_count DESC LIMIT $1`,
    [limit]
  )).rows;
  let confirmed = 0;
  for (const r of rows) {
    const tracks = await api<{ collection: { created_at: string }[] }>(`/users/${r.soundcloud_id}/tracks?limit=1`, clientId);
    const latest = tracks?.collection?.[0]?.created_at;
    const postedRecently = latest ? Date.parse(latest) > Date.now() - 365 * 86400e3 : false; // track in last year
    await pool.query(
      `UPDATE sc_artists SET last_track_at=$1, verified_at=now(),
         tier = CASE WHEN $2 THEN tier ELSE 'B' END,
         is_active = $2
       WHERE soundcloud_id=$3`,
      [latest ?? null, postedRecently, r.soundcloud_id]
    );
    if (postedRecently) confirmed++;
  }
  return { checked: rows.length, confirmed };
}

// We keep only the newest slice of each promo channel's followers: they are the
// freshest, most-active leads, and it stops a single 20k-follower channel from
// flooding the DB. Deep followers are older and mostly stale. Empirically the
// first ~2000 followers of a Re-Ex advertiser are the active ones; below that
// gets raw/inactive, so 2000 is the cutoff (per the Re-Ex lead-gen rule).
const PER_SEED_CAP = 2000;

/** Fetch real profile data for Re-Ex promoters we ingested without it, so
 * repost/promo channels (0 own tracks — analytics only) can be told apart from
 * real artists (track_count >= 1 — outreach leads). Recomputes tier from the
 * fetched track_count so forced-A repost channels drop out of the lead pool. */
export async function refreshPromoterProfiles(limit = 15): Promise<{ checked: number; withTracks: number }> {
  const clientId = await getClientId();
  if (!clientId) return { checked: 0, withTracks: 0 };
  const rows = (await pool.query<{ soundcloud_id: string }>(
    `SELECT soundcloud_id FROM sc_artists
     WHERE is_promoter = true AND profile_refreshed_at IS NULL
     ORDER BY followers_count DESC LIMIT $1`, [limit]
  )).rows;
  let withTracks = 0;
  for (const r of rows) {
    const u = await api<ScUser>(`/users/${r.soundcloud_id}`, clientId);
    if (!u) {
      await pool.query(`UPDATE sc_artists SET profile_refreshed_at=now() WHERE soundcloud_id=$1`, [r.soundcloud_id]).catch(() => {});
      continue;
    }
    if ((u.track_count ?? 0) >= 1) withTracks++;
    await pool.query(
      `UPDATE sc_artists SET track_count=$1, followers_count=$2, followings_count=$3, likes_count=$4,
         reposts_count=$5, last_modified=$6, city=COALESCE(city,$7), country_code=COALESCE(country_code,$8),
         tier=$9, is_active=$10, profile_refreshed_at=now(), updated_at=now()
       WHERE soundcloud_id=$11`,
      [u.track_count ?? 0, u.followers_count ?? 0, u.followings_count ?? 0, u.likes_count ?? 0, u.reposts_count ?? 0,
       u.last_modified, u.city, u.country_code, tierFor(u), isAlive(u), r.soundcloud_id]
    ).catch(() => {});
  }
  return { checked: rows.length, withTracks };
}

/** Harvest one page of a seed account's followers; resumable via stored cursor.
 * Once a seed reaches PER_SEED_CAP (or runs out) it's marked completed and drops
 * to the back of the queue; a completed seed is only revisited for NEW followers
 * (page 1 only), so we never re-parse the same people. */
export async function harvestSeedFollowers(permalink: string, maxPages = 4): Promise<{ harvested: number; withEmail: number; done: boolean; refresh?: boolean; error?: string }> {
  const clientId = await getClientId();
  if (!clientId) return { harvested: 0, withEmail: 0, done: false, error: "no client_id" };

  const seed = await pool.query<{ soundcloud_id: string | null; cursor: string | null; harvested_count: number; completed_at: string | null }>(
    `SELECT soundcloud_id, cursor, harvested_count, completed_at FROM sc_seed_accounts WHERE permalink = $1`, [permalink]
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

  // Refresh mode: an already-completed seed — just check its newest page for new
  // followers (dedup drops the ones we already have), don't paginate deep again.
  const refresh = seed.completed_at != null;
  const pageBudget = refresh ? 1 : maxPages;
  let cursor = refresh ? null : seed.cursor;
  let count = seed.harvested_count ?? 0;
  let harvested = 0, withEmail = 0, done = false, capped = false;
  for (let page = 0; page < pageBudget; page++) {
    const path = cursor
      ? cursor.replace("https://api-v2.soundcloud.com", "")
      : `/users/${userId}/followers?limit=200`;
    const data = await api<{ collection: ScUser[]; next_href: string | null }>(path, clientId);
    if (!data?.collection) { done = true; break; }
    for (const u of data.collection) {
      const isNew = await upsertArtist(u, permalink);
      if (isNew) { harvested++; count++; }
      if ((u.description ?? "").match(EMAIL_RE)) withEmail++;
    }
    cursor = data.next_href;
    if (!cursor) { done = true; break; }
    if (!refresh && count >= PER_SEED_CAP) { capped = true; done = true; break; }
  }
  // Mark completed when we hit the cap or exhausted the list (deep pass only).
  const nowCompleted = !refresh && (done || capped);
  await pool.query(
    `UPDATE sc_seed_accounts
       SET cursor = $1, harvested_count = $2, last_harvested_at = now(),
           completed_at = CASE WHEN $3 THEN now() ELSE completed_at END
     WHERE permalink = $4`,
    [nowCompleted ? null : cursor, count, nowCompleted, permalink]
  );
  return { harvested, withEmail, done, refresh };
}
