// Batch send Touch 1 emails via Gmail compose URLs
// Collects new emails from DB, generates compose URLs, and opens them for sending
const DB_URL = "postgresql://neondb_owner:npg_C7eM2bfuFndI@ep-proud-wind-ainbssmr-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require";
const { Pool } = require('pg');
const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

const SUBJECTS = [
  "Congrats on your recent Beatport chart entry | Promosound",
  "Noticed your Beatport chart movement",
  "Your track is climbing — quick thought",
  "Beatport charts + a brief idea for you",
  "Saw your chart entry — wanted to reach out",
];

const BODIES = [
  (name) => `Hi ${name},\n\nSaw your recent appearance in the Beatport charts — great move.\n\nI'm Max from PromoSound. We work with electronic artists right when momentum starts building, helping extend that visibility across platforms in a structured way.\n\nIf you're planning to push this release further, I'd be happy to share a few ideas tailored to your current stage.\n\nBest,\nMax`,
  (name) => `Hi ${name},\n\nNoticed your track charting on Beatport — well deserved.\n\nI'm Max, working with PromoSound. We help artists amplify their chart momentum through targeted promotion across key platforms.\n\nWould love to share a couple of ideas if you're looking to build on this wave.\n\nCheers,\nMax`,
  (name) => `Hi ${name},\n\nYour Beatport chart entry caught my attention — impressive stuff.\n\nAt PromoSound, we specialize in helping electronic artists capitalize on exactly this kind of momentum — the window right after a chart entry.\n\nHappy to share some thoughts if you're interested.\n\nBest,\nMax`,
  (name) => `Hey ${name},\n\nCongrats on the Beatport chart placement — that's a solid milestone.\n\nI'm Max from PromoSound. We focus on helping artists like you turn chart entries into sustained visibility across streaming and social platforms.\n\nLet me know if you'd like to hear more about how we approach it.\n\nMax`,
  (name) => `Hi ${name},\n\nJust spotted your track on the Beatport charts — nice work.\n\nI run promotion campaigns at PromoSound, and we've had good results helping artists leverage chart momentum while it's still fresh.\n\nIf that sounds relevant, I'd be happy to outline a few options.\n\nBest regards,\nMax`,
];

function hashId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

async function main() {
  // Get all unsent emails with confidence >= 0.65
  const r = await pool.query(`
    SELECT DISTINCT ON (ac.artist_beatport_id)
      ac.artist_beatport_id as id, am.artist_name as name, ac.value as email, ac.confidence as conf,
      (SELECT string_agg(DISTINCT b.genre_slug, ', ' ORDER BY b.genre_slug)
       FROM bptoptracker_daily b WHERE b.artist_beatport_id = ac.artist_beatport_id
         AND b.snapshot_date >= CURRENT_DATE - interval '7 days') as genres
    FROM artist_contacts ac
    JOIN artist_metrics am ON ac.artist_beatport_id = am.artist_beatport_id
    LEFT JOIN lead_profiles lp ON ac.artist_beatport_id = lp.artist_beatport_id
    WHERE ac.type = 'email'
      AND (lp.status IS NULL OR lp.status = 'New')
      AND ac.confidence >= 0.65
    ORDER BY ac.artist_beatport_id, ac.confidence DESC
  `);

  if (r.rows.length === 0) {
    console.log('No new emails to send.');
    await pool.end();
    return;
  }

  console.log(`Found ${r.rows.length} emails to send:\n`);

  // Generate Gmail compose URLs
  const urls = [];
  for (const row of r.rows) {
    const variant = hashId(row.id) % SUBJECTS.length;
    const subject = encodeURIComponent(SUBJECTS[variant]);
    const body = encodeURIComponent(BODIES[variant](row.name));
    const url = `https://mail.google.com/mail/u/4/?view=cm&fs=1&to=${row.email}&su=${subject}&body=${body}`;
    urls.push({ ...row, url, variant });

    console.log(`${row.name} | ${row.email} | conf:${row.conf} | ${row.genres}`);
  }

  // Output URLs for browser automation
  console.log('\n=== COMPOSE URLS ===');
  urls.forEach(u => console.log(u.url));

  // Mark all as Attempt 1
  for (const row of r.rows) {
    await pool.query(
      `INSERT INTO lead_profiles (artist_beatport_id, status, updated_at)
       VALUES ($1, 'Attempt 1', now())
       ON CONFLICT (artist_beatport_id) DO UPDATE SET status = 'Attempt 1', updated_at = now()`,
      [row.id]
    );
  }
  console.log(`\nMarked ${r.rows.length} artists as Attempt 1 in DB`);

  // Output TSV for Google Sheet
  console.log('\n=== TSV FOR SHEET ===');
  for (const row of r.rows) {
    const genre = row.genres?.split(', ')[0] || 'unknown';
    console.log(`${row.name}\t${row.id}\t${genre}\tNEWCOMER\t\t\t\t\t${row.email}\t\t${row.conf}\tTouch 1 Sent\thttps://www.beatport.com/artist/a/${row.id}`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
