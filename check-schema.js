const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_C7eM2bfuFndI@ep-proud-wind-ainbssmr-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require'
});

async function checkSchema() {
  try {
    console.log('\n=== ra_events columns ===');
    let result = await pool.query(`
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'ra_events'
ORDER BY ordinal_position;
    `);
    console.table(result.rows);

    console.log('\n=== ra_promoters columns ===');
    result = await pool.query(`
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'ra_promoters'
ORDER BY ordinal_position;
    `);
    console.table(result.rows);

    console.log('\n=== ra_promoter_contacts columns ===');
    result = await pool.query(`
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'ra_promoter_contacts'
ORDER BY ordinal_position;
    `);
    console.table(result.rows);

    console.log('\n=== outreach_events columns ===');
    result = await pool.query(`
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'outreach_events'
ORDER BY ordinal_position;
    `);
    console.table(result.rows);

    await pool.end();
  } catch (err) {
    console.error('Database error:', err.message);
    process.exit(1);
  }
}

checkSchema();
