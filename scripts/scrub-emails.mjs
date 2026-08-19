import { readFileSync } from "node:fs";
import pg from "pg";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.*)$/m)?.[1] || "").replace(/^["']|["']$/g, "").trim();
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
const r = await pool.query(
  `UPDATE spotify_leads SET email=NULL, email_source=NULL
   WHERE email IS NOT NULL AND (
     email ~* '^(press|media|info|contact|support|hello|team|jobs|legal|dmca|admin|no-?reply)@'
     OR email ~* '@(spacehey|linktr|linktree|beacons|tiktok|youtube|facebook|instagram|spotify|apple|distrokid)\.')`
);
console.log("scrubbed", r.rowCount);
const s = (await pool.query(`SELECT COUNT(email)::int emails, COUNT(spotify_url)::int spotify, COUNT(*)::int total FROM spotify_leads`)).rows[0];
console.log("now emails=", s.emails, "spotify=", s.spotify, "total=", s.total);
await pool.end();
