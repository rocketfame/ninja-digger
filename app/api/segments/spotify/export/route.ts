import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function csvCell(v: string | null): string {
  const s = v ?? "";
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  const withEmail = new URL(request.url).searchParams.get("withEmail") === "1";
  const where = withEmail ? "WHERE email IS NOT NULL" : "";
  const rows = (await pool.query(
    `SELECT ig_username, full_name, email, spotify_url, soundcloud_url, website, linktree, source_post, lead_status
     FROM spotify_leads ${where} ORDER BY (email IS NOT NULL) DESC, created_at DESC LIMIT 20000`
  ).catch(() => ({ rows: [] }))).rows;
  const header = "ig_username,full_name,email,spotify,soundcloud,website,linktree,source_post,status";
  const body = rows.map((r) => [r.ig_username, r.full_name, r.email, r.spotify_url, r.soundcloud_url, r.website, r.linktree, r.source_post, r.lead_status].map(csvCell).join(",")).join("\n");
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(header + "\n" + body + "\n", {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="spotify-leads-${date}.csv"` },
  });
}
