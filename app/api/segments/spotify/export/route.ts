import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function csvCell(v: string | null): string {
  const s = v ?? "";
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const withEmail = sp.get("withEmail") === "1";
  const isJson = sp.get("format") === "json";
  const limit = isJson ? Math.min(parseInt(sp.get("limit") || "200", 10) || 200, 500) : 20000;
  const where = withEmail ? "WHERE email IS NOT NULL" : "";
  const rows = (await pool.query(
    `SELECT ig_username, full_name, email, email_source, followers, spotify_url, soundcloud_url, website, linktree, source_post, lead_status
     FROM spotify_leads ${where} ORDER BY (email IS NOT NULL) DESC, followers DESC NULLS LAST, created_at DESC LIMIT ${limit}`
  ).catch(() => ({ rows: [] }))).rows;

  if (isJson) {
    const total = (await pool.query<{ c: number }>(`SELECT COUNT(*)::int c FROM spotify_leads ${where}`).catch(() => ({ rows: [{ c: 0 }] }))).rows[0]?.c ?? 0;
    const SRC: Record<string, string> = { link_crawl: "з лінку", ig_bio: "з біо", business: "бізнес-email" };
    return NextResponse.json({
      total,
      rows: rows.map((r) => ({
        name: r.full_name || r.ig_username,
        handle: "@" + r.ig_username,
        link: `https://instagram.com/${r.ig_username}`,
        email: r.email,
        followers: r.followers ?? 0,
        spotify: r.spotify_url || "",
        soundcloud: r.soundcloud_url || "",
        site: r.website || r.linktree || "",
        source: r.email_source ? (SRC[r.email_source] ?? r.email_source) : "",
      })),
    });
  }

  const header = "ig_username,full_name,email,spotify,soundcloud,website,linktree,source_post,status";
  const body = rows.map((r) => [r.ig_username, r.full_name, r.email, r.spotify_url, r.soundcloud_url, r.website, r.linktree, r.source_post, r.lead_status].map(csvCell).join(",")).join("\n");
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(header + "\n" + body + "\n", {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="spotify-leads-${date}.csv"` },
  });
}
