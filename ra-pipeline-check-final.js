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

    console.log('\n=== Query 6: RA promoters + profiles status ===');
    result = await pool.query(`
SELECT COUNT(DISTINCT p.id) as total_promoters,
  COUNT(DISTINCT CASE WHEN pp.status = 'enriched' THEN p.id END) as enriched,
  COUNT(DISTINCT CASE WHEN pp.status = 'scraped' THEN p.id END) as scraped,
  COUNT(DISTINCT CASE WHEN pp.status IS NULL OR pp.status = 'New' OR pp.status LIKE 'Attempt%' THEN p.id END) as contacted,
  COUNT(DISTINCT CASE WHEN c.type = 'email' THEN p.id END) as with_email
FROM ra_promoters p
LEFT JOIN ra_promoter_profiles pp ON p.id = pp.promoter_id
LEFT JOIN ra_promoter_contacts c ON p.id = c.promoter_id AND c.type = 'email' AND c.status != 'bounced' AND c.confidence >= 0.60;
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

    console.log('\n=== Bonus: RA promoters enrichment pipeline status ===');
    result = await pool.query(`
SELECT 
  COUNT(DISTINCT p.id) as total_promoters,
  COUNT(DISTINCT CASE WHEN p.website IS NOT NULL THEN p.id END) as with_website,
  COUNT(DISTINCT CASE WHEN EXISTS(SELECT 1 FROM ra_promoter_contacts WHERE promoter_id=p.id AND type='email' AND status != 'bounced' AND confidence >= 0.60) THEN p.id END) as with_valid_email,
  COUNT(DISTINCT CASE WHEN p.created_at >= NOW() - INTERVAL '7 days' THEN p.id END) as scraped_last_7d
FROM ra_promoters p;
    `);
    console.table(result.rows);

    console.log('\n=== RA Enrichment Pipeline Progress Summary ===');
    result = await pool.query(`
WITH promoter_pipeline AS (
  SELECT p.id,
    CASE 
      WHEN pp.status = 'New' OR pp.status IS NULL THEN 'new'
      WHEN pp.status LIKE 'Attempt%' THEN 'contacted'
      WHEN pp.status = 'No Response' THEN 'no_response'
      ELSE 'other'
    END as pipeline_stage,
    EXISTS(SELECT 1 FROM ra_promoter_contacts WHERE promoter_id=p.id AND type='email' AND confidence >= 0.60) as has_email,
    EXISTS(SELECT 1 FROM ra_promoter_contacts WHERE promoter_id=p.id AND type='email' AND status != 'bounced' AND confidence >= 0.60) as has_valid_email,
    p.website IS NOT NULL as has_website
  FROM ra_promoters p
  LEFT JOIN ra_promoter_profiles pp ON p.id = pp.promoter_id
)
SELECT 
  pipeline_stage,
  COUNT(*) as count,
  COUNT(*) FILTER (WHERE has_email) as email_found,
  COUNT(*) FILTER (WHERE has_valid_email) as email_valid,
  COUNT(*) FILTER (WHERE has_website) as website_found
FROM promoter_pipeline
GROUP BY pipeline_stage
ORDER BY 
  CASE WHEN pipeline_stage = 'new' THEN 0 WHEN pipeline_stage = 'contacted' THEN 1 WHEN pipeline_stage = 'no_response' THEN 2 ELSE 3 END;
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
