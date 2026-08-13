// Enrich all unenriched NEWCOMER artists from last 7 days
const DB_URL = process.env.DATABASE_URL;
const { Pool } = require('pg');
const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
const API = "https://ninja-digger.vercel.app/api/internal/enrich/artist";

async function main() {
  const r = await pool.query(`
    SELECT ls.artist_beatport_id as id, am.artist_name as name
    FROM lead_scores ls
    JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
    LEFT JOIN enrichment_runs er ON er.scope_id = ls.artist_beatport_id
    WHERE ls.segment = 'NEWCOMER'
      AND am.first_seen >= CURRENT_DATE - 7
      AND er.id IS NULL
    ORDER BY am.first_seen DESC
  `);

  console.log(`Enriching ${r.rows.length} newcomers...`);
  let done = 0, emails = 0;

  for (const a of r.rows) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 65000);
      const res = await fetch(`${API}?artistId=${a.id}`, { method: 'POST', signal: c.signal });
      clearTimeout(t);
      const data = await res.json();
      done++;
      if (data.contactsAdded > 0) {
        emails += data.contactsAdded;
        console.log(`✓ ${a.name} -> ${data.contactsAdded} emails`);
      }
      if (done % 10 === 0) console.log(`[${done}/${r.rows.length}] ${emails} emails found`);
    } catch {
      done++;
    }
  }

  // Auto-send Touch 1 for new leads
  try {
    const sendRes = await fetch("https://ninja-digger.vercel.app/api/internal/outreach/send", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ touchNum: 1, batchSize: 10 })
    });
    const sendData = await sendRes.json();
    if (sendData.sent > 0) console.log(`📧 Sent ${sendData.sent} Touch 1 emails`);
  } catch {}

  console.log(`\n=== DONE: ${done} enriched, ${emails} emails, auto-send complete ===`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
