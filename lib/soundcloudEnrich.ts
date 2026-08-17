/**
 * SoundCloud lead enrichment: for artists without an email, walk their public
 * funnel — links in their SC bio (Linktree/Beacons/website/Instagram), plus
 * direct probes by username — and extract a contact email.
 */

import { pool } from "@/lib/db";
import { fetchScDescription } from "@/lib/soundcloud";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const JUNK_EMAIL_RE = /(no-?reply|do-?not-?reply|sentry\.io|\bingest\.|\.wixpress|@example\.|\.png|\.jpg|\.gif|@2x|cloudflare|@soundcloud|@w3\.org|@schema\.org|@fontawesome|\.sentry\.|@[0-9a-f]{16,})/i;
const URL_RE = /(https?:\/\/[^\s"'<>)]+|(?:www\.)?[a-z0-9-]+\.(?:com|net|io|co|me|net|link|ee|ai|fm)(?:\/[^\s"'<>)]*)?)/gi;

function cleanEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase().replace(/[.,;:]+$/, "");
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) return null;
  if (JUNK_EMAIL_RE.test(e)) return null;
  return e;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url.startsWith("http") ? url : `https://${url}`, {
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "text/html,application/json" },
      redirect: "follow",
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.text()).slice(0, 120_000);
  } catch {
    return null;
  }
}

function extractEmail(text: string): string | null {
  const matches = text.match(EMAIL_RE) ?? [];
  for (const m of matches) {
    const e = cleanEmail(m);
    if (e) return e;
  }
  // mailto: links carry the cleanest addresses
  const mailto = text.match(/mailto:([^"'?\s]+)/i)?.[1];
  return mailto ? cleanEmail(mailto) : null;
}

function linksFromDescription(desc: string): string[] {
  const urls = new Set<string>();
  for (const m of desc.match(URL_RE) ?? []) {
    const u = m.replace(/[.,)]+$/, "");
    if (/soundcloud\.com|\.png|\.jpg/i.test(u)) continue;
    urls.add(u);
  }
  return [...urls].slice(0, 5);
}

/** Enrich one SC artist. Returns the found email, or null. */
export async function enrichScArtist(a: { soundcloud_id: string; username: string; description: string | null; instagram?: string | null }): Promise<string | null> {
  // 0. If we have no bio yet (Re-Ex promoters), fetch it — booking emails live here
  let description = a.description;
  if (!description) {
    description = await fetchScDescription(a.soundcloud_id).catch(() => null);
    if (description) {
      await pool.query(`UPDATE sc_artists SET description=$1 WHERE soundcloud_id=$2 AND description IS NULL`, [description, a.soundcloud_id]).catch(() => {});
    }
  }
  // Direct email in the bio is the highest-yield source
  if (description) {
    const bioEmail = extractEmail(description);
    if (bioEmail) {
      await pool.query(`UPDATE sc_artists SET email=$1, email_source='bio', updated_at=now() WHERE soundcloud_id=$2 AND email IS NULL`, [bioEmail, a.soundcloud_id]);
      return bioEmail;
    }
  }

  const candidates: string[] = [];
  // 1. links from the SC bio (Linktree, website, IG...)
  if (description) candidates.push(...linksFromDescription(description));
  // 2. direct probes by username
  const slug = a.username.toLowerCase().replace(/[^a-z0-9]/g, "");
  candidates.push(`https://linktr.ee/${slug}`, `https://${slug}.bandcamp.com`, `https://beacons.ai/${slug}`);
  // 3. Re-Ex promoters give us a real Instagram handle — probe its linktree/site
  if (a.instagram) {
    const ig = a.instagram.replace(/[^a-zA-Z0-9._]/g, "");
    candidates.push(`https://linktr.ee/${ig}`, `https://beacons.ai/${ig}`, `https://${ig}.com`, `https://www.instagram.com/${ig}/`);
  }

  const seen = new Set<string>();
  for (const url of candidates) {
    if (seen.has(url)) continue;
    seen.add(url);
    const html = await fetchText(url);
    if (!html) continue;
    // direct email on the page
    let email = extractEmail(html);
    // Linktree/Beacons ship all links + sometimes email inside __NEXT_DATA__ JSON
    if (!email && /linktr\.ee|beacons/i.test(url)) {
      const next = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
      if (next) {
        email = extractEmail(next);
        // follow the first non-social link from linktree (often their website/contact)
        if (!email) {
          const inner = [...next.matchAll(/"url":"(https?:\/\/[^"]+)"/g)].map((m) => m[1])
            .filter((u) => !/instagram|facebook|twitter|tiktok|spotify|youtube|soundcloud|linktr|beacons/i.test(u)).slice(0, 2);
          for (const u of inner) {
            const site = await fetchText(u);
            if (site) { email = extractEmail(site); if (email) break; }
          }
        }
      }
    }
    if (email) {
      const source = /linktr|beacons/i.test(url) ? "linktree" : url.includes("bandcamp") ? "bandcamp" : "enrich";
      await pool.query(`UPDATE sc_artists SET email=$1, email_source=$2, updated_at=now() WHERE soundcloud_id=$3 AND email IS NULL`,
        [email, source, a.soundcloud_id]);
      return email;
    }
  }
  return null;
}

/** Enrich a batch of email-less artists (tier A/B first). */
export async function enrichScBatch(limit = 8): Promise<{ processed: number; found: number }> {
  const rows = (await pool.query<{ soundcloud_id: string; username: string; description: string | null; instagram: string | null }>(
    `SELECT soundcloud_id, username, description, instagram FROM sc_artists
     WHERE email IS NULL AND (is_promoter = true OR tier IN ('A','B'))
     ORDER BY enrich_attempted_at ASC NULLS FIRST, is_promoter DESC, tier, followers_count DESC LIMIT $1`, [limit]
  )).rows;
  let found = 0;
  for (const r of rows) {
    const email = await enrichScArtist(r).catch(() => null);
    if (email) found++;
    // Stamp the attempt so the next batch moves on to different profiles instead
    // of re-probing the same dry ones every hour.
    await pool.query(`UPDATE sc_artists SET enrich_attempted_at=now(), updated_at=now() WHERE soundcloud_id=$1`, [r.soundcloud_id]).catch(() => {});
  }
  return { processed: rows.length, found };
}
