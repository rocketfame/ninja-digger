/**
 * GET /api/segments/soundcloud/export?tier=A&withEmail=1 — CSV of SC leads.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { SC_ACTIVITY, SC_ACTIVITY_SQL } from "@/lib/scActivity";

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
  const activity = searchParams.get("activity");
  const conds: string[] = [];
  const params: string[] = [];
  if (tier && ["A", "B", "C"].includes(tier)) { params.push(tier); conds.push(`tier = $${params.length}`); }
  if (withEmail) conds.push(`email IS NOT NULL`);
  if (activity && activity in SC_ACTIVITY) conds.push(`${SC_ACTIVITY_SQL} = '${activity}'`);
  if (searchParams.get("promoter") === "1") conds.push("is_promoter = true");
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = (await pool.query(
    `SELECT email, username, full_name, permalink_url, tier, ${SC_ACTIVITY_SQL} AS activity, track_count, followers_count, city, country_code, lead_status, instagram, is_promoter
     FROM sc_artists ${where} ORDER BY tier, followers_count DESC LIMIT 20000`, params
  )).rows;
  const header = "email,username,full_name,profile_url,tier,activity,tracks,followers,city,country,instagram,pays_for_promo,lead_status";
  const body = rows.map((r) => [r.email, r.username, r.full_name, r.permalink_url, r.tier, r.activity, r.track_count, r.followers_count, r.city, r.country_code, r.instagram, r.is_promoter ? "yes" : "", r.lead_status].map(csvCell).join(",")).join("\n");
  const date = new Date().toISOString().slice(0, 10);
  const suffix = [tier, activity].filter(Boolean).join("-");
  return new NextResponse(header + "\n" + body + "\n", {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="soundcloud-leads${suffix ? `-${suffix}` : ""}-${date}.csv"` },
  });
}
