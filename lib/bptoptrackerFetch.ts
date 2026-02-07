/**
 * Fetch and parse BP Top Tracker chart page; return rows for bptoptracker_daily.
 * Uses getBptoptrackerCookie() for auth. Rejects UI text (blocklist) and login page.
 */

import * as cheerio from "cheerio";
import { getBptoptrackerCookie } from "./bptoptrackerAuth";
import {
  isBlockedArtist,
  isBlockedTrack,
  looksLikeLoginOrLandingPage,
} from "./bptoptrackerBlocklist";

const ORIGIN = "https://www.bptoptracker.com";

export type BptoptrackerDailyRow = {
  snapshot_date: string;
  genre_slug: string;
  position: number;
  track_title: string | null;
  artist_name: string;
  artists_full: string | null;
  label_name: string | null;
  released: string | null;
  movement: string | null;
};

function parseChartHtml(html: string, pageUrl: string): BptoptrackerDailyRow[] {
  if (looksLikeLoginOrLandingPage(html)) {
    throw new Error(
      "BP Top Tracker повернув сторінку логіну або головну, не чарт. Перевір BPTOPTRACKER_EMAIL та BPTOPTRACKER_PASSWORD у .env і спробуй знову."
    );
  }
  const genreMatch = pageUrl.match(/\/top\/track\/([^/]+)\/(\d{4}-\d{2}-\d{2})/i);
  const genre = genreMatch ? genreMatch[1] : "unknown";
  const date = genreMatch ? genreMatch[2] : "";

  const rows: BptoptrackerDailyRow[] = [];
  const $ = cheerio.load(html);
  const seen = new Set<string>();

  $("table tbody tr, .chart-table tbody tr, tbody tr").each((_, row) => {
    const $row = $(row);
    const tds = $row.find("td");
    if (tds.length < 3) return;
    const texts = tds.map((__, td) => $(td).text().trim()).get();
    const rankNum = parseInt(texts[0], 10);
    if (!Number.isFinite(rankNum) || rankNum < 1 || rankNum > 200) return;
    let title = "";
    let artists = "";
    let label = "";
    let released = "";
    let movement = "";
    if (texts.length >= 5) {
      title = (texts[1] ?? texts[2] ?? "").replace(/[↑↓→]\d*/g, "").trim();
      artists = texts[2] ?? texts[3] ?? "";
      label = texts[3] ?? texts[4] ?? "";
      released = texts[4] ?? texts[5] ?? "";
      movement = texts[1]?.match(/[↑↓→]\d*/)?.[0] ?? "";
    } else {
      title = $row.find("[class*='title'], [class*='track']").first().text().trim();
      artists = $row.find("[class*='artist']").first().text().trim();
      label = $row.find("[class*='label']").first().text().trim();
      released = $row.find("[class*='release']").first().text().trim();
    }
    const primaryArtist = artists.split(",").map((a) => a.trim()).filter(Boolean)[0]?.trim() || "";
    if (isBlockedArtist(primaryArtist) || isBlockedTrack(title)) return;
    const key = `${date}-${genre}-${rankNum}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      snapshot_date: date,
      genre_slug: genre,
      position: rankNum,
      track_title: title || null,
      artist_name: primaryArtist,
      artists_full: artists || null,
      label_name: label || null,
      released: released || null,
      movement: movement || null,
    });
  });

  if (rows.length === 0) {
    $("tr, [class*='row']").each((i, el) => {
      const $el = $(el);
      const title = $el.find("a").first().text().trim();
      const artist = $el.find("[class*='artist'], a").eq(1).text().trim();
      if (artist && !isBlockedArtist(artist) && !isBlockedTrack(title) && i < 200) {
        rows.push({
          snapshot_date: date,
          genre_slug: genre,
          position: i + 1,
          track_title: title || null,
          artist_name: artist,
          artists_full: null,
          label_name: null,
          released: null,
          movement: null,
        });
      }
    });
  }

  if (rows.length === 0) {
    throw new Error(
      "Не знайдено жодного валідного рядка чарту. Можливо сторінка логіну або змінилась структура сайту."
    );
  }
  return rows;
}

/**
 * Fetch one chart page (genre + date) and return parsed rows.
 */
export async function fetchChartForDate(genreSlug: string, date: string): Promise<BptoptrackerDailyRow[]> {
  const cookie = await getBptoptrackerCookie();
  const url = `${ORIGIN}/top/track/${genreSlug}/${date}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml",
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const html = await res.text();
  return parseChartHtml(html, url);
}

/**
 * Generate date range YYYY-MM-DD from dateFrom to dateTo (inclusive).
 */
export function dateRange(dateFrom: string, dateTo: string): string[] {
  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  const out: string[] = [];
  const d = new Date(from);
  while (d <= to) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
