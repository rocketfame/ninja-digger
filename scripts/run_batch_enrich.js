// Mass enrichment for afro-house artists without emails
const DB_URL = "postgresql://neondb_owner:npg_C7eM2bfuFndI@ep-proud-wind-ainbssmr-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require";
const { Pool } = require('pg');
const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const res = await pool.query(`
    WITH genre_chart AS (
      SELECT DISTINCT artist_beatport_id, artist_name,
        COUNT(DISTINCT snapshot_date) as days, MIN(position) as best_pos
      FROM bptoptracker_daily
      WHERE genre_slug = 'afro-house' AND artist_beatport_id IS NOT NULL
        AND snapshot_date >= CURRENT_DATE - interval '7 days'
      GROUP BY artist_beatport_id, artist_name
    )
    SELECT gc.artist_beatport_id, gc.artist_name
    FROM genre_chart gc
    LEFT JOIN artist_contacts ac ON gc.artist_beatport_id = ac.artist_beatport_id AND ac.type = 'email'
    WHERE ac.id IS NULL AND gc.days <= 7
    ORDER BY gc.best_pos ASC
  `);

  console.log(`Enriching ${res.rows.length} artists...`);
  let done = 0, emails = 0, links = 0;

  for (const artist of res.rows) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 65000);
      const resp = await fetch(
        `https://ninja-digger.vercel.app/api/internal/enrich/artist?artistId=${artist.artist_beatport_id}&rescan=1`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal }
      );
      clearTimeout(t);
      const data = await resp.json();
      done++;
      links += data.linksAdded || 0;
      if (data.contactsAdded > 0) {
        emails += data.contactsAdded;
        console.log(`✓ ${artist.artist_name} -> ${data.contactsAdded} emails, ${data.linksAdded} links`);
      } else if (data.linksAdded > 0) {
        process.stdout.write('.');
      } else {
        process.stdout.write('-');
      }
    } catch (e) {
      process.stdout.write('x');
    }
    // Progress every 10
    if (done % 10 === 0) console.log(` [${done}/${res.rows.length}]`);
  }

  console.log(`\n=== DONE: ${done} artists, ${links} links, ${emails} emails ===`);

  // Show all new emails
  const newEmails = await pool.query(`
    SELECT ac.artist_beatport_id, am.artist_name, ac.value, ac.confidence
    FROM artist_contacts ac
    JOIN artist_metrics am ON ac.artist_beatport_id = am.artist_beatport_id
    WHERE ac.type = 'email' AND ac.created_at > CURRENT_DATE
    ORDER BY ac.confidence DESC
  `);
  if (newEmails.rows.length) {
    console.log('\nNew emails found today:');
    newEmails.rows.forEach(r => console.log(`  ${r.artist_name} -> ${r.value} (${r.confidence})`));
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
