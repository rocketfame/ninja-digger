// Full RA scrape: all major cities, all pages, segment by country/city
const DB_URL = process.env.DATABASE_URL;
const { Pool } = require('pg');
const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false }, max: 5 });

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

// Top RA areas by event volume
const AREAS = [
  { id: 13, name: 'London' },
  { id: 34, name: 'Berlin' },
  { id: 8, name: 'New York City' },
  { id: 20, name: 'Barcelona' },
  { id: 29, name: 'Amsterdam' },
  { id: 44, name: 'Paris' },
  { id: 23, name: 'Los Angeles' },
  { id: 41, name: 'Madrid' },
  { id: 28, name: 'Toronto' },
  { id: 40, name: 'Montreal' },
  { id: 218, name: 'San Francisco' },
  { id: 19, name: 'Detroit' },
  { id: 151, name: 'Munich' },
  { id: 386, name: 'Dublin' },
  { id: 344, name: 'Manchester' },
  { id: 343, name: 'Liverpool' },
  { id: 345, name: 'Newcastle' },
  { id: 346, name: 'Leeds' },
  { id: 341, name: 'Edinburgh' },
  // Add more cities
  { id: 5, name: 'Ibiza' },
  { id: 25, name: 'Miami' },
  { id: 38, name: 'Chicago' },
  { id: 30, name: 'Brussels' },
  { id: 43, name: 'Lisbon' },
  { id: 35, name: 'Hamburg' },
  { id: 39, name: 'Melbourne' },
  { id: 36, name: 'Sydney' },
  { id: 45, name: 'Rome' },
  { id: 46, name: 'Milan' },
];

async function fetchPage(areaId, startDate, endDate, page) {
  const q = `{ eventListings(filters: { areas: { eq: ${areaId} }, listingDate: { gte: "${startDate}", lte: "${endDate}" } }, pageSize: 20, page: ${page}) { data { event { id title date contentUrl venue { name area { name country { name } } } promoters { id name contentUrl followerCount } artists { name } } } totalResults } }`;
  const r = await fetch('https://ra.co/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Referer': 'https://ra.co/events' },
    body: JSON.stringify({ query: q })
  });
  return await r.json();
}

async function scrapeArea(area, startDate, endDate) {
  let events = 0, promoters = 0, uniquePromoters = new Set();

  for (let page = 1; page <= 50; page++) {
    const json = await fetchPage(area.id, startDate, endDate, page);
    const listings = json.data?.eventListings?.data || [];
    const total = json.data?.eventListings?.totalResults || 0;
    if (listings.length === 0) break;

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
               city = COALESCE(NULLIF(EXCLUDED.city, ''), ra_promoters.city),
               country = COALESCE(NULLIF(EXCLUDED.country, ''), ra_promoters.country),
               updated_at = now()
             RETURNING id`,
            [String(pr.id), pr.name, 'https://ra.co' + (pr.contentUrl || ''), area.name, e.venue?.area?.country?.name || '', pr.followerCount || 0]
          );
          promoterId = r.rows[0]?.id;
          uniquePromoters.add(pr.id);
        } catch { /* skip */ }
      }

      const eventDate = e.date ? e.date.split('T')[0] : null;
      if (!eventDate) continue;

      try {
        await pool.query(
          `INSERT INTO ra_events (ra_event_id, name, event_date, venue_name, city, country, ra_url, promoter_id, lineup, scraped_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
           ON CONFLICT (ra_event_id) DO UPDATE SET scraped_at = now()`,
          [String(e.id), e.title || 'TBA', eventDate, e.venue?.name || 'TBA', area.name, e.venue?.area?.country?.name || '', 'https://ra.co' + (e.contentUrl || ''), promoterId, (e.artists || []).map(a => a.name).join(', ')]
        );
        events++;
      } catch { /* skip */ }
    }

    if (page * 20 >= total) break;
    await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));
  }

  promoters = uniquePromoters.size;
  return { events, promoters };
}

async function main() {
  const now = new Date();
  const end = new Date(now.getTime() + 42 * 86400000);
  const startDate = now.toISOString().split('T')[0];
  const endDate = end.toISOString().split('T')[0];

  console.log(`Scraping RA: ${startDate} to ${endDate}, ${AREAS.length} cities\n`);
  let totalEvents = 0, totalPromoters = 0;

  for (const area of AREAS) {
    const { events, promoters } = await scrapeArea(area, startDate, endDate);
    totalEvents += events;
    totalPromoters += promoters;
    if (events > 0) console.log(`${area.name}: ${events} events, ${promoters} promoters`);
    await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
  }

  // Update segments by city (not by weeks)
  await pool.query(`
    INSERT INTO ra_promoter_profiles (promoter_id, segment, status, updated_at)
    SELECT p.id, LOWER(REPLACE(p.city, ' ', '-')), 'New', now()
    FROM ra_promoters p
    WHERE p.city IS NOT NULL AND p.city != ''
    ON CONFLICT (promoter_id) DO UPDATE SET
      segment = EXCLUDED.segment, updated_at = now()
  `);

  console.log(`\n=== TOTAL: ${totalEvents} events, ${totalPromoters} new promoters ===`);

  const s1 = await pool.query('SELECT COUNT(*) as c FROM ra_events');
  const s2 = await pool.query('SELECT COUNT(*) as c FROM ra_promoters');
  const s3 = await pool.query('SELECT segment, COUNT(*) as c FROM ra_promoter_profiles GROUP BY segment ORDER BY c DESC LIMIT 20');
  console.log(`DB: ${s1.rows[0].c} events, ${s2.rows[0].c} promoters`);
  console.log('Top cities:');
  s3.rows.forEach(r => console.log(`  ${r.segment}: ${r.c}`));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
