import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { SC_ACTIVITY_SQL } from "@/lib/scActivity";

export const dynamic = "force-dynamic";

const HAS_TRACKS = "track_count >= 1";

export async function GET() {
  try {
    const r = await pool.query(`SELECT
        COUNT(*) FILTER (WHERE ${HAS_TRACKS})::int total,
        COUNT(*) FILTER (WHERE is_promoter AND track_count=0)::int promoters,
        COUNT(email) FILTER (WHERE ${HAS_TRACKS} AND tier='A')::int a,
        COUNT(email) FILTER (WHERE ${HAS_TRACKS} AND tier='B')::int b,
        COUNT(email) FILTER (WHERE ${HAS_TRACKS} AND COALESCE(tier,'C')='C')::int c,
        COUNT(email) FILTER (WHERE ${HAS_TRACKS} AND ${SC_ACTIVITY_SQL}='hot')::int hot,
        COUNT(email) FILTER (WHERE ${HAS_TRACKS} AND ${SC_ACTIVITY_SQL}='warm')::int warm,
        COUNT(email) FILTER (WHERE ${HAS_TRACKS} AND ${SC_ACTIVITY_SQL}='cool')::int cool,
        COUNT(email) FILTER (WHERE ${HAS_TRACKS} AND ${SC_ACTIVITY_SQL}='dormant')::int dormant
      FROM sc_artists`);
    return NextResponse.json({ ok: true, row: r.rows[0] });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
