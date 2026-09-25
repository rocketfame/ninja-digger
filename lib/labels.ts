/**
 * Record-label database pipeline. Runs from /api/cron/labels, fully automatic:
 *
 *   1. ingest   — (a) every label that charted on Beatport (BPTT top-100, all
 *                 genres, last 31 days); (b) label accounts already sitting in
 *                 our own lead base (SoundCloud, YouTube, Instagram) found by
 *                 name/bio triggers → label_db, merged by normalized name.
 *   2. resolve  — find the label's own SoundCloud profile (search + strict name
 *                 match), take its bio, country and web-profiles (site, IG, FB,
 *                 Bandcamp…); apply the country policy (lib/labelCountries).
 *   3. crawl    — the label's website: home + contact/demo/about pages → every
 *                 published address with its role, and how the label takes demos.
 *   4. filter   — each address through the same layers as leads: classifyEmail
 *                 (junk/placeholder/relay/hostile/role rules), live MX, our
 *                 blacklist and bounce/complaint history. Survivors wait as
 *                 'pending' for the SMTP pass (scripts/verify-labels.mjs, local:
 *                 port 25 is closed on Vercel).
 *   5. grade    — A: SMTP-valid address + active label; B: deliverable domain,
 *                 mailbox not provable; C: no address but a demo form or socials.
 */
import { pool } from "@/lib/db";
import { classifyEmail, EMAIL_SCAN_RE, isFreemailDomain } from "@/lib/emailJunk";
import { domainAcceptsMail } from "@/lib/emailHygiene";
import { getClientId } from "@/lib/soundcloud";
import { countryVerdict, countryFromDomain } from "@/lib/labelCountries";
import { genreGroups } from "@/lib/labelGenres";
import { getSettingOrNull, setSetting } from "@/lib/settings";
import { findLabel, countryFromAddress, discogsEnabled } from "@/lib/discogs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// ── names ──────────────────────────────────────────────────────────────────

const STOP_WORDS = /\b(records?|recordings?|recs|music|musik|musique|label|audio|digital|ltd|inc|llc|limited|gmbh|group|entertainment|the)\b/g;

/** "Toolroom Records (UK)" and "TOOLROOM" land on the same key. */
export function normLabel(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .replace(STOP_WORDS, " ")
    .replace(/[^a-z0-9а-яіїєґ]+/g, "")
    .trim();
}

// Majors, their sub-brands in BPTT notation "(Sony)" and distributors are not
// labels anyone pitches demos to; they stay in the table as excluded.
const MAJOR_RE = /\((sony|warner|universal|umg|bmg)\)|^(columbia|atlantic|warner|universal|interscope|capitol|republic|rca|epic|island|def jam|polydor|virgin|parlophone|emi|create music group|sony music|ultra records|spinnin'? records|armada music|distrokid|tunecore|cd ?baby|ditto|amuse|unitedmasters|believe|the orchard|onerpm|symphonic|routenote|landr|awal|fuga|label ?worx|labelradar|trackstack)\b|self[- ]?released|not on label|independent$/i;

// ── 1. ingest from charts ──────────────────────────────────────────────────

export async function ingestFromCharts(): Promise<{ labels: number; inserted: number }> {
  const { rows } = await pool.query<{ label_name: string; genres: string[]; entries: number; tracks: number; best: number; last: string }>(
    `SELECT label_name, ARRAY_AGG(DISTINCT genre_slug) genres, COUNT(*)::int entries,
            COUNT(DISTINCT LOWER(COALESCE(track_title,'')) || '|' || LOWER(artist_name))::int tracks,
            MIN(position)::int best, MAX(snapshot_date)::text last
       FROM bptoptracker_daily
      WHERE snapshot_date > CURRENT_DATE - 31 AND COALESCE(TRIM(label_name),'') <> ''
      GROUP BY label_name`
  );
  type Agg = { name: string; genres: Set<string>; entries: number; tracks: number; best: number; last: string };
  const byKey = new Map<string, Agg>();
  for (const r of rows) {
    const key = normLabel(r.label_name);
    if (key.length < 2) continue;
    const a = byKey.get(key);
    if (!a) { byKey.set(key, { name: r.label_name.trim(), genres: new Set(r.genres), entries: r.entries, tracks: r.tracks, best: r.best, last: r.last }); continue; }
    r.genres.forEach((g) => a.genres.add(g));
    if (r.entries > a.entries) a.name = r.label_name.trim(); // most-used spelling wins
    a.entries += r.entries; a.tracks += r.tracks;
    a.best = Math.min(a.best, r.best);
    if (r.last > a.last) a.last = r.last;
  }
  // One statement per 500 labels: a round trip per label took >5 minutes.
  const all = [...byKey].map(([key, a]) => {
    const major = MAJOR_RE.test(a.name);
    return { name: a.name, key, genres: [...a.genres], groups: genreGroups([...a.genres]), entries: a.entries, tracks: a.tracks,
      best: a.best, last: a.last, status: major ? "excluded" : "new", reason: major ? "major / distributor" : null };
  });
  let inserted = 0;
  for (let i = 0; i < all.length; i += 500) {
    const res = await pool.query(
      `INSERT INTO label_db (name, norm_name, genres, genre_groups, chart_entries, chart_tracks, best_position, last_charted, status, exclude_reason)
       SELECT x.name, x.key, ARRAY(SELECT jsonb_array_elements_text(x.genres)), ARRAY(SELECT jsonb_array_elements_text(x.groups)),
              x.entries, x.tracks, x.best, x.last::date, x.status, x.reason
         FROM jsonb_to_recordset($1::jsonb) AS x(name text, key text, genres jsonb, groups jsonb, entries int, tracks int, best int, last text, status text, reason text)
       ON CONFLICT (norm_name) DO UPDATE SET
         genres = (SELECT ARRAY(SELECT DISTINCT UNNEST(label_db.genres || EXCLUDED.genres))),
         genre_groups = (SELECT ARRAY(SELECT DISTINCT UNNEST(label_db.genre_groups || EXCLUDED.genre_groups))),
         chart_entries = EXCLUDED.chart_entries, chart_tracks = EXCLUDED.chart_tracks,
         best_position = EXCLUDED.best_position, last_charted = EXCLUDED.last_charted, updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [JSON.stringify(all.slice(i, i + 500))]
    );
    inserted += res.rows.filter((r) => r.inserted).length;
  }
  return { labels: byKey.size, inserted };
}

// ── 1b. ingest label accounts already in our own lead base ─────────────────

// A label word in the name is a strong signal on its own — but not inside
// brackets: "Mechanical Species (Forestdelic Records)" is an artist naming
// their label. A bio only counts when it is the account describing ITSELF as
// a label; "A&R at Monstercat" or "Record Label Owner" are artists (measured
// on a 40-row sample, 25.09).
const NAME_TRIGGER = `'\\m(records?|recordings?|recordz|label|imprint|music group)\\M'`;
const nameHit = (col: string) => `REGEXP_REPLACE(${col}, '\\([^)]*\\)|\\[[^]]*\\]', '', 'g') ~* ${NAME_TRIGGER}`;
const DESC_TRIGGER = `'(\\m(is|are) an? ([a-z-]+ ){0,3}(record )?label\\M|\\mlabel (based|founded|created|run|owned) |send (us )?(your )?demos|\\mdemos? (to|:)|demo submissions?|label (enquiries|inquiries))'`;
const SC_CHUNK = 150_000;

type Candidate = { name: string; via: string; sc_id?: string | null; email?: string | null; source_url?: string | null; website?: string | null };

/** Bulk upsert; an existing label keeps its data and only gains what it lacked. */
async function insertCandidates(cands: Candidate[]): Promise<number> {
  const seen = new Set<string>();
  const rows = cands.flatMap((c) => {
    const key = normLabel(c.name);
    if (key.length < 3 || MAJOR_RE.test(c.name) || seen.has(key)) return [];
    seen.add(key);
    return [{ name: c.name.trim().slice(0, 200), key, via: c.via, sc_id: c.sc_id ?? null, email: c.email?.toLowerCase() ?? null, src: c.source_url ?? null, website: c.website ?? null }];
  });
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const res = await pool.query(
      `INSERT INTO label_db (name, norm_name, discovered_via, sc_id, seed_email, seed_email_src, website)
       SELECT x.name, x.key, x.via, x.sc_id::bigint, x.email, x.src, x.website
         FROM jsonb_to_recordset($1::jsonb) AS x(name text, key text, via text, sc_id text, email text, src text, website text)
       ON CONFLICT (norm_name) DO UPDATE SET
         website = COALESCE(label_db.website, EXCLUDED.website),
         sc_id = COALESCE(label_db.sc_id, EXCLUDED.sc_id),
         seed_email = COALESCE(label_db.seed_email, EXCLUDED.seed_email),
         seed_email_src = COALESCE(label_db.seed_email_src, EXCLUDED.seed_email_src)
       RETURNING (xmax = 0) AS inserted`,
      [JSON.stringify(rows.slice(i, i + 500))]
    );
    inserted += res.rows.filter((r) => r.inserted).length;
  }
  return inserted;
}

/**
 * Walk sc_artists in soundcloud_id chunks (a cursor in app_settings, one chunk
 * per run so a 2.4M-row table never blocks the cron) plus the small YouTube and
 * Instagram lead tables once a day.
 */
export async function ingestFromOwnBase(): Promise<{ found: number; inserted: number; wrapped: boolean }> {
  // After a full pass, wait a day before the next one: only new profiles are
  // left to find, and a lap is ~16 chunks of re-reading 2.4M rows.
  const wrappedAt = await getSettingOrNull("labels_sc_wrapped_at");
  const resting = !!wrappedAt && Date.now() - Date.parse(wrappedAt) < 24 * 3600e3;
  let found = 0, inserted = 0, wrapped = false;
  if (!resting) {
    const from = (await getSettingOrNull("labels_sc_cursor")) || "0";
    const { rows } = await pool.query<{ soundcloud_id: string; username: string; permalink_url: string; email: string | null; max_id: string }>(
      `WITH chunk AS (SELECT * FROM sc_artists WHERE soundcloud_id > $1::bigint ORDER BY soundcloud_id LIMIT ${SC_CHUNK})
       SELECT c.soundcloud_id::text, c.username, c.permalink_url, c.email, (SELECT MAX(soundcloud_id) FROM chunk)::text max_id
         FROM chunk c
        WHERE c.track_count > 0 AND c.followers_count >= 100
          AND (${nameHit("c.username")} OR COALESCE(c.description,'') ~* ${DESC_TRIGGER})`,
      [from]
    );
    inserted += await insertCandidates(rows.map((r) => ({ name: r.username, via: "our_base_sc", sc_id: r.soundcloud_id, email: r.email, source_url: r.permalink_url })));
    const maxId = rows[0]?.max_id ?? (await pool.query<{ m: string | null }>(
      `SELECT MAX(soundcloud_id)::text m FROM (SELECT soundcloud_id FROM sc_artists WHERE soundcloud_id > $1::bigint ORDER BY soundcloud_id LIMIT ${SC_CHUNK}) x`, [from]
    )).rows[0]?.m;
    wrapped = !maxId; // reached the end: start over after a day, new profiles arrive daily
    await setSetting("labels_sc_cursor", wrapped ? "0" : maxId!);
    if (wrapped) await setSetting("labels_sc_wrapped_at", new Date().toISOString());
    found = rows.length;
  }

  // YouTube radar + Instagram (Spotify) leads: small tables, once a day.
  const today = new Date().toISOString().slice(0, 10);
  if ((await getSettingOrNull("labels_small_day")) !== today) {
    const small = await pool.query<{ name: string; email: string | null; url: string | null; via: string }>(
      `SELECT COALESCE(NULLIF(name,''), handle) name, email, source_url url, 'our_base_yt' via FROM radar_leads
        WHERE ${nameHit("COALESCE(name, handle)")}
       UNION ALL
       SELECT COALESCE(NULLIF(full_name,''), ig_username), email, 'https://instagram.com/' || ig_username, 'our_base_ig' FROM spotify_leads
        WHERE ${nameHit("COALESCE(full_name, ig_username)")} OR COALESCE(bio,'') ~* ${DESC_TRIGGER}`
    );
    inserted += await insertCandidates(small.rows.filter((r) => r.name));
    found += small.rows.length;
    await setSetting("labels_small_day", today);
  }
  return { found, inserted, wrapped };
}

// ── 1c. the not-ICP blacklist: labels the artist barrels skipped ───────────

/**
 * email_blacklist holds ~11.8k "not-ICP" addresses: profiles skipped as "not an
 * artist" or "star", and addresses on a domain shared by 3+ artists
 * (representation). The first two are SoundCloud profiles — kept when the name
 * or bio says label (podcasts, repost channels and blogs also land there and
 * are dropped here). A shared domain is a label or an agency: it enters with
 * its site, and the crawl tells which (kind).
 */
export async function ingestFromBlacklist(): Promise<{ profiles: number; domains: number; inserted: number }> {
  const prof = await pool.query<{ soundcloud_id: string; username: string; permalink_url: string; email: string }>(
    `SELECT DISTINCT ON (s.soundcloud_id) s.soundcloud_id::text, s.username, s.permalink_url, LOWER(b.email) email
       FROM email_blacklist b JOIN sc_artists s ON LOWER(s.email) = LOWER(b.email)
      WHERE (b.reason LIKE 'not-ICP: not an artist%' OR b.reason LIKE 'not-ICP: star%')
        AND (${nameHit("s.username")} OR COALESCE(s.description,'') ~* ${DESC_TRIGGER})`
  );
  const dom = await pool.query<{ domain: string; email: string }>(
    `SELECT DISTINCT ON (d) d domain, email FROM (
       SELECT LOWER(SPLIT_PART(email,'@',2)) d, LOWER(email) email FROM email_blacklist
        WHERE reason LIKE 'not-ICP: representation domain%') x ORDER BY d, email`
  );
  // A shared freemail/ISP domain (gmail, 163.com, qq.com…) is not a company.
  const EXTRA_FREEMAIL = /^(163|126|qq|sina|sohu|yeah|foxmail|naver|daum|hanmail|rediffmail|seznam|wp|o2|interia|libero|virgilio|orange|free|laposte|sfr|t-online|gmx|web|freenet|bluewin|telenet|skynet|shaw|rogers|sympatico|bigpond|optusnet|comcast|verizon|att|sbcglobal|cox|charter|earthlink|btinternet|sky|virginmedia|talktalk|ntlworld|ziggo|kpnmail|planet|home|hotmail|outlook|live|msn|yahoo|ymail|aol|icloud|me|mac|protonmail|proton|gmail|googlemail)\./i;
  const domRows = dom.rows.filter((r) => !isFreemailDomain(r.domain) && !EXTRA_FREEMAIL.test(r.domain));
  const cands: Candidate[] = [
    ...prof.rows.map((r) => ({ name: r.username, via: "our_blacklist", sc_id: r.soundcloud_id, email: r.email, source_url: r.permalink_url })),
    ...domRows.map((r) => ({ name: r.domain.split(".").slice(0, -1).join(" ").replace(/[-_]/g, " "), via: "our_blacklist_domain",
      email: r.email, source_url: `https://${r.domain}`, website: `https://${r.domain}` })),
  ];
  return { profiles: prof.rows.length, domains: domRows.length, inserted: await insertCandidates(cands) };
}

// ── helpers ────────────────────────────────────────────────────────────────

async function fetchText(url: string, ms = 10_000): Promise<{ html: string; url: string } | null> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/json" }, redirect: "follow", signal: c.signal });
    if (!r.ok) return null;
    const type = r.headers.get("content-type") ?? "";
    if (!/html|json|text/.test(type)) return null;
    return { html: (await r.text()).slice(0, 400_000), url: r.url };
  } catch { return null; } finally { clearTimeout(t); }
}

async function scApi<T>(path: string, cid: string): Promise<T | null> {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetchText(`https://api-v2.soundcloud.com${path}${sep}client_id=${cid}`);
  if (!r) return null;
  try { return JSON.parse(r.html) as T; } catch { return null; }
}

const ROLE_OF: [RegExp, string][] = [
  [/^(demos?|submissions?|submit|a-?and-?r|anr|a\.r|music)$/, "demo"],
  [/^(promos?|promotion|radio)$/, "promo"],
  [/^(press|media|pr)$/, "press"],
  [/^(booking|bookings|book|agency)$/, "booking"],
  [/^(info|contact|contacts|hello|hi|office|mail|label|records|general|team|inquiries|enquiries)$/, "info"],
];
function roleOf(email: string): string {
  const local = email.split("@")[0].toLowerCase();
  for (const [re, role] of ROLE_OF) if (re.test(local)) return role;
  return "general";
}

/** Run one address through every filter layer; returns the verdict to store. */
async function filterEmail(raw: string): Promise<{ email: string; verdict: "pending" | "invalid"; reason: string | null } | null> {
  const v = classifyEmail(raw);
  if (!v.email) return null;
  if (!v.ok) return { email: v.email, verdict: "invalid", reason: v.reason };
  if (!(await domainAcceptsMail(v.email.split("@")[1]))) return { email: v.email, verdict: "invalid", reason: "domain accepts no mail (MX)" };
  // Deliverability history only. "not-ICP" entries (not an artist, agency
  // domain, star) exist because the artist barrels skip LABELS — for this
  // database they are the target, not a defect.
  const hist = await pool.query(
    `SELECT 1 FROM email_blacklist WHERE LOWER(email) = $1 AND COALESCE(reason,'') NOT LIKE 'not-ICP%'
     UNION ALL SELECT 1 FROM email_events WHERE email = $1 AND event IN ('hard_bounce','hardbounces','spam','unsubscribed','blocked') LIMIT 1`,
    [v.email]
  );
  if (hist.rowCount) return { email: v.email, verdict: "invalid", reason: "blacklist / bounce / complaint history" };
  return { email: v.email, verdict: "pending", reason: null };
}

async function saveEmails(labelId: number, found: Map<string, string>): Promise<number> {
  let n = 0;
  for (const [raw, sourceUrl] of found) {
    const f = await filterEmail(raw);
    if (!f) continue;
    await pool.query(
      `INSERT INTO label_db_emails (label_id, email, role, source_url, verdict, reject_reason)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (label_id, email) DO NOTHING`,
      [labelId, f.email, roleOf(f.email), sourceUrl, f.verdict, f.reason]
    );
    if (f.verdict === "pending") n++;
  }
  return n;
}

function emailsIn(html: string): string[] {
  // JSON-escaped page data glues "\ncontact@x" into "ncontact@x": unescape first.
  const text = html.replace(/\\[ntr]|\\u00[0-9a-f]{2}/gi, " ")
    .replace(/&#64;|&commat;|\s?\[at\]\s?|\s?\(at\)\s?/gi, "@").replace(/&#46;|\s?\[dot\]\s?/gi, ".");
  const mailto = [...text.matchAll(/mailto:([^"'?\s<>]+)/gi)].map((m) => decodeURIComponent(m[1]));
  return [...new Set([...mailto, ...(text.match(EMAIL_SCAN_RE) ?? [])].map((e) => e.toLowerCase()))];
}

// ── 2. resolve SoundCloud profile ──────────────────────────────────────────

type ScUser = { id: number; permalink: string; permalink_url: string; username: string; full_name?: string; description: string | null;
  followers_count: number; track_count: number; verified: boolean; country_code: string | null; city: string | null; last_modified: string | null };

/** A link that is the label's own website (not a social, store, portal or catalog). */
function isSite(url: string): boolean {
  return /^https?:\/\//i.test(url) && !FORM_HOST_RE.test(url)
    && !/soundcloud|instagram|facebook|twitter|x\.com\/|youtube|youtu\.be|bandcamp|tiktok|spotify|beatport|linktr|lnk\.to|tstack\.app|discogs|apple\.com|deezer|mixcloud|residentadvisor|ra\.co\/|store\.|shop\./i.test(url);
}

const LABELISH_RE = /\b(label|records|recordings|imprint|demos?|releases|catalog(ue)?|a&r)\b/i;

function pickLabelProfile(name: string, key: string, users: ScUser[]): ScUser | null {
  let best: { u: ScUser; score: number } | null = null;
  for (const u of users) {
    const nameKey = normLabel(u.username), permKey = normLabel(u.permalink.replace(/-/g, " "));
    const exact = nameKey === key || permKey === key;
    const prefix = !exact && key.length >= 4 && (nameKey.startsWith(key) || permKey.startsWith(key));
    if (!exact && !prefix) continue;
    const labelish = LABELISH_RE.test(u.description ?? "") || LABELISH_RE.test(u.username);
    // Short or prefix-only names collide with artists — demand a label signal.
    if ((key.length < 4 || prefix) && !labelish) continue;
    const score = (exact ? 50 : 20) + (labelish ? 25 : 0) + (u.verified ? 10 : 0) + Math.min(15, Math.log10(u.followers_count + 1) * 3) + (u.track_count > 0 ? 5 : -30);
    if (!best || score > best.score) best = { u, score };
  }
  return best && best.score >= 45 ? best.u : null;
}

export async function resolveBatch(limit = 25, via?: string): Promise<{ checked: number; matched: number; excluded: number }> {
  const cid = await getClientId();
  if (!cid) return { checked: 0, matched: 0, excluded: 0 };
  // Chart labels first (proven active), then candidates from our own base.
  const { rows } = await pool.query<{ id: number; name: string; norm_name: string; chart_entries: number; sc_id: string | null; genres: string[]; seed_email: string | null; seed_email_src: string | null; website: string | null }>(
    `SELECT id, name, norm_name, chart_entries, sc_id::text, genres, seed_email, seed_email_src, website FROM label_db WHERE status = 'new' AND ($2::text IS NULL OR discovered_via = $2)
      ORDER BY chart_entries DESC, id LIMIT $1`, [limit, via ?? null]
  );
  let matched = 0, excluded = 0;
  const queue = [...rows];
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let l = queue.shift(); l; l = queue.shift()) {
      if (MAJOR_RE.test(l.name)) {
        await pool.query(`UPDATE label_db SET status='excluded', exclude_reason='major / distributor', resolved_at=now(), updated_at=now() WHERE id=$1`, [l.id]);
        excluded++;
        continue;
      }
      let u: ScUser | null;
      if (l.sc_id) {
        // Found in our own base: the profile is known, no search needed.
        u = await scApi<ScUser>(`/users/${l.sc_id}`, cid);
      } else {
        const q = l.name.replace(/\([^)]*\)/g, "").trim();
        const res = await scApi<{ collection: ScUser[] }>(`/search/users?q=${encodeURIComponent(q)}&limit=10`, cid);
        u = res ? pickLabelProfile(l.name, l.norm_name, res.collection ?? []) : null;
      }
      if (!u && l.website) {
        // No SoundCloud profile, but we know the site (a shared domain from the
        // blacklist): go on with the site alone, country from its domain.
        const v = countryVerdict({ country_code: countryFromDomain(l.website), website: l.website, chart_entries: l.chart_entries });
        await pool.query(
          `UPDATE label_db SET status=$2, exclude_reason=$3, country_code=$4, country_tier=$5, resolved_at=now(), updated_at=now() WHERE id=$1`,
          [l.id, v.ok ? "resolved" : "excluded", v.ok ? null : v.reason, v.ok ? v.country : null, v.ok ? v.tier : null]
        );
        if (!v.ok) { excluded++; continue; }
        matched++;
        if (l.seed_email) await saveEmails(l.id, new Map([[l.seed_email, l.seed_email_src ?? l.website]]));
        continue;
      }
      if (!u) {
        await pool.query(`UPDATE label_db SET status='no_match', resolved_at=now(), updated_at=now() WHERE id=$1`, [l.id]);
        continue;
      }
      const profiles = (await scApi<{ url: string; network: string }[]>(`/users/soundcloud:users:${u.id}/web-profiles`, cid)) ?? [];
      const net = (n: string) => profiles.find((p) => p.network === n)?.url ?? null;
      // Demo portals and catalog sites are not the label's website.
      const demoPortal = profiles.find((p) => FORM_HOST_RE.test(p.url) || /tstack\.app/i.test(p.url))?.url ?? null;
      // The profile's "personal" link first, then any other site link, then a URL in the bio.
      const bioUrls = (u.description ?? "").match(/https?:\/\/[^\s"'<>)]+/gi) ?? [];
      const website = [net("personal"), ...profiles.map((p) => p.url), ...bioUrls].find((url) => !!url && isSite(url)) ?? null;
      const profileEmails = profiles.map((p) => p.url.replace(/^mailto:/i, "")).filter((u) => /^[^\s/@]+@[^\s/@]+\.[a-z]{2,}$/i.test(u));
      const beatport = profiles.find((p) => /beatport\.com\/label/i.test(p.url))?.url ?? null;
      const verdict = countryVerdict({ country_code: u.country_code || countryFromDomain(website), description: u.description, website, sc_followers: u.followers_count, chart_entries: l.chart_entries });
      await pool.query(
        `UPDATE label_db SET sc_id=$2, sc_permalink=$3, sc_followers=$4, sc_tracks=$5, sc_verified=$6, sc_last_active=$7,
           description=$8, country_code=$9, country_tier=$10, city=$11, website=$12, instagram=$13, facebook=$14, bandcamp=$15,
           youtube=$16, twitter=$17, beatport_url=COALESCE($18, beatport_url),
           status=$19, exclude_reason=$20, resolved_at=now(), updated_at=now()
         WHERE id=$1`,
        [l.id, u.id, u.permalink, u.followers_count, u.track_count, u.verified, u.last_modified, (u.description ?? "").slice(0, 2000),
         verdict.ok ? verdict.country : (u.country_code || null), verdict.ok ? verdict.tier : null, u.city || null, website,
         net("instagram"), net("facebook"), net("bandcamp"), net("youtube"), net("twitter"), beatport,
         verdict.ok ? "resolved" : "excluded", verdict.ok ? null : verdict.reason]
      );
      if (!verdict.ok) { excluded++; continue; }
      matched++;
      // Labels from our base have no chart genres: take them from their tracks.
      if (!l.genres?.length) {
        const tracks = await scApi<{ collection: { genre: string | null }[] }>(`/users/${u.id}/tracks?limit=30`, cid);
        const tags = [...new Set((tracks?.collection ?? []).map((t) => (t.genre ?? "").trim()).filter(Boolean))].slice(0, 8);
        if (tags.length) await pool.query(`UPDATE label_db SET genres=$2, genre_groups=$3 WHERE id=$1`, [l.id, tags, genreGroups(tags)]);
      }
      const bio = new Map(emailsIn(u.description ?? "").map((e) => [e, u.permalink_url] as [string, string]));
      if (l.seed_email && !bio.has(l.seed_email)) bio.set(l.seed_email, l.seed_email_src ?? u.permalink_url);
      for (const e of profileEmails) if (!bio.has(e.toLowerCase())) bio.set(e.toLowerCase(), u.permalink_url);
      if (demoPortal) await pool.query(`UPDATE label_db SET demo_policy='form', demo_url=$2 WHERE id=$1 AND demo_url IS NULL`, [l.id, demoPortal]);
      if (bio.size) await saveEmails(l.id, bio);
    }
  }));
  return { checked: rows.length, matched, excluded };
}

// ── 3. crawl the label's website ───────────────────────────────────────────

const SUBPAGE_RE = /(contact|demo|submi|about|a-?and-?r|anr|info|impressum|imprint)/i;
const FORM_HOST_RE = /(labelradar\.com|trackstack\.app|forms\.gle|docs\.google\.com\/forms|typeform\.com|jotform\.com|dropbox\.com\/request|demodrop\.com|wetransfer\.com|airtable\.com)/i;
const CLOSED_RE = /(not (currently )?accepting (any )?demos|no (unsolicited )?demos|we do not accept (any )?demos|demo submissions? (are )?closed)/i;

function sameHostLinks(html: string, base: string): string[] {
  let origin: URL;
  try { origin = new URL(base); } catch { return []; }
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    const [, href, text] = m;
    if (!SUBPAGE_RE.test(href) && !SUBPAGE_RE.test(text)) continue;
    try {
      const u = new URL(href, origin);
      if (u.hostname.replace(/^www\./, "") === origin.hostname.replace(/^www\./, "")) out.add(u.toString());
    } catch { /* skip */ }
  }
  return [...out].slice(0, 5);
}

const AGENCY_RE = /\b(booking agency|talent agency|artist management|management company|booking & management|booking and management|our roster|represent(s|ing)? (the )?artists|agency roster|tour(ing)? agency)\b/gi;
const AGENCY_HOST_RE = /(mgmt|management|booking|talent|agency|artists)\./i;
const LABEL_TEXT_RE = /\b(record label|releases?|catalog(ue)?|out now|pre-?order|demos?|vinyl|ep|lp|beatport)\b/gi;

export async function crawlBatch(limit = 20, via?: string): Promise<{ crawled: number; withEmail: number }> {
  const { rows } = await pool.query<{ id: number; name: string; website: string; discovered_via: string; description: string | null }>(
    `SELECT id, name, website, discovered_via, description FROM label_db WHERE status='resolved' AND crawled_at IS NULL AND website IS NOT NULL AND ($2::text IS NULL OR discovered_via = $2)
      ORDER BY chart_entries DESC LIMIT $1`, [limit, via ?? null]
  );
  let withEmail = 0;
  const queue = [...rows];
  await Promise.all(Array.from({ length: 5 }, async () => {
    for (let l = queue.shift(); l; l = queue.shift()) {
      const found = new Map<string, string>();
      let demoPolicy: string | null = null, demoUrl: string | null = null;
      // Crawl the domain root: profile links often point deep (a release page, /radio).
      let root = l.website.startsWith("http") ? l.website : `https://${l.website}`;
      try { root = new URL(root).origin + "/"; } catch { /* keep as is */ }
      const home = (await fetchText(root)) ?? (root !== l.website ? await fetchText(l.website) : null);
      let sub = home ? sameHostLinks(home.html, home.url) : [];
      // JS-built menus hide their links from plain HTML: try the usual paths.
      if (home && sub.length === 0) sub = ["contact", "demos", "demo"].map((p) => new URL(p, home.url).toString());
      const pages = home ? [home, ...(await Promise.all(sub.map((u) => fetchText(u)))).filter(Boolean) as { html: string; url: string }[]] : [];
      for (const p of pages) {
        for (const e of emailsIn(p.html)) if (!found.has(e)) found.set(e, p.url);
        const isDemoPage = /demo|submi|a-?and-?r/i.test(p.url);
        if (CLOSED_RE.test(p.html)) demoPolicy ??= "closed";
        const form = p.html.match(new RegExp(`https?://[^"'\\s<>]*${FORM_HOST_RE.source}[^"'\\s<>]*`, "i"));
        if (form && !demoUrl) { demoUrl = form[0]; demoPolicy = "form"; }
        else if (isDemoPage && /<form[\s>]/i.test(p.html) && !demoUrl) { demoUrl = p.url; demoPolicy = "form"; }
      }
      // Label or agency? Shared domains from the blacklist are often booking /
      // management agencies. A label talks about releases and demos.
      const text = [l.description ?? "", ...pages.map((p) => p.html.replace(/<[^>]+>/g, " "))].join(" ").slice(0, 300_000);
      const hasDemoInbox = [...found.keys()].some((e) => /^(demos?|submit|submissions?|records|label|a-?and-?r)@/i.test(e));
      const agencyHits = (text.match(AGENCY_RE) ?? []).length + (AGENCY_HOST_RE.test(l.website) ? 3 : 0);
      const labelHits = (text.match(LABEL_TEXT_RE) ?? []).length;
      // A domain taken from the blacklist has no label evidence yet (events,
      // management and PR firms share artist domains too): it must show some.
      const kind = agencyHits >= 2 && agencyHits > labelHits ? "agency"
        : l.discovered_via === "our_blacklist_domain" && labelHits < 3 && !hasDemoInbox && !/record|label|music|audio|sound|imprint/i.test(`${l.website} ${l.name}`) ? "other"
        : "label";
      await pool.query(`UPDATE label_db SET kind=$2 WHERE id=$1`, [l.id, kind]);
      const saved = await saveEmails(l.id, found);
      if (saved > 0) withEmail++;
      const hasDemoEmail = (await pool.query(`SELECT 1 FROM label_db_emails WHERE label_id=$1 AND role='demo' AND verdict<>'invalid' LIMIT 1`, [l.id])).rowCount;
      if (hasDemoEmail && demoPolicy !== "form") demoPolicy = demoPolicy === "closed" ? "closed" : "email";
      await pool.query(
        `UPDATE label_db SET crawled_at=now(), demo_policy=COALESCE($2, demo_policy, 'unknown'), demo_url=COALESCE($3, demo_url),
           website = CASE WHEN $4::boolean THEN website ELSE NULL END, updated_at=now() WHERE id=$1`,
        [l.id, demoPolicy, demoUrl, !!home]
      );
    }
  }));
  // Resolved labels without a website are done too — their bio was read in resolve.
  // A shared domain with no reachable site is a label only if its SC bio or a
  // demo/label inbox says so; otherwise it stays out of the label list.
  await pool.query(
    `UPDATE label_db l SET crawled_at=now(), demo_policy=COALESCE(demo_policy,'unknown'),
       kind = CASE WHEN discovered_via <> 'our_blacklist_domain' THEN kind
                   WHEN COALESCE(description,'') ~* '(record label|independent label|\\mimprint\\M|releases|demos?)'
                     OR name ~* '(record|label|imprint)'
                     OR EXISTS (SELECT 1 FROM label_db_emails e WHERE e.label_id = l.id AND e.role = 'demo') THEN 'label'
                   ELSE 'other' END
     WHERE status='resolved' AND crawled_at IS NULL AND website IS NULL`
  );
  return { crawled: rows.length, withEmail };
}

// ── 4b. graph: labels follow their sister labels ───────────────────────────

/**
 * Self-expanding source: walk the SoundCloud followings of labels we already
 * trust (grade A/B, or any charting label) once each, and queue every followed
 * account whose name reads like a label. New labels then go through the same
 * resolve → crawl → filter path, and are walked in turn.
 */
export async function expandGraph(limit = 6): Promise<{ walked: number; inserted: number }> {
  const cid = await getClientId();
  if (!cid) return { walked: 0, inserted: 0 };
  const { rows } = await pool.query<{ id: number; sc_id: string }>(
    `SELECT id, sc_id::text FROM label_db WHERE status='resolved' AND sc_id IS NOT NULL AND graph_at IS NULL
        AND (grade IN ('A','B') OR chart_entries > 0)
      ORDER BY (grade = 'A') DESC NULLS LAST, chart_entries DESC LIMIT $1`, [limit]
  );
  const cands: Candidate[] = [];
  const nameRe = /\b(records?|recordings?|recordz|label|imprint|music group)\b/i;
  for (const l of rows) {
    const res = await scApi<{ collection: (ScUser & { track_count: number })[] }>(`/users/${l.sc_id}/followings?limit=200`, cid);
    for (const u of res?.collection ?? []) {
      if (u.track_count > 0 && u.followers_count >= 100 && nameRe.test(u.username.replace(/\([^)]*\)|\[[^\]]*\]/g, ""))) cands.push({ name: u.username, via: "sc_graph", sc_id: String(u.id) });
    }
    await pool.query(`UPDATE label_db SET graph_at=now() WHERE id=$1`, [l.id]);
  }
  return { walked: rows.length, inserted: await insertCandidates(cands) };
}

// ── 4c. Discogs: country, site, contacts, parent and sub-labels ────────────

export async function discogsBatch(limit = 20): Promise<{ checked: number; found: number; sublabels: number; excluded: number } | { skipped: string }> {
  if (!discogsEnabled()) return { skipped: "no DISCOGS_TOKEN" };
  const { rows } = await pool.query<{ id: number; name: string; norm_name: string; status: string; country_code: string | null; website: string | null; chart_entries: number; sc_followers: number | null; description: string | null }>(
    `SELECT id, name, norm_name, status, country_code, website, chart_entries, sc_followers, description FROM label_db
      WHERE discogs_at IS NULL AND status IN ('resolved','no_match') AND kind = 'label'
      ORDER BY (grade = 'A') DESC NULLS LAST, (grade = 'B') DESC NULLS LAST, chart_entries DESC, sc_followers DESC NULLS LAST LIMIT $1`, [limit]
  );
  let found = 0, excluded = 0;
  const subs: Candidate[] = [];
  for (const l of rows) {
    const d = await findLabel(l.name.replace(/\([^)]*\)/g, "").trim(), (t) => normLabel(t) === l.norm_name);
    if (!d) { await pool.query(`UPDATE label_db SET discogs_at=now() WHERE id=$1`, [l.id]); continue; }
    found++;
    const site = l.website ?? d.urls?.find((u) => isSite(u)) ?? null;
    const cc = l.country_code ?? countryFromAddress(`${d.contact_info ?? ""}\n${d.profile ?? ""}`) ?? countryFromDomain(site);
    const v = countryVerdict({ country_code: cc, website: site, description: l.description, sc_followers: l.sc_followers, chart_entries: l.chart_entries });
    // A label we could not find on SoundCloud comes alive once Discogs gives it a site.
    const status = !v.ok ? "excluded" : l.status === "no_match" && site ? "resolved" : l.status;
    await pool.query(
      `UPDATE label_db SET discogs_id=$2, discogs_at=now(), website=COALESCE(website,$3), country_code=COALESCE($4,country_code),
         country_tier=COALESCE($5,country_tier), parent_label=$6, sublabels=$7, status=$8, exclude_reason=COALESCE($9,exclude_reason),
         crawled_at = CASE WHEN website IS NULL AND $3::text IS NOT NULL THEN NULL ELSE crawled_at END, updated_at=now()
       WHERE id=$1`,
      [l.id, d.id, site, v.ok ? v.country : null, v.ok ? v.tier : null, d.parent_label?.name ?? null,
       (d.sublabels ?? []).map((x) => x.name).slice(0, 50), status, v.ok ? null : v.reason]
    );
    if (!v.ok) { excluded++; continue; }
    const mails = new Map(emailsIn(`${d.contact_info ?? ""} ${d.profile ?? ""}`).map((e) => [e, d.uri] as [string, string]));
    if (mails.size) await saveEmails(l.id, mails);
    for (const sub of d.sublabels ?? []) subs.push({ name: sub.name, via: "discogs_sublabel" });
  }
  return { checked: rows.length, found, sublabels: await insertCandidates(subs), excluded };
}

// ── 5. grade ───────────────────────────────────────────────────────────────

export async function gradeLabels(): Promise<void> {
  await pool.query(
    `UPDATE label_db l SET grade = g.grade, updated_at = now() FROM (
       SELECT l.id,
         CASE
           WHEN EXISTS (SELECT 1 FROM label_db_emails e WHERE e.label_id=l.id AND e.verdict='valid')
                AND (l.last_charted > CURRENT_DATE - 45 OR l.sc_last_active > now() - interval '180 days'
                     OR (l.sc_id IS NULL AND l.website IS NOT NULL AND l.crawled_at IS NOT NULL)) THEN 'A'
           WHEN EXISTS (SELECT 1 FROM label_db_emails e WHERE e.label_id=l.id AND e.verdict IN ('valid','pending','catch_all','unknown')) THEN 'B'
           WHEN l.demo_url IS NOT NULL OR l.instagram IS NOT NULL OR l.facebook IS NOT NULL THEN 'C'
         END AS grade
       FROM label_db l WHERE l.status = 'resolved') g
     WHERE l.id = g.id AND l.grade IS DISTINCT FROM g.grade`
  );
}

/** Yield per source — what the digest and the Labels tab show, so weak sources are visible. */
export async function labelSourceStats() {
  const { rows } = await pool.query<{ via: string; total: number; resolved: number; excluded: number; with_email: number; grade_a: number }>(
    `SELECT discovered_via via, COUNT(*)::int total,
            COUNT(*) FILTER (WHERE status='resolved')::int resolved,
            COUNT(*) FILTER (WHERE status='excluded')::int excluded,
            COUNT(*) FILTER (WHERE grade IN ('A','B'))::int with_email,
            COUNT(*) FILTER (WHERE grade='A')::int grade_a
       FROM label_db GROUP BY 1 ORDER BY 2 DESC`
  );
  return rows;
}
