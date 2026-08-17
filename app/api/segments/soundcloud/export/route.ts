/**
 * GET /api/segments/soundcloud/export?tier=A&withEmail=1 — CSV of SC leads.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function csvCell(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tier = searchParams.get("tier");
  const withEmail = searchParams.get("withEmail") === "1";
  const conds: string[] = [];
  const params: string[] = [];
  if (tier && ["A", "B", "C"].includes(tier)) { params.push(tier); conds.push(`tier = $${params.length}`); }
  if (withEmail) conds.push(`email IS NOT NULL`);
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = (await pool.query(
    `SELECT email, username, full_name, permalink_url, tier, track_count, followers_count, city, country_code, lead_status
     FROM sc_artists ${where} ORDER BY tier, followers_count DESC LIMIT 20000`, params
  )).rows;
  const header = "email,username,full_name,profile_url,tier,tracks,followers,city,country,lead_status";
  const body = rows.map((r) => [r.email, r.username, r.full_name, r.permalink_url, r.tier, r.track_count, r.followers_count, r.city, r.country_code, r.lead_status].map(csvCell).join(",")).join("\n");
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(header + "\n" + body + "\n", {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="soundcloud-leads${tier ? `-${tier}` : ""}-${date}.csv"` },
  });
}
