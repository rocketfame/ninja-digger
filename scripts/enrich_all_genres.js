// Parallel enrichment across ALL genres
// Runs 3 artists concurrently to balance speed vs Vercel rate limits
const DB_URL = "postgresql://neondb_owner:npg_C7eM2bfuFndI@ep-proud-wind-ainbssmr-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require";
const { Pool } = require('pg');
const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

const CONCURRENCY = 3; // parallel requests to Vercel
const API_BASE = "https://ninja-digger.vercel.app/api/internal/enrich/artist";

async function enrichArtist(id) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 65000);
    const resp = await fetch(`${API_BASE}?artistId=${id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal
    });
    clearTimeout(t);
    return await resp.json();
  } catch (e) {
    return { ok: false, linksAdded: 0, contactsAdded: 0, error: e.message };
  }
}

async function runBatch(artists, label) {
  let done = 0, emails = 0, links = 0;
  const queue = [...artists];

  async function worker() {
    while (queue.length > 0) {
      const artist = queue.shift();
      if (!artist) break;
      const data = await enrichArtist(artist.artist_beatport_id);
      done++;
      links += data.linksAdded || 0;
      if (data.contactsAdded > 0) {
        emails += data.contactsAdded;
        console.log(`  ✓ [${label}] ${artist.artist_name} -> ${data.contactsAdded} emails`);
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
  return { done, emails, links };
}

async function main() {
  // Get all genres with artists that need enrichment (no email yet)
  const genres = await pool.query(`
    SELECT DISTINCT genre_slug FROM bptoptracker_daily
    WHERE artist_beatport_id IS NOT NULL AND snapshot_date >= CURRENT_DATE - interval '7 days'
    GROUP BY genre_slug HAVING COUNT(DISTINCT artist_beatport_id) >= 10
    ORDER BY genre_slug
  `);

  console.log(`Found ${genres.rows.length} genres to process`);

  let totalEmails = 0, totalLinks = 0, totalArtists = 0;

  for (const { genre_slug } of genres.rows) {
    // Get artists in this genre without emails
    const artists = await pool.query(`
      WITH genre_chart AS (
        SELECT DISTINCT artist_beatport_id, artist_name,
          COUNT(DISTINCT snapshot_date) as days, MIN(position) as best_pos
        FROM bptoptracker_daily
        WHERE genre_slug = $1 AND artist_beatport_id IS NOT NULL
          AND snapshot_date >= CURRENT_DATE - interval '7 days'
        GROUP BY artist_beatport_id, artist_name
      )
      SELECT gc.artist_beatport_id, gc.artist_name
      FROM genre_chart gc
      LEFT JOIN artist_contacts ac ON gc.artist_beatport_id = ac.artist_beatport_id AND ac.type = 'email'
      LEFT JOIN enrichment_runs er ON er.scope_id = gc.artist_beatport_id AND er.started_at > CURRENT_DATE - interval '1 day'
      WHERE ac.id IS NULL AND er.id IS NULL AND gc.days <= 7
      ORDER BY gc.best_pos ASC
      LIMIT 30
    `, [genre_slug]);

    if (artists.rows.length === 0) continue;

    console.log(`\n[${genre_slug}] ${artists.rows.length} artists to enrich...`);
    const result = await runBatch(artists.rows, genre_slug);
    totalEmails += result.emails;
    totalLinks += result.links;
    totalArtists += result.done;
    console.log(`[${genre_slug}] Done: ${result.done} artists, ${result.links} links, ${result.emails} emails`);
  }

  console.log(`\n=== TOTAL: ${totalArtists} artists, ${totalLinks} links, ${totalEmails} emails ===`);

  // Show all new emails found
  const newEmails = await pool.query(`
    SELECT DISTINCT ac.artist_beatport_id, am.artist_name, ac.value, ac.confidence,
      (SELECT string_agg(DISTINCT b.genre_slug, ', ')
       FROM bptoptracker_daily b WHERE b.artist_beatport_id = ac.artist_beatport_id) as genres
    FROM artist_contacts ac
    JOIN artist_metrics am ON ac.artist_beatport_id = am.artist_beatport_id
    LEFT JOIN lead_profiles lp ON ac.artist_beatport_id = lp.artist_beatport_id
    WHERE ac.type = 'email' AND ac.created_at > CURRENT_DATE
      AND (lp.status IS NULL OR lp.status = 'New')
      AND ac.confidence >= 0.65
    ORDER BY ac.confidence DESC
  `);

  if (newEmails.rows.length > 0) {
    console.log(`\n=== NEW EMAILS TO SEND (${newEmails.rows.length}) ===`);
    newEmails.rows.forEach(r => console.log(`${r.artist_name} | ${r.value} | conf:${r.confidence} | ${r.genres}`));
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
