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

  // Cheerio selection (result of $(row)); avoid generic for @types/cheerio compatibility
  function processRow($row: cheerio.Cheerio, date: string, genre: string): void {
    const tds = $row.find("td");
    if (tds.length < 3) return;
    // Prefer bptoptracker structure: .position, .progression, .artwork, .title, .artists, .remixers, .genre, .label, .released (9 cols)
    const byClass = {
      position: $row.find("td.position").text().trim(),
      title: $row.find("td.title").text().trim(),
      artists: $row.find("td.artists").text().trim(),
      label: $row.find("td.label").text().trim(),
      released: $row.find("td.released").text().trim(),
      progression: $row.find("td.progression").text().trim(),
    };
    const texts = tds.map((__, td) => $(td).text().trim()).get();
    const rankNum = parseInt(byClass.position || texts[0], 10);
    if (!Number.isFinite(rankNum) || rankNum < 1 || rankNum > 200) return;
    let title = byClass.title || (texts.length >= 5 ? (texts[1] ?? texts[2] ?? texts[3] ?? "").replace(/[↑↓→]\d*/g, "").trim() : "");
    let artists = byClass.artists || (texts.length >= 5 ? (texts[2] ?? texts[3] ?? texts[4] ?? "") : "");
    let label = byClass.label || (texts.length >= 5 ? (texts[3] ?? texts[4] ?? texts[7] ?? "") : "");
    let released = byClass.released || (texts.length >= 5 ? (texts[4] ?? texts[5] ?? texts[8] ?? "") : "");
    let movement = byClass.progression?.match(/[↑↓→]\d*/)?.[0] ?? texts[1]?.match(/[↑↓→]\d*/)?.[0] ?? "";
    if (!title && !artists && texts.length >= 9) {
      title = (texts[3] ?? "").replace(/[↑↓→]\d*/g, "").trim();
      artists = texts[4] ?? "";
      label = texts[7] ?? "";
      released = texts[8] ?? "";
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
  }

  // Primary: table with tbody
  $("table tbody tr, .chart-table tbody tr, tbody tr").each((_, row) => {
    processRow($(row), date, genre);
  });

  // Fallback: table without tbody (table > tr) — many sites use this
  if (rows.length === 0) {
    $("table tr").each((_, row) => {
      const $row = $(row);
      if ($row.find("th").length && $row.find("td").length === 0) return; // skip header row
      processRow($row, date, genre);
    });
  }

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
 * Expects already logged-in session (getBptoptrackerCookie). URL pattern: /top/track/{genreSlug}/{date}.
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
  const html = await res.text();
  // #region agent log
  const looksLikeLogin = looksLikeLoginOrLandingPage(html);
  fetch("http://127.0.0.1:7245/ingest/7798bf67-c5b4-45c1-bfd1-dc5453bf1c4b", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "bptoptrackerFetch.ts:fetchChartForDate", message: "chart fetch", data: { genreSlug, date, cookiePresent: !!cookie, resStatus: res.status, htmlLength: html.length, looksLikeLogin }, hypothesisId: "H4", timestamp: Date.now() }) }).catch(() => {});
  // #endregion
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return parseChartHtml(html, url);
}

/**
 * Parse chart from copy-paste TSV (e.g. from bptoptracker chart page).
 * Columns: Position [movement] [?] Title Artists Remixers Genre Label Released
 * Rows with position OUT or not 1–100 are skipped.
 */
export function parseChartTsv(
  tsvText: string,
  genreSlug: string,
  snapshotDate: string
): BptoptrackerDailyRow[] {
  const rows: BptoptrackerDailyRow[] = [];
  const lines = tsvText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const line of lines) {
    const cols = line.split("\t").map((s) => s.trim());
    if (cols.length < 6) continue;
    const posRaw = cols[0];
    if (posRaw.toUpperCase() === "OUT") continue;
    const position = parseInt(posRaw, 10);
    if (!Number.isFinite(position) || position < 1 || position > 200) continue;
    const title = cols[3] ?? "";
    const artists = cols[4] ?? "";
    const primaryArtist = artists.split(",").map((a) => a.trim()).filter(Boolean)[0] ?? "";
    if (isBlockedArtist(primaryArtist) || isBlockedTrack(title)) continue;
    const movement = (cols[1] || cols[2] || "").trim() || null;
    rows.push({
      snapshot_date: snapshotDate,
      genre_slug: genreSlug,
      position,
      track_title: title || null,
      artist_name: primaryArtist,
      artists_full: artists || null,
      label_name: (cols[7] ?? "").trim() || null,
      released: (cols[8] ?? "").trim() || null,
      movement,
    });
  }
  return rows;
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
