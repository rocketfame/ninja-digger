const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const ids = ['478715','1145687','38244','659853','100430','1250535','2302000','13827'];

  for (const id of ids) {
    try {
      const r = await pool.query(
        `INSERT INTO lead_profiles (artist_beatport_id, status, updated_at)
         VALUES ($1, 'Attempt 1', now())
         ON CONFLICT (artist_beatport_id) DO UPDATE SET status = 'Attempt 1', updated_at = now()`,
        [id]
      );
      console.log(`Updated ${id}: ${r.rowCount} row`);
    } catch (e) {
      console.log(`Error ${id}: ${e.message}`);
    }
  }

  // Verify
  const check = await pool.query(
    `SELECT lp.artist_beatport_id, am.artist_name, lp.status
     FROM lead_profiles lp
     JOIN artist_metrics am ON lp.artist_beatport_id = am.artist_beatport_id
     WHERE lp.artist_beatport_id = ANY($1::text[])`,
    [ids]
  );
  check.rows.forEach(r => console.log(`${r.artist_name}: ${r.status}`));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
