const DB_URL = "postgresql://neondb_owner:npg_C7eM2bfuFndI@ep-proud-wind-ainbssmr-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require";
const { Pool } = require('pg');
const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

// IDs already in sheet
const known = new Set(['100430','1007352','102899','1031060','1040474','1043631','1043221','1065103','1077948','1085090','1091165','1107188','1121315','1143125','1145687','115988','117859','1197625','1204815','1250535','1257595','1275905','125822','125165','1475098','1482148','1506040','152129','174524','194495','212453','216749','230535','2302000','241780','256279','256531','275226','301156','306704','318565','319926','326124','356567','359610','374020','38244','406814','458233','459690','468783','478715','486239','487887','488432','493563','531957','54823','54871','554722','593300','628533','644033','655200','659853','675509','678489','69366','694260','727332','741533','760090','813674','87811','88622','888498','891571','9051','99166']);

async function main() {
  const r = await pool.query(`
    SELECT DISTINCT ON (ac.artist_beatport_id) am.artist_name, ac.artist_beatport_id as id, ac.value as email, ac.confidence,
      COALESCE(lp.status,'New') as status,
      (SELECT string_agg(DISTINCT b.genre_slug,', ' ORDER BY b.genre_slug) FROM bptoptracker_daily b WHERE b.artist_beatport_id=ac.artist_beatport_id AND b.snapshot_date>=CURRENT_DATE-interval '7 days') as genres
    FROM artist_contacts ac
    JOIN artist_metrics am ON ac.artist_beatport_id=am.artist_beatport_id
    LEFT JOIN lead_profiles lp ON ac.artist_beatport_id=lp.artist_beatport_id
    WHERE ac.type='email' AND ac.confidence>=0.65 AND (ac.status IS NULL OR ac.status!='bounced')
    ORDER BY ac.artist_beatport_id, ac.confidence DESC
  `);

  const newLeads = r.rows.filter(row => !known.has(row.id));
  console.log('New leads to add to sheet: ' + newLeads.length);

  newLeads.forEach(row => {
    const g = row.genres ? row.genres.split(', ')[0] : 'other';
    const s = row.status === 'Attempt 1' ? 'Touch 1' : row.status === 'Attempt 2' ? 'Touch 2' : row.status === 'No Response' ? 'Touch 3' : row.status;
    console.log([row.artist_name, row.id, g, 'NEWCOMER', row.email, row.confidence, s, 'https://www.beatport.com/artist/a/' + row.id].join('\t'));
  });

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
