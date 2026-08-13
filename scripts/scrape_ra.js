// Scrape RA events via GraphQL API — store in DB
const DB_URL = process.env.DATABASE_URL;
const { Pool } = require('pg');
const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchPage(startDate, endDate, page) {
  const body = JSON.stringify({
    query: `{ eventListings(filters: { listingDate: { gte: "${startDate}", lte: "${endDate}" } }, pageSize: 20, page: ${page}) { data { event { id title date contentUrl venue { name area { name country { name } } } promoters { id name contentUrl followerCount } artists { name } } } totalResults } }`
  });

  const res = await fetch('https://ra.co/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Referer': 'https://ra.co/events' },
    body
  });
  return await res.json();
}

async function main() {
  const now = new Date();
  const end = new Date(now.getTime() + 42 * 86400000);
  const startDate = now.toISOString().split('T')[0];
  const endDate = end.toISOString().split('T')[0];

  console.log(`Scraping RA events: ${startDate} to ${endDate}`);

  let totalEvents = 0, totalPromoters = 0, uniquePromoters = new Set();

  for (let page = 1; page <= 15; page++) {
    const json = await fetchPage(startDate, endDate, page);
    const listings = json.data?.eventListings?.data || [];
    const total = json.data?.eventListings?.totalResults || 0;

    if (listings.length === 0) { console.log(`Page ${page}: empty, stopping`); break; }
    console.log(`Page ${page}: ${listings.length} events (total: ${total})`);

    for (const l of listings) {
      const e = l.event;
      if (!e || !e.id) continue;

      let promoterId = null;
      for (const pr of (e.promoters || [])) {
        if (!pr.id || !pr.name) continue;
        try {
          const r = await pool.query(
            `INSERT INTO ra_promoters (ra_id, name, ra_url, city, country, follower_count, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())
             ON CONFLICT (ra_id) DO UPDATE SET
               follower_count = GREATEST(ra_promoters.follower_count, EXCLUDED.follower_count),
               updated_at = now()
             RETURNING id`,
            [String(pr.id), pr.name, 'https://ra.co' + (pr.contentUrl || ''), e.venue?.area?.name || '', e.venue?.area?.country?.name || '', pr.followerCount || 0]
          );
          promoterId = r.rows[0]?.id;
          if (!uniquePromoters.has(pr.id)) {
            uniquePromoters.add(pr.id);
            totalPromoters++;
          }
        } catch (err) { /* skip */ }
      }

      const eventDate = e.date ? e.date.split('T')[0] : null;
      if (!eventDate) continue;

      try {
        await pool.query(
          `INSERT INTO ra_events (ra_event_id, name, event_date, venue_name, city, country, ra_url, promoter_id, lineup, scraped_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
           ON CONFLICT (ra_event_id) DO UPDATE SET
             name = EXCLUDED.name,
             promoter_id = COALESCE(EXCLUDED.promoter_id, ra_events.promoter_id),
             scraped_at = now()`,
          [String(e.id), e.title || 'TBA', eventDate, e.venue?.name || 'TBA', e.venue?.area?.name || '', e.venue?.area?.country?.name || '', 'https://ra.co' + (e.contentUrl || ''), promoterId, (e.artists || []).map(a => a.name).join(', ')]
        );
        totalEvents++;
      } catch (err) { /* skip */ }
    }

    if (page * 20 >= total) break;
    // Anti-block delay: 1.5-4s between pages
    await new Promise(r => setTimeout(r, 1500 + Math.random() * 2500));
  }

  // Set segments based on nearest event date
  const segResult = await pool.query(`
    INSERT INTO ra_promoter_profiles (promoter_id, segment, status, updated_at)
    SELECT p.id,
      CASE
        WHEN MIN(e.event_date) <= CURRENT_DATE + 7 THEN '1_week'
        WHEN MIN(e.event_date) <= CURRENT_DATE + 14 THEN '2_weeks'
        WHEN MIN(e.event_date) <= CURRENT_DATE + 21 THEN '3_weeks'
        WHEN MIN(e.event_date) <= CURRENT_DATE + 28 THEN '4_weeks'
        WHEN MIN(e.event_date) <= CURRENT_DATE + 35 THEN '5_weeks'
        ELSE '6_weeks'
      END,
      'New', now()
    FROM ra_promoters p
    JOIN ra_events e ON e.promoter_id = p.id AND e.event_date >= CURRENT_DATE
    GROUP BY p.id
    ON CONFLICT (promoter_id) DO UPDATE SET
      segment = EXCLUDED.segment, updated_at = now()
  `);

  console.log(`\n=== DONE ===`);
  console.log(`Events: ${totalEvents}, Unique promoters: ${totalPromoters}`);
  console.log(`Segments updated: ${segResult.rowCount}`);

  // Stats
  const s1 = await pool.query('SELECT COUNT(*) as c FROM ra_events WHERE event_date >= CURRENT_DATE');
  const s2 = await pool.query('SELECT COUNT(*) as c FROM ra_promoters');
  const s3 = await pool.query('SELECT segment, COUNT(*) as c FROM ra_promoter_profiles GROUP BY segment ORDER BY segment');
  console.log(`DB totals: ${s1.rows[0].c} future events, ${s2.rows[0].c} promoters`);
  s3.rows.forEach(r => console.log(`  ${r.segment}: ${r.c} promoters`));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
