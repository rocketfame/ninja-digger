/**
 * Graph discovery — the SoundCloud lead engine that does not run out.
 *
 * The seed-and-followers approach walks the WRONG edge. Measured on live data:
 * a producer's followers are 44% producers (the rest are listeners, ~5% carry an
 * email), while the people that producer FOLLOWS are 90% producers and 52% of
 * them keep a booking address in the bio. Fifty usable addresses per API request
 * against six and a half from track search, and no seed list to exhaust: every
 * producer found opens roughly 270 more.
 *
 * The frontier is a column on sc_artists, not a table of its own — "not yet
 * expanded" is a property of the artist, and a second table would be a second
 * identity to keep in step.
 */
import { pool } from "@/lib/db";
import { getClientId } from "@/lib/soundcloud";
import { pickBestEmail } from "@/lib/emailJunk";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36";
const TIMEOUT_MS = 12000;
/** A producer, not a listener. One track can be a repost or a DJ set rip; three is a catalogue. */
const PRODUCER_MIN_TRACKS = 3;

type ScUser = {
  id: number; permalink: string; permalink_url: string; username: string; full_name: string | null;
  city: string | null; country_code: string | null; description: string | null; avatar_url: string | null;
  track_count: number; followers_count: number; followings_count: number;
  likes_count?: number; reposts_count?: number; verified?: boolean;
  created_at?: string | null; last_modified?: string | null;
};

async function api<T>(path: string, clientId: string): Promise<T | null> {
  const sep = path.includes("?") ? "&" : "?";
  try {
    const res = await fetch(`https://api-v2.soundcloud.com${path}${sep}client_id=${clientId}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** A: real catalogue and reach, B: active, C: everyone else. Same ladder the harvester uses. */
function tierFor(u: ScUser): "A" | "B" | "C" {
  if (u.track_count >= 10 && u.followers_count >= 1000) return "A";
  if (u.track_count >= 3) return "B";
  return "C";
}

/**
 * Write a page of discovered users in ONE statement. Per-row upserts were the
 * limiting factor: a single expansion returns ~270 users and a run covers
 * dozens of them, so round-trips, not the network, decide how much a 300-second
 * cron gets through.
 */
async function bulkUpsert(users: ScUser[], source: string): Promise<{ inserted: number; withEmail: number }> {
  const rows = users.filter((u) => u.id && u.permalink && u.track_count >= 1);
  if (rows.length === 0) return { inserted: 0, withEmail: 0 };
  const emails = rows.map((u) => pickBestEmail(u.description ?? "") || null);

  const res = await pool.query(
    `INSERT INTO sc_artists (soundcloud_id, permalink, permalink_url, username, full_name, city, country_code,
        description, avatar_url, track_count, followers_count, followings_count,
        email, email_source, tier, is_active, source_seed, email_found_at, created_at, updated_at)
     SELECT t.*, now(), now() FROM UNNEST(
        $1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[],
        $8::text[], $9::text[], $10::int[], $11::int[], $12::int[],
        $13::text[], $14::text[], $15::text[], $16::bool[], $17::text[], $18::timestamptz[]
     ) AS t(soundcloud_id, permalink, permalink_url, username, full_name, city, country_code,
        description, avatar_url, track_count, followers_count, followings_count,
        email, email_source, tier, is_active, source_seed, email_found_at)
     ON CONFLICT (soundcloud_id) DO UPDATE SET
        track_count = EXCLUDED.track_count,
        followers_count = EXCLUDED.followers_count,
        followings_count = EXCLUDED.followings_count,
        description = COALESCE(EXCLUDED.description, sc_artists.description),
        email = COALESCE(sc_artists.email, EXCLUDED.email),
        email_source = COALESCE(sc_artists.email_source, EXCLUDED.email_source),
        email_found_at = CASE WHEN sc_artists.email IS NULL AND EXCLUDED.email IS NOT NULL
                              THEN now() ELSE sc_artists.email_found_at END,
        tier = EXCLUDED.tier, updated_at = now()`,
    [
      rows.map((u) => u.id),
      rows.map((u) => u.permalink),
      rows.map((u) => u.permalink_url ?? `https://soundcloud.com/${u.permalink}`),
      rows.map((u) => u.username ?? u.permalink),
      rows.map((u) => u.full_name || null),
      rows.map((u) => u.city || null),
      rows.map((u) => u.country_code || null),
      rows.map((u) => (u.description ?? "").slice(0, 4000) || null),
      rows.map((u) => u.avatar_url || null),
      rows.map((u) => u.track_count ?? 0),
      rows.map((u) => u.followers_count ?? 0),
      rows.map((u) => u.followings_count ?? 0),
      emails,
      emails.map((e) => (e ? "bio" : null)),
      rows.map((u) => tierFor(u)),
      rows.map(() => true),
      rows.map(() => source),
      emails.map((e) => (e ? new Date() : null)),
    ]
  );
  return { inserted: res.rowCount ?? 0, withEmail: emails.filter(Boolean).length };
}

/** Everyone a given user follows, across pages. */
async function followingsOf(userId: string, clientId: string, maxPages = 3): Promise<ScUser[]> {
  const out: ScUser[] = [];
  let path: string | null = `/users/${userId}/followings?limit=200`;
  for (let p = 0; p < maxPages && path; p++) {
    const j: { collection?: ScUser[]; next_href?: string | null } | null = await api(path, clientId);
    if (!j?.collection?.length) break;
    out.push(...j.collection);
    path = j.next_href
      ? j.next_href.replace("https://api-v2.soundcloud.com", "").replace(/[?&]client_id=[^&]*/, "")
      : null;
    if (path && !path.includes("?")) path = null; // malformed continuation, stop cleanly
  }
  return out;
}

/**
 * Expand the frontier: take the most promising producers we have not walked yet
 * and pull everyone they follow.
 *
 * `budgetMs` keeps a run inside its cron window — it stops between users rather
 * than being killed mid-write.
 */
export async function crawlFollowings(
  opts: { users?: number; budgetMs?: number } = {}
): Promise<{ expanded: number; discovered: number; withEmail: number; exhausted: boolean }> {
  const clientId = await getClientId();
  if (!clientId) return { expanded: 0, discovered: 0, withEmail: 0, exhausted: false };
  const want = opts.users ?? 40;
  const deadline = Date.now() + (opts.budgetMs ?? 240_000);

  // Best first: someone who publishes a lot and already gave us an address is
  // embedded in the professional graph, and follows more of the same.
  const frontier = await pool
    .query<{ soundcloud_id: string }>(
      `SELECT soundcloud_id FROM sc_artists
        WHERE followings_crawled_at IS NULL AND track_count >= $2
        ORDER BY (email IS NOT NULL) DESC, track_count DESC
        LIMIT $1`,
      [want, PRODUCER_MIN_TRACKS]
    )
    .then((r) => r.rows)
    .catch(() => []);

  let expanded = 0, discovered = 0, withEmail = 0;
  for (const { soundcloud_id } of frontier) {
    if (Date.now() > deadline) break;
    const users = await followingsOf(soundcloud_id, clientId);
    if (users.length > 0) {
      const r = await bulkUpsert(users, `graph:${soundcloud_id}`);
      discovered += r.inserted;
      withEmail += r.withEmail;
    }
    await pool
      .query(`UPDATE sc_artists SET followings_crawled_at = now() WHERE soundcloud_id = $1`, [soundcloud_id])
      .catch(() => {});
    expanded++;
  }

  return { expanded, discovered, withEmail, exhausted: frontier.length === 0 };
}

/**
 * Top up the frontier from people uploading RIGHT NOW, so the graph keeps
 * meeting artists who are active rather than drifting into whoever was big
 * years ago. Search caps at 300 results per query, which is why this seeds the
 * crawl instead of being the crawl.
 */
export async function seedFromRecentUploads(
  genres: string[],
  window: "last_day" | "last_week" = "last_day"
): Promise<{ discovered: number; withEmail: number }> {
  const clientId = await getClientId();
  if (!clientId) return { discovered: 0, withEmail: 0 };
  let discovered = 0, withEmail = 0;
  for (const g of genres) {
    let path: string | null = `/search/tracks?q=${encodeURIComponent(g)}&filter.created_at=${window}&limit=50&offset=0`;
    const users = new Map<number, ScUser>();
    for (let p = 0; p < 6 && path; p++) {
      const j: { collection?: { user?: ScUser }[]; next_href?: string | null } | null = await api(path, clientId);
      if (!j?.collection?.length) break;
      for (const t of j.collection) if (t.user?.id && !users.has(t.user.id)) users.set(t.user.id, t.user);
      path = j.next_href
        ? j.next_href.replace("https://api-v2.soundcloud.com", "").replace(/[?&]client_id=[^&]*/, "")
        : null;
    }
    if (users.size > 0) {
      const r = await bulkUpsert([...users.values()], `upload:${g}`);
      discovered += r.inserted;
      withEmail += r.withEmail;
    }
  }
  return { discovered, withEmail };
}
