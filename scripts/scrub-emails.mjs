import { readFileSync } from "node:fs";
import pg from "pg";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.*)$/m)?.[1] || "").replace(/^["']|["']$/g, "").trim();
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
// scrub role-generic, platform, tracking (sentry/wixpress/hex-local) + junk test source_posts
const r = await pool.query(
  `UPDATE spotify_leads SET email=NULL, email_source=NULL
   WHERE email IS NOT NULL AND (
     email ~* '^(press|media|info|contact|support|hello|team|jobs|legal|dmca|admin|no-?reply)@'
     OR email ~* '@(spacehey|linktr|linktree|beacons|tiktok|youtube|facebook|instagram|spotify|apple|distrokid)\.'
     OR email ~* 'sentry|wixpress|ingest\.|amazonaws|cloudfront'
     OR email ~* '^[0-9a-f]{16,}@')`
);
console.log("scrubbed", r.rowCount);
const s = (await pool.query(`SELECT COUNT(email)::int emails, COUNT(spotify_url)::int spotify, COUNT(*)::int total FROM spotify_leads`)).rows[0];
console.log("now emails=", s.emails, "spotify=", s.spotify, "total=", s.total);
await pool.end();
