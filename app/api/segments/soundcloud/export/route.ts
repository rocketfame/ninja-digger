/**
 * GET /api/segments/soundcloud/export?tier=A&withEmail=1 — CSV of SC leads.
 */
import { NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/apiAuth";
import { pool } from "@/lib/db";
import { SC_ACTIVITY, SC_ACTIVITY_SQL } from "@/lib/scActivity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function csvCell(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const { searchParams } = new URL(request.url);
  const tier = searchParams.get("tier");
  const withEmail = searchParams.get("withEmail") === "1";
  const activity = searchParams.get("activity");
  // Analytics mode: repost/promo channels with no own tracks (kept for future
  // insight into their model, NOT outreach). Default = real artists only.
  const analytics = searchParams.get("analytics") === "1";
  const conds: string[] = [];
  const params: string[] = [];
  // A lead must have its own tracks — accounts with 0 tracks are repost channels,
  // useless for artist outreach. Analytics mode flips to exactly those.
  conds.push(analytics ? "track_count = 0 AND is_promoter = true" : "track_count >= 1");
  if (tier && ["A", "B", "C"].includes(tier)) { params.push(tier); conds.push(`tier = $${params.length}`); }
  if (withEmail) conds.push(`email IS NOT NULL`);
  // Gold = verified working base (alive/engaged email).
  const alive = `email IS NOT NULL AND COALESCE(email_status,'') NOT IN ('bounced','unsub') AND lead_status IS DISTINCT FROM 'Unsubscribed' AND lead_status IS DISTINCT FROM 'Bounced'`;
  if (searchParams.get("gold") === "1") conds.push(`${alive} AND (opens > 0 OR lead_status = 'Responded' OR delivered_at IS NOT NULL)`);
  // Diamonds = hottest subset (actually engaged).
  if (searchParams.get("diamond") === "1") conds.push(`${alive} AND (opens > 0 OR clicks > 0 OR lead_status = 'Responded')`);
  if (activity && activity in SC_ACTIVITY) conds.push(`${SC_ACTIVITY_SQL} = '${activity}'`);
  if (searchParams.get("promoter") === "1") conds.push("is_promoter = true");
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  // Preview mode: JSON slice + total, for the in-app modal (no download).
  if (searchParams.get("format") === "json") {
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "100", 10) || 100, 500);
    const [rows, totalRow] = await Promise.all([
      pool.query(
        `SELECT email, username, full_name, permalink_url, tier, ${SC_ACTIVITY_SQL} AS activity, track_count, followers_count, country_code, instagram
         FROM sc_artists ${where} ORDER BY tier, followers_count DESC LIMIT ${limit}`, params
      ).then((r) => r.rows),
      pool.query(`SELECT COUNT(*)::int c FROM sc_artists ${where}`, params).then((r) => r.rows[0]?.c ?? 0),
    ]);
    // Add name/link so the shared SegmentPreview renders (keeps original fields).
    const mapped = rows.map((r) => ({ ...r, name: r.full_name || r.username, link: r.permalink_url }));
    return NextResponse.json({ total: totalRow, shown: mapped.length, rows: mapped });
  }

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
