/**
 * GET /api/segments/email/export?type=no_reply|warm|dead
 * CSV download of a living email segment (for external mailings / suppression).
 */

import { NextResponse } from "next/server";
import { getSegmentRows, type EmailSegmentType } from "@/lib/emailSegments";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TYPES: EmailSegmentType[] = ["no_reply", "warm", "dead", "all_email", "not_contacted", "gems"];
const ROLES = ["personal", "booking", "management", "generic", "unknown"];

function csvCell(v: string | null): string {
  const s = v ?? "";
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") as EmailSegmentType | null;
  if (!type || !TYPES.includes(type)) {
    return NextResponse.json({ error: "type must be one of: " + TYPES.join(", ") }, { status: 400 });
  }
  const roleParam = searchParams.get("role");
  const role = roleParam && ROLES.includes(roleParam) ? roleParam : null;
  const rows = await getSegmentRows(type, role);

  if (searchParams.get("format") === "json") {
    const limit = Math.min(parseInt(searchParams.get("limit") || "200", 10) || 200, 500);
    return NextResponse.json({
      total: rows.length,
      rows: rows.slice(0, limit).map((r) => ({
        name: r.artist_name,
        link: r.artist_beatport_id ? `https://www.beatport.com/artist/x/${r.artist_beatport_id}` : null,
        email: r.email,
        role: r.role ?? "unknown",
        tier: r.tier,
        segment: r.chart_segment,
      })),
    });
  }

  const header = "email,artist_name,role,tier,artist_beatport_id,lead_status,chart_segment,first_seen,last_seen";
  const body = rows
    .map((r) => [r.email, r.artist_name, r.role ?? "unknown", r.tier, r.artist_beatport_id, r.lead_status, r.chart_segment, r.first_seen?.slice(0, 10) ?? "", r.last_seen?.slice(0, 10) ?? ""].map(csvCell).join(","))
    .join("\n");
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(header + "\n" + body + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ninja-digger-${type}${role ? `-${role}` : ""}-${date}.csv"`,
    },
  });
}
