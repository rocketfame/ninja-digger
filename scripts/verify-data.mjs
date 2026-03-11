#!/usr/bin/env node
/**
 * Verify BPTT data coverage: env, chart_entries, bptoptracker_daily, artist_metrics.
 * Run: node scripts/verify-data.mjs
 */
import pg from "pg";
import "dotenv/config";

// From lib/bptoptrackerGenres.ts (44 genres)
const ALL_CODE_GENRES = [
  "140-deep-dubstep-grime", "african", "afro-house", "ambient-experimental", "amapiano",
  "bass-club", "bass-house", "brazilian-funk", "breaks-breakbeat-uk-bass", "caribbean",
  "country", "dance-pop", "deep-house", "dj-tools-acapellas", "downtempo", "drum-bass",
  "dubstep", "electro-classic-detroit-modern", "electronica", "funky-house", "global",
  "hard-dance-hardcore-neo-rave", "hard-techno", "hip-hop", "house", "indie-dance",
  "jackin-house", "latin", "mainstage", "melodic-house-techno", "minimal-deep-tech",
  "nu-disco-disco", "organic-house", "pop", "progressive-house", "psy-trance", "r-b",
  "rock", "tech-house", "techno-peak-time-driving", "techno-raw-deep-hypnotic",
  "trance-main-floor", "trance-raw-deep-hypnotic", "trap-future-bass", "uk-garage-bassline",
];

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL not set. Copy .env.example to .env");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: connectionString
    .replace(/([?&])sslmode=require\b/gi, "$1sslmode=verify-full")
    .replace(/([?&])sslmode=prefer\b/gi, "$1sslmode=verify-full"),
});

const today = new Date().toISOString().slice(0, 10);

async function run() {
  const envGenres = process.env.BPTOPTRACKER_GENRES?.trim()
    ? process.env.BPTOPTRACKER_GENRES.split(",").map((g) => g.trim()).filter(Boolean)
    : [];

  const [ceMax, ceBpttMax, dailyMax, dailyGenres, amGenres, catalogGenres] = await Promise.all([
    pool.query(`SELECT MAX(snapshot_date)::text AS d FROM chart_entries`),
    pool.query(`
      SELECT MAX(ce.snapshot_date)::text AS d
      FROM chart_entries ce
      JOIN charts_catalog cc ON cc.id = ce.chart_id AND cc.platform = 'bptoptracker'
    `),
    pool.query(`SELECT MAX(snapshot_date)::text AS d FROM bptoptracker_daily`),
    pool.query(`SELECT genre_slug, COUNT(*)::int AS cnt FROM bptoptracker_daily GROUP BY genre_slug ORDER BY genre_slug`),
    pool.query(`SELECT DISTINCT unnest(genres) AS g FROM artist_metrics WHERE genres IS NOT NULL AND array_length(genres,1)>0`),
    pool.query(`SELECT genre_slug FROM charts_catalog WHERE platform = 'bptoptracker' AND genre_slug IS NOT NULL`),
  ]);

  const ceMaxDate = ceMax.rows[0]?.d ?? null;
  const ceBpttMaxDate = ceBpttMax.rows[0]?.d ?? null;
  const dailyMaxDate = dailyMax.rows[0]?.d ?? null;
  const dailyGenreSlugs = dailyGenres.rows.map((r) => r.genre_slug);
  const amGenreSlugs = amGenres.rows.map((r) => r.g);
  const catalogGenreSlugs = [...new Set(catalogGenres.rows.map((r) => r.genre_slug).filter(Boolean))];

  const missingFromDaily = ALL_CODE_GENRES.filter((g) => !dailyGenreSlugs.includes(g));
  const missingFromCatalog = ALL_CODE_GENRES.filter((g) => !catalogGenreSlugs.includes(g));

  // Check afro-house specifically (user filter)
  const afroHouseDaily = dailyGenres.rows.find((r) => r.genre_slug === "afro-house" || r.genre_slug?.toLowerCase().includes("afro"));
  const afroHouseRows = afroHouseDaily ? await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM bptoptracker_daily WHERE genre_slug = $1`,
    [afroHouseDaily.genre_slug]
  ) : { rows: [{ cnt: 0 }] };
  const afroHouseSlug = afroHouseDaily?.genre_slug ?? "—";

  // Sample: how many artists in leads for afro-house + newcomer?
  const leadsAfro = await pool.query(`
    SELECT COUNT(DISTINCT ls.artist_beatport_id) AS cnt
    FROM lead_scores ls
    JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
    WHERE (am.genres IS NOT NULL AND 'afro-house' = ANY(am.genres))
       OR EXISTS (
         SELECT 1 FROM chart_entries ce
         JOIN charts_catalog cc ON cc.id = ce.chart_id AND cc.platform = 'bptoptracker'
         WHERE ce.artist_beatport_id = ls.artist_beatport_id AND cc.genre_slug = 'afro-house'
       )
  `);
  const newcomerAfro = await pool.query(`
    SELECT COUNT(DISTINCT ls.artist_beatport_id) AS cnt
    FROM lead_scores ls
    JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
    WHERE ls.segment = 'NEWCOMER'
      AND ((am.genres IS NOT NULL AND 'afro-house' = ANY(am.genres))
           OR EXISTS (
             SELECT 1 FROM chart_entries ce
             JOIN charts_catalog cc ON cc.id = ce.chart_id AND cc.platform = 'bptoptracker'
             WHERE ce.artist_beatport_id = ls.artist_beatport_id AND cc.genre_slug = 'afro-house'
           ))
  `);

  console.log("\n=== BPTT Data Verification ===\n");
  console.log("Today:", today);
  console.log("\n--- ENV ---");
  console.log("BPTOPTRACKER_GENRES:", envGenres.length ? `${envGenres.length} genres: ${envGenres.slice(0, 5).join(", ")}${envGenres.length > 5 ? "..." : ""}` : "NOT SET (cron/background-sync will skip BPTT!)");
  console.log("\n--- DB Dates ---");
  console.log("chart_entries (all): max date:", ceMaxDate ?? "—");
  console.log("chart_entries (bptoptracker): max date:", ceBpttMaxDate ?? "—");
  console.log("bptoptracker_daily: max date:", dailyMaxDate ?? "—");
  console.log("Data up to today?", ceBpttMaxDate === today || dailyMaxDate === today ? "YES" : "NO");
  console.log("\n--- DB Genres ---");
  console.log("bptoptracker_daily: genres:", dailyGenreSlugs.length, dailyGenreSlugs.slice(0, 15).join(", ") + (dailyGenreSlugs.length > 15 ? "..." : ""));
  console.log("artist_metrics (distinct):", amGenreSlugs.length);
  console.log("charts_catalog (bptoptracker):", catalogGenreSlugs.length);
  console.log("\n--- Missing ---");
  console.log("Genres in code (44) but NOT in bptoptracker_daily:", missingFromDaily.length);
  if (missingFromDaily.length > 0) console.log("  ", missingFromDaily.slice(0, 15).join(", ") + (missingFromDaily.length > 15 ? "..." : ""));
  console.log("Genres in code but NOT in charts_catalog:", missingFromCatalog.length);
  if (missingFromCatalog.length > 0) console.log("  ", missingFromCatalog.slice(0, 15).join(", ") + (missingFromCatalog.length > 15 ? "..." : ""));
  console.log("\n--- Afro House (user filter) ---");
  console.log("bptoptracker_daily genre_slug for afro:", afroHouseSlug);
  console.log("bptoptracker_daily rows for afro-house:", afroHouseRows.rows[0]?.cnt ?? 0);
  console.log("Leads with afro-house:", leadsAfro.rows[0]?.cnt ?? 0);
  console.log("Newcomer + afro-house leads:", newcomerAfro.rows[0]?.cnt ?? 0);
  if (!envGenres.length) {
    console.log("\nBPTOPTRACKER_GENRES не задано — використовуються всі 44 жанри (OK для повного покриття).");
  } else if (envGenres.length < 10) {
    console.log("\n!!! BPTOPTRACKER_GENRES обмежує до", envGenres.length, "жанрів. Для всіх жанрів — залиште порожнім у .env");
  }
  console.log("\n");
  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
