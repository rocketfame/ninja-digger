const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function runQueries() {
  try {
    // Query 1: Newcomer artists per day (last 30 days)
    console.log('\n=== Query 1: Newcomer artists per day (last 30 days) ===');
    let result = await pool.query(`
      SELECT DATE(first_seen) as day, COUNT(*) as newcomers
      FROM artist_metrics am
      JOIN lead_scores ls ON ls.artist_beatport_id = am.artist_beatport_id
      WHERE ls.segment = 'NEWCOMER' AND am.first_seen >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(first_seen)
      ORDER BY day DESC;
    `);
    console.table(result.rows);

    // Query 2: Current enrichment backlog
    console.log('\n=== Query 2: Current enrichment backlog ===');
    result = await pool.query(`
      SELECT COUNT(*) as total_newcomers,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM artist_links al WHERE al.artist_beatport_id = ls.artist_beatport_id)) as enriched,
        COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM artist_links al WHERE al.artist_beatport_id = ls.artist_beatport_id)) as not_enriched
      FROM lead_scores ls
      WHERE ls.segment = 'NEWCOMER';
    `);
    console.table(result.rows);

    // Query 3: How many emails found vs total enriched
    console.log('\n=== Query 3: Emails found vs total enriched ===');
    result = await pool.query(`
      SELECT COUNT(DISTINCT ac.artist_beatport_id) as artists_with_email,
        COUNT(*) as total_emails
      FROM artist_contacts ac
      JOIN lead_scores ls ON ls.artist_beatport_id = ac.artist_beatport_id
      WHERE ls.segment = 'NEWCOMER' AND ac.type = 'email';
    `);
    console.table(result.rows);

    // Query 4: Current pipeline send stats (last 7 days)
    console.log('\n=== Query 4: Pipeline send stats (last 7 days) ===');
    result = await pool.query(`
      SELECT DATE(sent_at) as day, COUNT(*) as emails_sent
      FROM outreach_events
      WHERE sent_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(sent_at)
      ORDER BY day DESC;
    `);
    console.table(result.rows);

    await pool.end();
  } catch (err) {
    console.error('Database error:', err.message);
    process.exit(1);
  }
}

runQueries();
