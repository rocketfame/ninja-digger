import { NextResponse } from "next/server";
import { query } from "@/lib/db";

const SEGMENTS_V2 = ["NEWCOMER", "NEW_ENTRY", "CONSISTENT", "FAST_GROWING", "DECLINING", "TOP_PERFORMER"] as const;
const SORT_FIELDS = ["score", "entries", "first_seen", "last_seen", "artist"] as const;
const ORDER_FIELDS = ["asc", "desc"] as const;
/** Макс. рядків експорту — уникнення перевантаження БД та памʼяті при масштабуванні. */
const EXPORT_MAX_ROWS = 50_000;

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
  const genreParam = searchParams.get("genre")?.trim() || null;
  function parseDateParam(value: string | undefined): string | null {
    if (typeof value !== "string" || !value.trim()) return null;
    const s = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return s;
  }
  const dateFromParam = parseDateParam(searchParams.get("dateFrom") ?? undefined);
  const dateToParam = parseDateParam(searchParams.get("dateTo") ?? undefined);
  const sortParam = searchParams.get("sort")?.trim();
  const sort = sortParam && SORT_FIELDS.includes(sortParam as (typeof SORT_FIELDS)[number]) ? sortParam : "score";
  const orderParam = searchParams.get("order")?.trim();
  const order = orderParam && ORDER_FIELDS.includes(orderParam as (typeof ORDER_FIELDS)[number]) ? orderParam : "desc";

  const dateConditionSeg =
    " AND (($3::date IS NULL AND $4::date IS NULL) OR EXISTS (SELECT 1 FROM chart_entries ce WHERE ce.artist_beatport_id = ls.artist_beatport_id AND ce.snapshot_date >= $3::date AND ce.snapshot_date <= $4::date))";
  const dateConditionAll =
    " AND (($2::date IS NULL AND $3::date IS NULL) OR EXISTS (SELECT 1 FROM chart_entries ce WHERE ce.artist_beatport_id = ls.artist_beatport_id AND ce.snapshot_date >= $2::date AND ce.snapshot_date <= $3::date))";

  const orderByClause =
    sort === "entries"
      ? `am.total_chart_entries ${order.toUpperCase()} NULLS LAST, am.artist_name ASC NULLS LAST`
      : sort === "first_seen"
        ? `am.first_seen ${order.toUpperCase()} NULLS LAST, am.artist_name ASC NULLS LAST`
        : sort === "last_seen"
          ? `am.last_seen ${order.toUpperCase()} NULLS LAST, am.artist_name ASC NULLS LAST`
          : sort === "artist"
            ? `am.artist_name ${order.toUpperCase()} NULLS LAST, ls.score DESC NULLS LAST`
            : `ls.score ${order.toUpperCase()} NULLS LAST, am.artist_name ASC NULLS LAST`;

  const genreConditionSeg = genreParam
    ? " AND am.genres IS NOT NULL AND $2 = ANY(am.genres)"
    : " AND $2::text IS NULL";
  const genreConditionAll =
    " AND ($1::text IS NULL OR (am.genres IS NOT NULL AND $1 = ANY(am.genres)))";

  let rows: ExportRowV2[] = [];
  try {
    if (segment) {
      const params = [segment, genreParam ?? null, dateFromParam ?? null, dateToParam ?? null];
      rows = await query<ExportRowV2>(
        `SELECT ls.artist_beatport_id, am.artist_name, ls.segment, ls.score::text AS score,
                am.total_chart_entries, am.first_seen::text AS first_seen, am.last_seen::text AS last_seen
         FROM lead_scores ls
         LEFT JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
         WHERE ls.segment = $1${genreConditionSeg}${dateConditionSeg}
         ORDER BY ${orderByClause}
         LIMIT ${EXPORT_MAX_ROWS + 1}`,
        params
      );
    } else {
      const params = [genreParam ?? null, dateFromParam ?? null, dateToParam ?? null];
      rows = await query<ExportRowV2>(
        `SELECT ls.artist_beatport_id, am.artist_name, ls.segment, ls.score::text AS score,
                am.total_chart_entries, am.first_seen::text AS first_seen, am.last_seen::text AS last_seen
         FROM lead_scores ls
         LEFT JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
         WHERE 1=1${genreConditionAll}${dateConditionAll}
         ORDER BY ${orderByClause}
         LIMIT ${EXPORT_MAX_ROWS + 1}`,
        params
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
  const truncated = rows.length > EXPORT_MAX_ROWS;
  const exportRows = rows.slice(0, EXPORT_MAX_ROWS);
  const lines = [
    headers.join(","),
    ...exportRows.map((r) =>
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

  const disposition = `attachment; filename="leads${segment ? `-${segment}` : ""}.csv"`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": disposition,
      ...(truncated ? { "X-Export-Truncated": "true", "X-Export-Max-Rows": String(EXPORT_MAX_ROWS) } : {}),
    },
  });
}
