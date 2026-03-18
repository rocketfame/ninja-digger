const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  // Genre-specific segment CTE — same logic as the app's leads page
  const res = await pool.query(`
    WITH genre_chart AS (
      SELECT DISTINCT
        ce.artist_beatport_id,
        ce.artist_name,
        ce.genre,
        MIN(ce.snapshot_date) as first_seen,
        MAX(ce.snapshot_date) as last_seen,
        COUNT(DISTINCT ce.snapshot_date) as days_in_chart,
        MIN(ce.position) as best_position
      FROM chart_entries ce
      WHERE ce.genre = 'afro-house'
      GROUP BY ce.artist_beatport_id, ce.artist_name, ce.genre
    ),
    genre_segments AS (
      SELECT *,
        CASE
          WHEN days_in_chart <= 4 AND best_position > 60 THEN 'NEWCOMER'
          WHEN days_in_chart BETWEEN 5 AND 7 THEN 'NEW_ENTRY'
          WHEN days_in_chart > 7 AND best_position <= 20 THEN 'TOP_PERFORMER'
          WHEN days_in_chart > 7 THEN 'CONSISTENT'
          ELSE 'OTHER'
        END as segment
      FROM genre_chart
    )
    SELECT
      gs.artist_name,
      gs.artist_beatport_id,
      gs.genre,
      gs.segment,
      gs.first_seen::text,
      gs.last_seen::text,
      gs.days_in_chart,
      gs.best_position,
      ac.value as email,
      COALESCE(ac.source_url, ac.source_context) as email_source,
      ac.confidence
    FROM genre_segments gs
    LEFT JOIN artist_contacts ac ON gs.artist_beatport_id = ac.artist_beatport_id AND ac.type = 'email'
    WHERE gs.segment IN ('NEWCOMER', 'NEW_ENTRY')
    ORDER BY gs.segment, gs.best_position ASC
  `);

  // Deduplicate
  const seen = new Set();
  const unique = [];
  for (const r of res.rows) {
    if (!seen.has(r.artist_beatport_id)) {
      seen.add(r.artist_beatport_id);
      unique.push(r);
    }
  }

  // Output TSV
  const header = ['Artist Name','Beatport ID','Genre','Segment','First Seen','Last Seen','Days in Chart','Best Position','Email','Email Source','Confidence','Status','Beatport URL'].join('\t');
  console.log(header);
  unique.forEach(r => {
    console.log([
      r.artist_name,
      r.artist_beatport_id,
      r.genre,
      r.segment,
      r.first_seen,
      r.last_seen,
      r.days_in_chart,
      r.best_position,
      r.email || '',
      r.email_source || '',
      r.confidence || '',
      'New',
      'https://www.beatport.com/artist/a/' + r.artist_beatport_id
    ].join('\t'));
  });

  console.error(`\nTotal: ${unique.length} artists, ${unique.filter(r=>r.email).length} with email`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
