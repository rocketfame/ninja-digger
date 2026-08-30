/**
 * GET /api/segments/radar/export — export a Radar segment (per source).
 *   ?source=youtube|reddit|playlisting|instagram|all   (default: all)
 *   ?format=csv|json                                    (default: csv)
 *   ?emailOnly=1                                        (default: 1 — ready-to-send)
 *   ?limit=N
 * YouTube segment = source=youtube: artists actively uploading music videos,
 * a natural audience for a YouTube-promo pitch.
 */
import { NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/apiAuth";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

type Row = {
  name: string | null; email: string | null; spotify_url: string | null;
  soundcloud_url: string | null; source_url: string | null; website: string | null;
  followers: number | null; video_count: number | null; heat_score: number; intent_signal: string | null; source: string;
};

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const sp = new URL(request.url).searchParams;
  const source = (sp.get("source") || "all").toLowerCase();
  const format = (sp.get("format") || "csv").toLowerCase();
  const emailOnly = sp.get("emailOnly") !== "0";
  const limit = Math.min(parseInt(sp.get("limit") || "5000", 10) || 5000, 20000);

  const conds: string[] = [];
  const params: unknown[] = [];
  if (source !== "all") { params.push(source); conds.push(`source = $${params.length}`); }
  if (emailOnly) conds.push("email IS NOT NULL");
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  params.push(limit);

  const rows = await pool
    .query<Row>(
      `SELECT name, email, spotify_url, soundcloud_url, source_url, website, followers, video_count, heat_score, intent_signal, source
       FROM radar_leads ${where} ORDER BY heat_score DESC, email_found_at DESC NULLS LAST LIMIT $${params.length}`,
      params
    )
    .then((r) => r.rows).catch(() => [] as Row[]);

  if (format === "json") {
    return NextResponse.json({ source, count: rows.length, rows });
  }

  const header = ["name", "email", "source", "channel_url", "spotify", "soundcloud", "website", "subscribers", "video_count", "heat"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      csvCell(r.name), csvCell(r.email), csvCell(r.source), csvCell(r.source_url),
      csvCell(r.spotify_url), csvCell(r.soundcloud_url), csvCell(r.website),
      csvCell(r.followers), csvCell(r.video_count), csvCell(r.heat_score),
    ].join(","));
  }
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="radar_${source}.csv"`,
    },
  });
}
