/**
 * GET /api/labels/export — the Labels tab as CSV, same filters as the page
 * (?genre, ?grade, ?tier, ?demo, ?via, ?q, ?status). One row per label.
 */
import { NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/apiAuth";
import { pool } from "@/lib/db";
import { csvCell } from "@/lib/csv";
import { labelWhere, LABEL_EMAILS_SQL, type LabelFilters } from "@/lib/labelQuery";

export const dynamic = "force-dynamic";

const COLS = [
  "name", "grade", "genre_groups", "genres", "country_code", "country_tier", "city", "emails", "demo_policy", "demo_url",
  "website", "soundcloud", "sc_followers", "instagram", "facebook", "bandcamp", "youtube", "twitter", "beatport_url",
  "chart_entries", "chart_tracks", "best_position", "last_charted", "discovered_via", "updated_at",
] as const;

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const sp = new URL(request.url).searchParams;
  const f = Object.fromEntries(["genre", "grade", "tier", "demo", "via", "q", "status"].map((k) => [k, sp.get(k) || undefined])) as LabelFilters;
  const { where, params } = labelWhere(f);
  const { rows } = await pool.query(
    `SELECT l.name, l.grade, ARRAY_TO_STRING(l.genre_groups, '; ') genre_groups, ARRAY_TO_STRING(l.genres, '; ') genres,
            l.country_code, l.country_tier, l.city, ${LABEL_EMAILS_SQL} emails, l.demo_policy, l.demo_url, l.website,
            CASE WHEN l.sc_permalink IS NOT NULL THEN 'https://soundcloud.com/' || l.sc_permalink END soundcloud,
            l.sc_followers, l.instagram, l.facebook, l.bandcamp, l.youtube, l.twitter, l.beatport_url,
            l.chart_entries, l.chart_tracks, l.best_position, l.last_charted::text, l.discovered_via, l.updated_at::date::text
       FROM label_db l ${where}
      ORDER BY l.grade NULLS LAST, l.chart_entries DESC, l.sc_followers DESC NULLS LAST`,
    params
  );
  const csv = [COLS.join(","), ...rows.map((r) => COLS.map((c) => csvCell(r[c])).join(","))].join("\n");
  const tag = [f.genre, f.grade, f.tier && `tier${f.tier}`].filter(Boolean).join("-").replace(/[^a-z0-9-]+/gi, "_") || "all";
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="labels-${tag}-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
