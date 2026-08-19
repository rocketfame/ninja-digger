/**
 * Ingest exfiltrated IG profile batch (compact [{u,n,f,x}]) into spotify_leads:
 * parses external_url blob (x) into spotify/soundcloud/linktree/website columns.
 * Usage: node scripts/ingest-profiles.mjs /tmp/enrich_c1.json
 */
import { readFileSync } from "node:fs";
import pg from "pg";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = (env.match(/^DATABASE_URL=(.*)$/m)?.[1] || "").replace(/^["']|["']$/g, "").trim();
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const find = (blob, re) => { const m = (blob || "").match(re); return m ? m[0].replace(/[.,)]+$/, "") : null; };
const items = JSON.parse(readFileSync(process.argv[2], "utf8"));

let n = 0;
for (const it of items) {
  const x = it.x || "";
  const spotify = find(x, /https?:\/\/[^\s]*(?:open\.spotify\.com|spotify\.link)[^\s]*/i);
  const soundcloud = find(x, /https?:\/\/[^\s]*soundcloud\.com[^\s]*/i);
  const linktree = find(x, /https?:\/\/[^\s]*(?:linktr\.ee|linktw\.in|beacons\.ai|bio\.site|komi\.io|zez\.am|hoo\.be|ffm\.bio|carrd\.co|straw\.page|snd\.click|bio\.link)[^\s]*/i);
  // website = first http link that isn't a known platform/aggregator
  const website = (x.split(/\s+/).find((u) => /^https?:\/\//.test(u) && !/spotify|soundcloud|linktr\.ee|linktw\.in|beacons|bio\.site|komi|zez\.am|youtube|youtu\.be|tiktok|facebook|instagram|apple\.com|distrokid|hyperfollow|bandcamp|ffm\.|lnk\.to|li\.sten|orcd\.co|push\.fm|song\.link|album\.link|spotify\.link|submithub|hypeddit|beatstars|landr|unitedmasters|tunelink|wa\.me|calendly/i.test(u)) || null);
  await pool.query(
    `UPDATE spotify_leads SET
       full_name = COALESCE($2, full_name),
       followers = COALESCE($3, followers),
       spotify_url = COALESCE(spotify_url, $4),
       soundcloud_url = COALESCE(soundcloud_url, $5),
       linktree = COALESCE(linktree, $6),
       website = COALESCE(website, $7),
       enriched_at = now(), updated_at = now()
     WHERE ig_username = $1`,
    [it.u, it.n ?? null, it.f ?? null, spotify, soundcloud, linktree, website]
  );
  n++;
}
const s = (await pool.query(`SELECT COUNT(*)::int total, COUNT(spotify_url)::int spotify, COUNT(soundcloud_url)::int sc, COUNT(linktree)::int lt, COUNT(website)::int web, COUNT(enriched_at)::int enr FROM spotify_leads`)).rows[0];
console.log(`ingested ${n}. DB: spotify=${s.spotify} soundcloud=${s.sc} linktree=${s.lt} website=${s.web} enriched=${s.enr}/${s.total}`);
await pool.end();
