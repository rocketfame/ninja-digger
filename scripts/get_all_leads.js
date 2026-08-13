const DB_URL = process.env.DATABASE_URL;
const { Pool } = require('pg');
const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const r = await pool.query(`
    SELECT DISTINCT ON (ac.artist_beatport_id)
      ac.artist_beatport_id as id, am.artist_name as name, ac.value as email,
      ac.confidence as conf, COALESCE(lp.status, 'New') as status,
      (SELECT string_agg(DISTINCT b.genre_slug, ', ' ORDER BY b.genre_slug)
       FROM bptoptracker_daily b WHERE b.artist_beatport_id = ac.artist_beatport_id
         AND b.snapshot_date >= CURRENT_DATE - interval '7 days') as genres
    FROM artist_contacts ac
    JOIN artist_metrics am ON ac.artist_beatport_id = am.artist_beatport_id
    LEFT JOIN lead_profiles lp ON ac.artist_beatport_id = lp.artist_beatport_id
    WHERE ac.type = 'email' AND ac.confidence >= 0.65
    ORDER BY ac.artist_beatport_id, ac.confidence DESC
  `);

  const byGenre = {};
  for (const row of r.rows) {
    const genre = row.genres ? row.genres.split(', ')[0] : 'other';
    if (!byGenre[genre]) byGenre[genre] = [];
    byGenre[genre].push(row);
  }

  // Output TSV per genre for Google Sheets
  const sorted = Object.entries(byGenre).sort((a, b) => b[1].length - a[1].length);
  for (const [genre, leads] of sorted) {
    console.log(`\n=== ${genre} (${leads.length} leads) ===`);
    leads.forEach(l => {
      const status = l.status === 'Attempt 1' ? 'Touch 1 Sent' : l.status;
      console.log(`${l.name}\t${l.id}\t${genre}\t\t\t\t\t\t${l.email}\t\t${l.conf}\t${status}\thttps://www.beatport.com/artist/a/${l.id}`);
    });
  }

  console.log(`\nTOTAL: ${r.rows.length} leads across ${sorted.length} genres`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
