import { NextResponse } from "next/server";
import { query } from "@/lib/db";

const SEGMENTS_V2 = ["NEW_ENTRY", "CONSISTENT", "FAST_GROWING", "DECLINING", "TOP_PERFORMER"] as const;

type ExportRowV2 = {
  artist_beatport_id: string;
  artist_name: string | null;
  segment: string;
  score: string;
  total_chart_entries: number;
  first_seen: string | null;
  last_seen: string | null;
};

function escapeCsvCell(s: string | null | undefined): string {
  if (s == null) return "";
  const t = String(s);
  if (t.includes('"') || t.includes(",") || t.includes("\n")) {
    return `"${t.replace(/"/g, '""')}"`;
  }
  return t;
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const segmentParam = searchParams.get("segment");
  const segment =
    segmentParam && SEGMENTS_V2.includes(segmentParam as (typeof SEGMENTS_V2)[number])
      ? segmentParam
      : null;

  let rows: ExportRowV2[] = [];
  try {
    if (segment) {
      rows = await query<ExportRowV2>(
        `SELECT ls.artist_beatport_id, am.artist_name, ls.segment, ls.score::text AS score,
                am.total_chart_entries, am.first_seen::text AS first_seen, am.last_seen::text AS last_seen
         FROM lead_scores ls
         LEFT JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
         WHERE ls.segment = $1
         ORDER BY ls.score DESC NULLS LAST`,
        [segment]
      );
    } else {
      rows = await query<ExportRowV2>(
        `SELECT ls.artist_beatport_id, am.artist_name, ls.segment, ls.score::text AS score,
                am.total_chart_entries, am.first_seen::text AS first_seen, am.last_seen::text AS last_seen
         FROM lead_scores ls
         LEFT JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
         ORDER BY ls.score DESC NULLS LAST`
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Export failed. Run migration 013." },
      { status: 500 }
    );
  }

  const headers = [
    "artist_beatport_id",
    "artist_name",
    "segment",
    "score",
    "appearances",
    "first_seen",
    "last_seen",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        escapeCsvCell(r.artist_beatport_id),
        escapeCsvCell(r.artist_name),
        escapeCsvCell(r.segment),
        r.score,
        r.total_chart_entries,
        escapeCsvCell(r.first_seen),
        escapeCsvCell(r.last_seen),
      ].join(",")
    ),
  ];
  const csv = lines.join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="leads.csv"',
    },
  });
}
