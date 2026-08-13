/**
 * Standalone BPTT backfill: login, fetch charts for a date range, batch-insert into bptoptracker_daily.
 * Usage: node scripts/backfill-bptt.mjs [daysBack]
 * Reads BPTOPTRACKER_EMAIL/PASSWORD and DATABASE_URL from .env.
 */
import { config } from "dotenv";
import * as cheerio from "cheerio";
import pg from "pg";

config();

const ORIGIN = "https://www.bptoptracker.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const DELAY_MS = 350;

const GENRES = [
  "140-deep-dubstep-grime", "african", "afro-house", "amapiano", "ambient-experimental",
  "bass-club", "bass-house", "brazilian-funk", "breaks-breakbeat-uk-bass", "caribbean",
  "country", "dance-pop", "deep-house", "dj-edits", "dj-tools-acapellas", "downtempo",
  "drum-bass", "dubstep", "electro-classic-detroit-modern", "electronica", "funky-house",
  "global", "hard-dance-hardcore-neo-rave", "hard-techno", "hip-hop", "house",
  "indie-dance", "jackin-house", "latin", "latin-electronic", "mainstage",
  "melodic-house-techno", "minimal-deep-tech", "nu-disco-disco", "organic-house", "pop",
  "progressive-house", "psy-trance", "rb", "rock", "tech-house",
  "techno-peak-time-driving", "techno-raw-deep-hypnotic", "trance-main-floor",
  "trance-raw-deep-hypnotic", "trap-future-bass", "uk-garage-bassline",
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 4 });

function getCookies(res) {
  const arr = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return arr.map((c) => c.split(";")[0].trim()).join("; ");
}

async function login() {
  const getRes = await fetch(`${ORIGIN}/login`, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" } });
  const html = await getRes.text();
  let cookie = getCookies(getRes);
  const formBlock = html.match(/<form[^>]*>[\s\S]*?name="email"[\s\S]*?<\/form>/i)?.[0] || html;
  const token = formBlock.match(/name="_token"\s+value="([^"]+)"/)?.[1];
  const res = await fetch(`${ORIGIN}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      Origin: ORIGIN,
      Referer: `${ORIGIN}/login`,
      Cookie: cookie,
    },
    body: new URLSearchParams({ email: process.env.BPTOPTRACKER_EMAIL, password: process.env.BPTOPTRACKER_PASSWORD, _token: token || "" }).toString(),
    redirect: "manual",
  });
  const c1 = getCookies(res);
  if (c1) cookie = c1;
  if (res.status < 301 || res.status > 303) throw new Error(`login failed: ${res.status}`);
  return cookie;
}

function parseChart(html, genre, date) {
  const $ = cheerio.load(html);
  const rows = [];
  $("table tbody tr").each((_, row) => {
    const $row = $(row);
    const pos = parseInt($row.find("td.position").text().trim(), 10);
    if (!Number.isFinite(pos) || pos < 1 || pos > 200) return;
    const title = $row.find("td.title").text().trim();
    const artists = $row.find("td.artists").text().trim();
    const primary = artists.split(",").map((a) => a.trim()).filter(Boolean)[0] || "";
    if (!primary) return;
    const href = $row.find('td.artists a[href*="/artist/"], a[href*="/artist/"]').first().attr("href") || "";
    const idMatch = href.match(/\/artist\/[^/]+\/(\d+)/i);
    let linkPath = null;
    try {
      const path = href.startsWith("http") ? new URL(href).pathname : href;
      linkPath = /\/artist\/[^/]+\/\d+/.test(path) ? path.replace(/\/+$/, "") : null;
    } catch { /* keep null */ }
    rows.push({
      position: pos,
      track_title: title || null,
      artist_name: primary,
      artists_full: artists || null,
      label_name: $row.find("td.label").text().trim() || null,
      released: $row.find("td.released").text().trim() || null,
      movement: $row.find("td.progression").text().trim().match(/[↑↓→]\d*/)?.[0] || null,
      artist_beatport_id: idMatch ? idMatch[1] : null,
      artist_link_path: linkPath,
    });
  });
  return rows.map((r) => ({ ...r, snapshot_date: date, genre_slug: genre }));
}

async function insertBatch(rows) {
  if (!rows.length) return 0;
  const cols = ["snapshot_date", "genre_slug", "position", "track_title", "artist_name", "artists_full", "label_name", "released", "movement", "artist_beatport_id", "artist_link_path"];
  const values = [];
  const params = [];
  rows.forEach((r, i) => {
    const base = i * cols.length;
    values.push(`(${cols.map((_, j) => `$${base + j + 1}`).join(",")})`);
    params.push(r.snapshot_date, r.genre_slug, r.position, r.track_title, r.artist_name, r.artists_full, r.label_name, r.released, r.movement, r.artist_beatport_id, r.artist_link_path);
  });
  const res = await pool.query(
    `INSERT INTO bptoptracker_daily (${cols.join(",")}) VALUES ${values.join(",")}
     ON CONFLICT (snapshot_date, genre_slug, position) DO NOTHING`,
    params
  );
  return res.rowCount ?? 0;
}

const daysBack = parseInt(process.argv[2] || "45", 10);
const dates = [];
for (let i = daysBack; i >= 0; i--) {
  dates.push(new Date(Date.now() - i * 86400e3).toISOString().slice(0, 10));
}

let cookie = await login();
console.log(`[backfill] logged in; ${GENRES.length} genres x ${dates.length} dates`);

const existing = await pool.query(
  `SELECT DISTINCT genre_slug, snapshot_date::text AS d FROM bptoptracker_daily WHERE snapshot_date = ANY($1::date[])`,
  [dates]
);
const done = new Set(existing.rows.map((r) => `${r.genre_slug}|${r.d}`));

let pages = 0, inserted = 0, errors = 0;
for (const date of dates) {
  for (const genre of GENRES) {
    if (done.has(`${genre}|${date}`)) continue;
    try {
      await new Promise((r) => setTimeout(r, DELAY_MS));
      const res = await fetch(`${ORIGIN}/top/track/${genre}/${date}`, {
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", Cookie: cookie },
        redirect: "manual",
      });
      if (res.status === 302) {
        // session expired — re-login once
        cookie = await login();
        errors++;
        continue;
      }
      if (res.status === 404) { errors++; console.log(`[404] ${genre} ${date}`); continue; }
      const html = await res.text();
      const rows = parseChart(html, genre, date);
      if (rows.length === 0) { errors++; console.log(`[empty] ${genre} ${date}`); continue; }
      inserted += await insertBatch(rows);
      pages++;
      if (pages % 100 === 0) console.log(`[progress] ${pages} pages, ${inserted} rows, ${errors} errors, at ${date}`);
    } catch (e) {
      errors++;
      console.log(`[err] ${genre} ${date}: ${e.message}`);
    }
  }
}
console.log(`[done] pages=${pages} inserted=${inserted} errors=${errors}`);
await pool.end();
