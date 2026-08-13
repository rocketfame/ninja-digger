const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function checkSchema() {
  try {
    console.log('\n=== All RA-related tables ===');
    let result = await pool.query(`
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name LIKE 'ra_%'
ORDER BY table_name;
    `);
    console.log(result.rows.map(r => r.table_name).join('\n'));

    console.log('\n=== ra_promoter_profiles columns (if exists) ===');
    result = await pool.query(`
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'ra_promoter_profiles'
ORDER BY ordinal_position;
    `);
    console.table(result.rows);

    console.log('\n=== Sample ra_events ===');
    result = await pool.query(`SELECT * FROM ra_events LIMIT 2;`);
    console.table(result.rows);

    console.log('\n=== Sample ra_promoters ===');
    result = await pool.query(`SELECT id, name, city, website, created_at FROM ra_promoters LIMIT 3;`);
    console.table(result.rows);

    await pool.end();
  } catch (err) {
    console.error('Database error:', err.message);
    process.exit(1);
  }
}

checkSchema();
