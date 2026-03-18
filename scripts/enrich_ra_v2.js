// Enrich RA promoters via GraphQL API + website scraping
const DB_URL = "postgresql://neondb_owner:npg_C7eM2bfuFndI@ep-proud-wind-ainbssmr-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require";
const { Pool } = require('pg');
const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const EMAIL_RE = /[\w.+-]+@[\w.-]+\.\w{2,}/g;
const SKIP = ['sentry', 'cloudflare', 'w3.org', 'schema.org', 'example.com', 'wixpress', 'wordpress'];

async function getPromoterFromGraphQL(raId) {
  try {
    const r = await fetch('https://ra.co/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Referer': 'https://ra.co/promoters/' + raId },
      body: JSON.stringify({ query: `{ promoter(id: ${raId}) { name website facebook instagram twitter blurb } }` })
    });
    const json = await r.json();
    return json.data?.promoter || null;
  } catch { return null; }
}

async function scrapeWebsiteForEmails(url) {
  const emails = new Set();
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 8000);
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: c.signal, redirect: 'follow' });
    clearTimeout(t);
    if (r.ok) {
      const html = await r.text();
      const found = html.match(EMAIL_RE) || [];
      found.forEach(e => {
        if (!SKIP.some(s => e.toLowerCase().includes(s))) emails.add(e.toLowerCase());
      });
    }
  } catch { /* skip */ }
  return [...emails];
}

async function main() {
  const promoters = await pool.query(`
    SELECT p.id, p.ra_id, p.name, p.ra_url
    FROM ra_promoters p
    LEFT JOIN ra_promoter_contacts c ON p.id = c.promoter_id AND c.type = 'email'
    WHERE c.id IS NULL
    ORDER BY p.follower_count DESC NULLS LAST
    LIMIT 80
  `);

  console.log(`Enriching ${promoters.rows.length} promoters via GraphQL + website...`);
  let totalEmails = 0, withEmail = 0;

  for (let i = 0; i < promoters.rows.length; i++) {
    const p = promoters.rows[i];
    const data = await getPromoterFromGraphQL(p.ra_id);
    if (!data) continue;

    // Save social links
    const socials = [
      data.website && { type: 'website', value: data.website },
      data.facebook && { type: 'facebook', value: data.facebook },
      data.instagram && { type: 'instagram', value: data.instagram },
      data.twitter && { type: 'twitter', value: data.twitter },
    ].filter(Boolean);

    for (const s of socials) {
      try {
        await pool.query(
          `INSERT INTO ra_promoter_contacts (promoter_id, type, value, source_url, confidence)
           VALUES ($1, $2, $3, $4, 0.90) ON CONFLICT (promoter_id, type, value) DO NOTHING`,
          [p.id, s.type, s.value, p.ra_url]
        );
      } catch { /* skip */ }
    }

    // Extract emails from blurb
    let emails = [];
    if (data.blurb) {
      const found = data.blurb.match(EMAIL_RE) || [];
      emails = found.filter(e => !SKIP.some(s => e.includes(s))).map(e => e.toLowerCase());
    }

    // Scrape website for emails
    if (data.website) {
      const websiteEmails = await scrapeWebsiteForEmails(data.website);
      emails.push(...websiteEmails);

      // Also try /contact page
      try {
        const contactUrl = new URL('/contact', data.website).href;
        const contactEmails = await scrapeWebsiteForEmails(contactUrl);
        emails.push(...contactEmails);
      } catch { /* skip */ }
    }

    // Save unique emails
    const uniqueEmails = [...new Set(emails)];
    for (const email of uniqueEmails) {
      try {
        await pool.query(
          `INSERT INTO ra_promoter_contacts (promoter_id, type, value, source_url, confidence)
           VALUES ($1, 'email', $2, $3, 0.85) ON CONFLICT (promoter_id, type, value) DO NOTHING`,
          [p.id, email, data.website || p.ra_url]
        );
        totalEmails++;
      } catch { /* skip */ }
    }

    if (uniqueEmails.length > 0) {
      withEmail++;
      console.log(`  ✓ ${p.name} -> ${uniqueEmails.join(', ')}`);
    }

    // Progress
    if ((i + 1) % 10 === 0) console.log(`  [${i + 1}/${promoters.rows.length}]`);

    // Anti-block: 0.5-2s between GraphQL requests, 1-3s for websites
    await new Promise(r => setTimeout(r, 500 + Math.random() * 1500));
  }

  console.log(`\n=== DONE: ${promoters.rows.length} checked, ${withEmail} with email, ${totalEmails} emails total ===`);

  const stats = await pool.query("SELECT COUNT(DISTINCT promoter_id) as c FROM ra_promoter_contacts WHERE type = 'email'");
  console.log(`Total promoters with email in DB: ${stats.rows[0].c}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
