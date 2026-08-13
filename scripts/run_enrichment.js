// Run enrichment for all afro-house NEWCOMER time windows
// Then collect all leads with emails

const DB_URL = process.env.DATABASE_URL;

async function main() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

  // Get all afro-house artists without emails from different time windows
  const today = new Date().toISOString().slice(0, 10);
  const windows = [
    { label: '7d', days: 7 },
    { label: '4d', days: 4 },
    { label: '3d', days: 3 },
    { label: '2d', days: 2 },
    { label: '1d', days: 1 },
  ];

  // Get ALL afro-house newcomers without emails
  const res = await pool.query(`
    WITH genre_chart AS (
      SELECT DISTINCT
        b.artist_beatport_id,
        b.artist_name,
        MIN(b.snapshot_date) as first_seen,
        MAX(b.snapshot_date) as last_seen,
        COUNT(DISTINCT b.snapshot_date) as days_in_chart,
        MIN(b.position) as best_position
      FROM bptoptracker_daily b
      WHERE b.genre_slug = 'afro-house'
        AND b.artist_beatport_id IS NOT NULL
        AND b.snapshot_date >= (CURRENT_DATE - interval '7 days')
      GROUP BY b.artist_beatport_id, b.artist_name
    )
    SELECT gc.artist_beatport_id, gc.artist_name, gc.days_in_chart, gc.best_position
    FROM genre_chart gc
    LEFT JOIN artist_contacts ac ON gc.artist_beatport_id = ac.artist_beatport_id AND ac.type = 'email'
    WHERE ac.id IS NULL
      AND gc.days_in_chart <= 7
    ORDER BY gc.best_position ASC
  `);

  console.log(`Found ${res.rows.length} afro-house artists without emails (last 7 days)`);

  // Run enrichment for each via API
  let enriched = 0;
  let emailsFound = 0;

  for (const artist of res.rows) {
    console.log(`Enriching: ${artist.artist_name} (${artist.artist_beatport_id}) pos:${artist.best_position} days:${artist.days_in_chart}`);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 65000);
      const resp = await fetch(
        `https://ninja-digger.vercel.app/api/internal/enrich/artist?artistId=${artist.artist_beatport_id}&rescan=1`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal }
      );
      clearTimeout(timeout);
      const data = await resp.json();
      enriched++;
      if (data.contactsAdded > 0) {
        emailsFound += data.contactsAdded;
        console.log(`  ✓ Found ${data.contactsAdded} contacts, ${data.linksAdded} links`);
      } else {
        console.log(`  - ${data.linksAdded} links, 0 contacts`);
      }
    } catch (e) {
      console.log(`  ✗ Error: ${e.message}`);
    }
  }

  console.log(`\n=== ENRICHMENT DONE ===`);
  console.log(`Enriched: ${enriched} artists`);
  console.log(`Emails found: ${emailsFound}`);

  // Now get ALL afro-house leads with emails for the sheet
  const emailRes = await pool.query(`
    WITH genre_chart AS (
      SELECT DISTINCT
        b.artist_beatport_id,
        b.artist_name,
        MIN(b.snapshot_date) as first_seen,
        MAX(b.snapshot_date) as last_seen,
        COUNT(DISTINCT b.snapshot_date) as days_in_chart,
        MIN(b.position) as best_position
      FROM bptoptracker_daily b
      WHERE b.genre_slug = 'afro-house'
        AND b.artist_beatport_id IS NOT NULL
      GROUP BY b.artist_beatport_id, b.artist_name
    ),
    genre_segments AS (
      SELECT *,
        CASE
          WHEN days_in_chart <= 4 AND best_position > 60 THEN 'NEWCOMER'
          WHEN days_in_chart BETWEEN 5 AND 7 THEN 'NEW_ENTRY'
          ELSE 'OTHER'
        END as segment
      FROM genre_chart
    )
    SELECT
      gs.artist_name,
      gs.artist_beatport_id,
      gs.segment,
      gs.first_seen::text,
      gs.last_seen::text,
      gs.days_in_chart,
      gs.best_position,
      ac.value as email,
      COALESCE(ac.source_url, ac.source_context) as email_source,
      ac.confidence
    FROM genre_segments gs
    JOIN artist_contacts ac ON gs.artist_beatport_id = ac.artist_beatport_id AND ac.type = 'email'
    WHERE gs.segment IN ('NEWCOMER', 'NEW_ENTRY')
    ORDER BY gs.last_seen DESC, gs.best_position ASC
  `);

  // Deduplicate — pick best email per artist
  const seen = new Set();
  const leads = [];
  for (const r of emailRes.rows) {
    if (!seen.has(r.artist_beatport_id)) {
      seen.add(r.artist_beatport_id);
      leads.push(r);
    }
  }

  console.log(`\n=== ALL LEADS WITH EMAILS ===`);
  leads.forEach((r, i) => {
    console.log(`${i+1}. ${r.artist_name} | ${r.segment} | ${r.email} | conf:${r.confidence} | pos:${r.best_position} | ${r.first_seen}-${r.last_seen}`);
  });
  console.log(`Total: ${leads.length}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
