import { NextResponse } from "next/server";
import { query } from "@/lib/db";

const SEGMENTS = ["core", "regular", "fresh", "momentum", "flyers"] as const;

type ExportRow = {
  artist_id: number;
  artist_name: string;
  segment: string;
  score: string;
  appearances: number;
  first_seen: string;
  last_seen: string;
  status: string | null;
  contact_email: string | null;
  contact_other: string | null;
  readiness: boolean | null;
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
    segmentParam && SEGMENTS.includes(segmentParam as (typeof SEGMENTS)[number])
      ? segmentParam
      : null;

  let rows: ExportRow[] = [];
  try {
    if (segment) {
      rows = await query<ExportRow>(
        `SELECT als.artist_id, als.artist_name, als.segment, als.score::text AS score,
                als.appearances, als.first_seen::text AS first_seen, als.last_seen::text AS last_seen,
                lo.status, lo.contact_email, lo.contact_other, lo.readiness
         FROM artist_lead_score als
         LEFT JOIN lead_outreach lo ON lo.artist_id = als.artist_id
         WHERE als.segment = $1
         ORDER BY als.score DESC NULLS LAST`,
        [segment]
      );
    } else {
      rows = await query<ExportRow>(
        `SELECT als.artist_id, als.artist_name, als.segment, als.score::text AS score,
                als.appearances, als.first_seen::text AS first_seen, als.last_seen::text AS last_seen,
                lo.status, lo.contact_email, lo.contact_other, lo.readiness
         FROM artist_lead_score als
         LEFT JOIN lead_outreach lo ON lo.artist_id = als.artist_id
         ORDER BY als.score DESC NULLS LAST`
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Export failed. Run migrations 007–010." },
      { status: 500 }
    );
  }

  const headers = [
    "artist_id",
    "artist_name",
    "segment",
    "score",
    "appearances",
    "first_seen",
    "last_seen",
    "outreach_status",
    "contact_email",
    "contact_other",
    "readiness",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        r.artist_id,
        escapeCsvCell(r.artist_name),
        escapeCsvCell(r.segment),
        r.score,
        r.appearances,
        escapeCsvCell(r.first_seen),
        escapeCsvCell(r.last_seen),
        escapeCsvCell(r.status),
        escapeCsvCell(r.contact_email),
        escapeCsvCell(r.contact_other),
        r.readiness ? "1" : "0",
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
