// TURBO enrichment: 4 genres in parallel, 4 artists per genre concurrently
// + auto-send Touch 1 after each genre batch
const DB_URL = "postgresql://neondb_owner:npg_C7eM2bfuFndI@ep-proud-wind-ainbssmr-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require";
const { Pool } = require('pg');
const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false }, max: 20 });

const API = "https://ninja-digger.vercel.app/api/internal";
const ARTIST_CONCURRENCY = 4;
const GENRE_CONCURRENCY = 4;

async function enrichArtist(id) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 62000);
    const r = await fetch(`${API}/enrich/artist?artistId=${id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: c.signal
    });
    clearTimeout(t);
    return await r.json();
  } catch { return { ok: false, linksAdded: 0, contactsAdded: 0 }; }
}

async function processGenre(genre) {
  const artists = await pool.query(`
    WITH gc AS (
      SELECT DISTINCT artist_beatport_id, artist_name,
        COUNT(DISTINCT snapshot_date) as days, MIN(position) as best_pos
      FROM bptoptracker_daily
      WHERE genre_slug = $1 AND artist_beatport_id IS NOT NULL
        AND snapshot_date >= CURRENT_DATE - interval '7 days'
      GROUP BY artist_beatport_id, artist_name
    )
    SELECT gc.artist_beatport_id, gc.artist_name
    FROM gc
    LEFT JOIN artist_contacts ac ON gc.artist_beatport_id = ac.artist_beatport_id AND ac.type = 'email'
    LEFT JOIN enrichment_runs er ON er.scope_id = gc.artist_beatport_id AND er.started_at > CURRENT_DATE - interval '12 hours'
    WHERE ac.id IS NULL AND er.id IS NULL AND gc.days <= 7
    ORDER BY gc.best_pos ASC LIMIT 25
  `, [genre]);

  if (artists.rows.length === 0) return { genre, done: 0, emails: 0, links: 0 };

  const queue = [...artists.rows];
  let done = 0, emails = 0, links = 0;

  async function worker() {
    while (queue.length > 0) {
      const a = queue.shift();
      if (!a) break;
      const d = await enrichArtist(a.artist_beatport_id);
      done++;
      links += d.linksAdded || 0;
      if (d.contactsAdded > 0) {
        emails += d.contactsAdded;
        console.log(`  ✓ [${genre}] ${a.artist_name} -> ${d.contactsAdded} emails`);
      }
    }
  }

  await Promise.all(Array.from({ length: ARTIST_CONCURRENCY }, () => worker()));
  return { genre, done, emails, links };
}

async function autoSendTouch1() {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 60000);
    const r = await fetch(`${API}/outreach/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ touchNum: 1, batchSize: 50 }),
      signal: c.signal
    });
    clearTimeout(t);
    const d = await r.json();
    if (d.sent > 0) console.log(`\n📧 AUTO-SENT ${d.sent} Touch 1 emails!`);
    return d.sent || 0;
  } catch { return 0; }
}

async function main() {
  const genres = await pool.query(`
    SELECT genre_slug, COUNT(DISTINCT artist_beatport_id) as cnt
    FROM bptoptracker_daily
    WHERE artist_beatport_id IS NOT NULL AND snapshot_date >= CURRENT_DATE - interval '7 days'
    GROUP BY genre_slug HAVING COUNT(DISTINCT artist_beatport_id) >= 10
    ORDER BY COUNT(DISTINCT artist_beatport_id) DESC
  `);

  console.log(`=== TURBO ENRICHMENT: ${genres.rows.length} genres, ${GENRE_CONCURRENCY} parallel ===\n`);

  let totalEmails = 0, totalLinks = 0, totalArtists = 0, totalSent = 0;
  const genreQueue = [...genres.rows.map(r => r.genre_slug)];

  // Process genres in parallel batches
  while (genreQueue.length > 0) {
    const batch = genreQueue.splice(0, GENRE_CONCURRENCY);
    console.log(`\n--- Batch: ${batch.join(', ')} ---`);

    const results = await Promise.all(batch.map(g => processGenre(g)));

    for (const r of results) {
      if (r.done > 0) {
        totalArtists += r.done;
        totalEmails += r.emails;
        totalLinks += r.links;
        console.log(`[${r.genre}] ${r.done} artists, ${r.links} links, ${r.emails} emails`);
      }
    }

    // Auto-send after each batch
    const sent = await autoSendTouch1();
    totalSent += sent;

    console.log(`Progress: ${genres.rows.length - genreQueue.length}/${genres.rows.length} genres | ${totalArtists} artists | ${totalEmails} emails found | ${totalSent} sent`);
  }

  console.log(`\n=== DONE: ${totalArtists} artists, ${totalLinks} links, ${totalEmails} emails, ${totalSent} sent ===`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
