const DB_URL = "postgresql://neondb_owner:npg_C7eM2bfuFndI@ep-proud-wind-ainbssmr-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require";
const { Pool } = require('pg');
const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false }, max: 3 });
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

// Cities NOT yet fully scraped
const AREAS = [
  { id: 8, name: 'New York City' },
  { id: 20, name: 'Barcelona' },
  { id: 29, name: 'Amsterdam' },
  { id: 44, name: 'Paris' },
  { id: 23, name: 'Los Angeles' },
  { id: 41, name: 'Madrid' },
  { id: 28, name: 'Toronto' },
  { id: 218, name: 'San Francisco' },
  { id: 5, name: 'Ibiza' },
  { id: 25, name: 'Miami' },
  { id: 38, name: 'Chicago' },
  { id: 43, name: 'Lisbon' },
  { id: 35, name: 'Hamburg' },
  { id: 39, name: 'Melbourne' },
  { id: 36, name: 'Sydney' },
  { id: 344, name: 'Manchester' },
  { id: 386, name: 'Dublin' },
];

async function fetchPage(areaId, startDate, endDate, page) {
  const q = `{ eventListings(filters: { areas: { eq: ${areaId} }, listingDate: { gte: "${startDate}", lte: "${endDate}" } }, pageSize: 20, page: ${page}) { data { event { id title date contentUrl venue { name area { name country { name } } } promoters { id name contentUrl followerCount } } } totalResults } }`;
  const r = await fetch('https://ra.co/graphql', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Referer': 'https://ra.co/events' },
    body: JSON.stringify({ query: q })
  });
  return await r.json();
}

(async () => {
  const now = new Date();
  const end = new Date(now.getTime() + 42*86400000);
  const sd = now.toISOString().split('T')[0];
  const ed = end.toISOString().split('T')[0];
  let tE = 0, tP = 0;

  for (const area of AREAS) {
    for (let page = 1; page <= 50; page++) {
      try {
        const json = await fetchPage(area.id, sd, ed, page);
        const listings = json.data?.eventListings?.data || [];
        if (listings.length === 0) break;

        for (const l of listings) {
          const e = l.event;
          if (!e?.id) continue;
          let pid = null;
          for (const pr of (e.promoters || [])) {
            if (!pr.id) continue;
            try {
              const r = await pool.query('INSERT INTO ra_promoters (ra_id,name,ra_url,city,country,follower_count,updated_at) VALUES ($1,$2,$3,$4,$5,$6,now()) ON CONFLICT (ra_id) DO UPDATE SET follower_count=GREATEST(ra_promoters.follower_count,EXCLUDED.follower_count),city=COALESCE(NULLIF(EXCLUDED.city,\'\'),ra_promoters.city),updated_at=now() RETURNING id', [String(pr.id),pr.name,'https://ra.co'+(pr.contentUrl||''),area.name,e.venue?.area?.country?.name||'',pr.followerCount||0]);
              pid = r.rows[0]?.id; tP++;
            } catch {}
          }
          const d = e.date?.split('T')[0];
          if (!d) continue;
          try {
            await pool.query('INSERT INTO ra_events (ra_event_id,name,event_date,venue_name,city,country,ra_url,promoter_id,scraped_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()) ON CONFLICT (ra_event_id) DO NOTHING', [String(e.id),e.title||'TBA',d,e.venue?.name||'TBA',area.name,e.venue?.area?.country?.name||'','https://ra.co'+(e.contentUrl||''),pid]);
            tE++;
          } catch {}
        }
        const total = json.data?.eventListings?.totalResults || 0;
        if (page * 20 >= total) break;
        await new Promise(r => setTimeout(r, 3000 + Math.random() * 3000));
      } catch { break; }
    }
    console.log(area.name + ': done');
    await new Promise(r => setTimeout(r, 5000 + Math.random() * 5000));
  }
  console.log('TOTAL: ' + tE + ' events, ' + tP + ' promoters');
  await pool.end();
})();
