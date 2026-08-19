/**
 * Contact-extraction crawler (Layer B) for Spotify leads.
 * Pulls leads that have public links (linktree/website) but no email yet,
 * fetches those pages (+ /contact, /about subpages), extracts & filters a
 * real contact email, and writes it back to spotify_leads. Fully server-side —
 * public pages, no Instagram session, no block risk.
 *
 * Usage: node scripts/crawl-contacts.mjs [limit]
 */
import { readFileSync } from "node:fs";
import pg from "pg";

// Load DATABASE_URL from .env.local
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const DATABASE_URL = (env.match(/^DATABASE_URL=(.*)$/m)?.[1] || "").replace(/^["']|["']$/g, "").trim();
if (!DATABASE_URL) throw new Error("DATABASE_URL not found in .env.local");

const LIMIT = parseInt(process.argv[2] || "400", 10);
const CONCURRENCY = 6;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36";

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Junk / placeholder / generic hygiene — same spirit as the SoundCloud pipeline.
const JUNK = /(^(support|help|admin|webmaster|postmaster|abuse|hostmaster|billing|noc|sysadmin|security|privacy|feedback|info|contact|hello|team|mail|no-?reply|example|sample|test|demo|your|name|user|press|media|jobs|careers|legal|dmca|copyright|help-?desk)@)|(@(bandcamp|example|ejemplo|prueba|domain|yourdomain|yoursite|email|sentry|wixpress|godaddy|sentry\.io|test|placeholder|spacehey|linktr|linktree|beacons|hoo|tiktok|youtube|facebook|instagram|spotify|apple|distrokid|wix|squarespace|shopify|cloudflare)\.)|(\.(png|jpe?g|gif|svg|webp|css|js)$)|(ejemplo|youremail|yourname|tuemail|tucorreo)/i;

function pickEmail(html) {
  const seen = new Set();
  for (const raw of html.match(EMAIL_RE) || []) {
    const e = raw.trim().toLowerCase().replace(/[.,;]+$/, "");
    if (e.length > 120 || seen.has(e)) continue;
    seen.add(e);
    if (!JUNK.test(e)) return e;
  }
  return null;
}

async function fetchText(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, redirect: "follow", signal: ctrl.signal });
    if (!r.ok) return "";
    return (await r.text()).slice(0, 400000);
  } catch { return ""; }
  finally { clearTimeout(t); }
}

function subpages(base) {
  try {
    const u = new URL(base);
    if (/linktr\.ee|beacons|hoo\.be|linktw\.in|straw\.page|snd\.click|bio\.link|komi/i.test(u.host)) return [];
    const root = `${u.protocol}//${u.host}`;
    return [`${root}/contact`, `${root}/about`, `${root}/contact-us`];
  } catch { return []; }
}

async function findEmail(urls) {
  for (let url of urls.filter(Boolean)) {
    if (!/^https?:\/\//.test(url)) url = "https://" + url;
    const html = await fetchText(url);
    if (html) { const e = pickEmail(html); if (e) return e; }
    for (const sp of subpages(url)) {
      const h2 = await fetchText(sp, 8000);
      if (h2) { const e = pickEmail(h2); if (e) return e; }
    }
  }
  return null;
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4, ssl: { rejectUnauthorized: false } });

async function main() {
  // 0) scrub any placeholder/junk emails already stored
  const scrub = await pool.query(
    `UPDATE spotify_leads SET email=NULL, email_source=NULL
     WHERE email IS NOT NULL AND (email ~* '(ejemplo|example|prueba|youremail|yourname|@test\\.|@domain\\.|noreply|no-reply)' OR email ILIKE 'info@%' OR email ILIKE 'contact@%')`
  );
  console.log(`scrubbed ${scrub.rowCount} placeholder emails`);

  const { rows } = await pool.query(
    `SELECT ig_username, linktree, website, spotify_url, soundcloud_url
     FROM spotify_leads
     WHERE email IS NULL AND (linktree IS NOT NULL OR website IS NOT NULL)
     ORDER BY followers DESC NULLS LAST LIMIT $1`, [LIMIT]
  );
  console.log(`crawling ${rows.length} leads with links...`);

  let found = 0, done = 0;
  const queue = [...rows];
  async function worker() {
    while (queue.length) {
      const r = queue.shift();
      const email = await findEmail([r.linktree, r.website]);
      done++;
      if (email) {
        await pool.query(
          `UPDATE spotify_leads SET email=$2, email_source='link_crawl', enriched_at=now(), updated_at=now() WHERE ig_username=$1 AND email IS NULL`,
          [r.ig_username, email]
        );
        found++;
        console.log(`  ✓ ${r.ig_username} → ${email}  [${found} found / ${done} done]`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const stats = (await pool.query(`SELECT COUNT(*)::int total, COUNT(email)::int emails, COUNT(spotify_url)::int spotify FROM spotify_leads`)).rows[0];
  console.log(`\nDONE: +${found} emails this run. DB now: ${stats.emails} emails / ${stats.spotify} spotify / ${stats.total} total`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
