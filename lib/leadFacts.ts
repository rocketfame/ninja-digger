/**
 * Verified, citable facts about a lead for reply drafting. Built ONLY from data
 * we actually track (bptoptracker_daily / chart_entries), so the LLM can name
 * the exact track, chart and positions with links instead of vague "your
 * recent upload". Returns null when we have nothing — the drafter then stays
 * generic rather than inventing.
 */
import { pool } from "@/lib/db";

const BPTT = "https://www.bptoptracker.com";
const BEATPORT = "https://www.beatport.com";

type Row = { snapshot_date: string; genre_slug: string | null; position: number; track_title: string | null; label_name: string | null; artist_link_path: string | null; artist_name: string | null };

const genreName = (slug: string | null) =>
  (slug ?? "").split("-").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ") || "Beatport";

export async function getBeatportFacts(artistBeatportId: string | null | undefined): Promise<string | null> {
  if (!artistBeatportId) return null;
  const rows = await pool
    .query<Row>(
      `SELECT snapshot_date::text, genre_slug, position, track_title, label_name, artist_link_path, artist_name
       FROM bptoptracker_daily WHERE artist_beatport_id = $1 ORDER BY snapshot_date DESC LIMIT 60`,
      [artistBeatportId]
    )
    .then((r) => r.rows)
    .catch(() => [] as Row[]);
  if (rows.length === 0) return null;

  // Group by track+genre: first/last seen, best position, latest position.
  type Agg = { track: string; genre: string; first: string; last: string; best: number; latest: number; days: number; label: string | null };
  const byKey = new Map<string, Agg>();
  for (const r of rows) {
    const key = `${r.track_title ?? "?"}|${r.genre_slug ?? ""}`;
    const d = r.snapshot_date.slice(0, 10);
    const a = byKey.get(key);
    if (!a) byKey.set(key, { track: r.track_title ?? "their track", genre: genreName(r.genre_slug), first: d, last: d, best: r.position, latest: r.position, days: 1, label: r.label_name });
    else { a.first = d; a.best = Math.min(a.best, r.position); a.days++; }
  }
  const tracks = [...byKey.values()].sort((x, y) => (y.last > x.last ? 1 : -1)).slice(0, 3);
  const path = rows[0].artist_link_path;
  const artist = rows[0].artist_name ?? "";
  const lines: string[] = [];
  for (const t of tracks) {
    const q = encodeURIComponent(`${t.track} ${artist}`.trim());
    lines.push(
      `- "${t.track}"${t.label ? ` (${t.label})` : ""} in the Beatport Top 100 ${t.genre} chart: latest position #${t.latest} on ${t.last}, best #${t.best}, seen on ${t.days} day(s) since ${t.first}.` +
      ` Track on Beatport: ${BEATPORT}/search/tracks?q=${q}`
    );
    if (rows.find((r) => r.genre_slug)) lines.push(`  Chart page (BP Top Tracker): ${BPTT}/top/track/${rows[0].genre_slug}/${t.last}`);
  }
  if (path) {
    lines.push(`- Artist page on Beatport: ${BEATPORT}${path}`);
    lines.push(`- Artist chart history (BP Top Tracker): ${BPTT}${path}`);
  }
  return lines.join("\n");
}
