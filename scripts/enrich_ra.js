// Enrich RA promoters: fetch RA profile → extract social links + emails → follow websites
const DB_URL = "postgresql://neondb_owner:npg_C7eM2bfuFndI@ep-proud-wind-ainbssmr-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require";
const { Pool } = require('pg');
const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const EMAIL_RE = /[\w.+-]+@[\w.-]+\.\w{2,}/g;
const SKIP_EMAILS = ['sentry', 'cloudflare', 'w3.org', 'schema.org', 'example.com'];

async function enrichPromoter(id, raUrl, name) {
  let links = 0, emails = 0;

  // 1. Fetch RA profile page
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 10000);
    const res = await fetch(raUrl, { headers: { 'User-Agent': UA }, signal: c.signal });
    clearTimeout(t);

    if (res.ok) {
      const html = await res.text();
      const $ = cheerio.load(html);

      // Extract external links
      const foundLinks = [];
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href || href.startsWith('/') || href.includes('ra.co') || href.includes('residentadvisor')) return;
        try {
          const u = new URL(href.startsWith('http') ? href : 'https://' + href);
          const host = u.hostname.toLowerCase();
          let type = 'website';
          if (host.includes('instagram.com')) type = 'instagram';
          else if (host.includes('facebook.com')) type = 'facebook';
          else if (host.includes('soundcloud.com')) type = 'soundcloud';
          else if (host.includes('twitter.com') || host.includes('x.com')) type = 'twitter';
          foundLinks.push({ type, url: u.href });
        } catch { /* skip */ }
      });

      for (const link of foundLinks) {
        try {
          await pool.query(
            `INSERT INTO ra_promoter_contacts (promoter_id, type, value, source_url, confidence)
             VALUES ($1, $2, $3, $4, 0.80) ON CONFLICT (promoter_id, type, value) DO NOTHING`,
            [id, link.type, link.url, raUrl]
          );
          links++;
        } catch { /* skip */ }
      }

      // Extract emails from RA page
      const pageEmails = html.match(EMAIL_RE) || [];
      for (const email of [...new Set(pageEmails)]) {
        if (SKIP_EMAILS.some(s => email.includes(s))) continue;
        try {
          await pool.query(
            `INSERT INTO ra_promoter_contacts (promoter_id, type, value, source_url, confidence)
             VALUES ($1, 'email', $2, $3, 0.90) ON CONFLICT (promoter_id, type, value) DO NOTHING`,
            [id, email.toLowerCase(), raUrl]
          );
          emails++;
        } catch { /* skip */ }
      }

      // 2. Follow website links for emails
      const websites = foundLinks.filter(l => l.type === 'website').slice(0, 2);
      for (const w of websites) {
        try {
          const wc = new AbortController();
          const wt = setTimeout(() => wc.abort(), 8000);
          const wr = await fetch(w.url, { headers: { 'User-Agent': UA }, signal: wc.signal });
          clearTimeout(wt);
          if (wr.ok) {
            const whtml = await wr.text();
            const we = whtml.match(EMAIL_RE) || [];
            for (const email of [...new Set(we)]) {
              if (SKIP_EMAILS.some(s => email.includes(s))) continue;
              try {
                await pool.query(
                  `INSERT INTO ra_promoter_contacts (promoter_id, type, value, source_url, confidence)
                   VALUES ($1, 'email', $2, $3, 0.75) ON CONFLICT (promoter_id, type, value) DO NOTHING`,
                  [id, email.toLowerCase(), w.url]
                );
                emails++;
              } catch { /* skip */ }
            }
          }
        } catch { /* skip */ }
        await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
      }

      // 3. Follow Instagram for email in bio (just check link)
      const ig = foundLinks.find(l => l.type === 'instagram');
      if (ig) {
        try {
          await pool.query(
            `INSERT INTO ra_promoter_contacts (promoter_id, type, value, source_url, confidence)
             VALUES ($1, 'instagram', $2, $3, 0.85) ON CONFLICT (promoter_id, type, value) DO NOTHING`,
            [id, ig.url, raUrl]
          );
        } catch { /* skip */ }
      }
    }
  } catch { /* skip RA fetch errors */ }

  return { links, emails };
}

async function main() {
  // Get promoters without email
  const promoters = await pool.query(`
    SELECT p.id, p.name, p.ra_url
    FROM ra_promoters p
    LEFT JOIN ra_promoter_contacts c ON p.id = c.promoter_id AND c.type = 'email'
    WHERE c.id IS NULL AND p.ra_url IS NOT NULL
    ORDER BY p.follower_count DESC NULLS LAST
    LIMIT 50
  `);

  console.log(`Enriching ${promoters.rows.length} promoters...`);
  let totalLinks = 0, totalEmails = 0, found = 0;

  for (const p of promoters.rows) {
    const { links, emails } = await enrichPromoter(p.id, p.ra_url, p.name);
    totalLinks += links;
    totalEmails += emails;
    if (emails > 0) {
      found++;
      console.log(`  ✓ ${p.name} -> ${emails} emails, ${links} links`);
    }
    // Anti-block: 1-3s between requests
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
  }

  console.log(`\n=== DONE: ${promoters.rows.length} enriched, ${totalLinks} links, ${totalEmails} emails (${found} with email) ===`);

  const stats = await pool.query("SELECT COUNT(DISTINCT promoter_id) as c FROM ra_promoter_contacts WHERE type = 'email'");
  console.log(`Total promoters with email: ${stats.rows[0].c}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
