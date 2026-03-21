const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_C7eM2bfuFndI@ep-proud-wind-ainbssmr-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require'
});

async function runQueries() {
  try {
    console.log('\n=== Query 1: RA enrichment activity last 7 days ===');
    let result = await pool.query(`
SELECT DATE(created_at) as day, COUNT(*) as contacts_added
FROM ra_promoter_contacts
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY day DESC;
    `);
    console.table(result.rows);

    console.log('\n=== Query 2: RA events freshness (by scraped_at) ===');
    result = await pool.query(`
SELECT COUNT(*) as total_events, 
  MIN(scraped_at)::date as oldest_scraped, 
  MAX(scraped_at)::date as newest_scraped,
  COUNT(*) FILTER (WHERE scraped_at >= NOW() - INTERVAL '24 hours') as added_last_24h
FROM ra_events;
    `);
    console.table(result.rows);

    console.log('\n=== Query 3: RA send activity (outreach to promoters) ===');
    result = await pool.query(`
SELECT DATE(sent_at) as day, COUNT(*) as sent
FROM outreach_events
WHERE channel = 'email' AND sent_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(sent_at)
ORDER BY day DESC;
    `);
    console.table(result.rows);

    console.log('\n=== Query 4: Chart entries freshness (Beatport data) ===');
    result = await pool.query(`
SELECT snapshot_date, COUNT(*) as entries
FROM chart_entries
WHERE snapshot_date >= NOW() - INTERVAL '7 days'
GROUP BY snapshot_date
ORDER BY snapshot_date DESC;
    `);
    console.table(result.rows);

    console.log('\n=== Query 5: When was lead_scores last refreshed ===');
    result = await pool.query(`
SELECT MAX(updated_at) as last_refresh FROM lead_scores;
    `);
    console.table(result.rows);

    console.log('\n=== Query 6: RA promoters status ===');
    result = await pool.query(`
SELECT COUNT(*) as total,
  COUNT(*) FILTER (WHERE status = 'enriched') as enriched,
  COUNT(*) FILTER (WHERE status = 'scraped') as scraped,
  COUNT(*) FILTER (WHERE status IS NULL OR status = 'new') as new_status
FROM ra_promoters;
    `);
    console.table(result.rows);

    console.log('\n=== Query 7: Daily cron last run - chart entries today ===');
    result = await pool.query(`
SELECT snapshot_date, COUNT(DISTINCT genre_slug) as genres, COUNT(*) as entries
FROM chart_entries ce
JOIN charts_catalog cc ON cc.id = ce.chart_id
WHERE snapshot_date >= CURRENT_DATE - 1
GROUP BY snapshot_date
ORDER BY snapshot_date DESC;
    `);
    console.table(result.rows);

    console.log('\n=== Bonus: RA promoter enrichment status details ===');
    result = await pool.query(`
SELECT 
  COUNT(*) as total_promoters,
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM ra_promoter_contacts c WHERE c.promoter_id = p.id AND c.type='email')) as with_email,
  COUNT(*) FILTER (WHERE website IS NOT NULL) as with_website,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as created_last_7d
FROM ra_promoters p;
    `);
    console.table(result.rows);

    await pool.end();
  } catch (err) {
    console.error('Database error:', err.message);
    console.error(err);
    process.exit(1);
  }
}

runQueries();
