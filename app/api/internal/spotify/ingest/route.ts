/**
 * POST /api/internal/spotify/ingest — receives Instagram commenters (harvested
 * from a logged-in browser session on a promo Reel) and upserts them as Spotify
 * leads. CORS-open so the instagram.com page can POST directly (bookmarklet).
 * Body: { post: string, commenters: [{ username, full_name?, comment? }] }
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
export function OPTIONS() { return new NextResponse(null, { headers: CORS }); }

// Image-beacon ingest: bypasses Instagram's CSP (which blocks fetch/XHR to our
// domain but allows img-src). Browser sends `new Image().src=?u=user1,user2&post=`.
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const post = sp.get("post");
  const usernames = (sp.get("u") || "").split(",").map((s) => s.trim().replace(/^@/, "").toLowerCase()).filter((x) => x && x.length <= 60);
  for (const username of usernames) {
    await pool.query(
      `INSERT INTO spotify_leads (ig_username, source_post, lead_status) VALUES ($1,$2,'New')
       ON CONFLICT (ig_username) DO UPDATE SET source_post = COALESCE(spotify_leads.source_post, EXCLUDED.source_post), updated_at = now()`,
      [username, post]
    ).catch(() => {});
  }
  return new NextResponse(GIF, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store", ...CORS } });
}

type Commenter = { username?: string; full_name?: string; comment?: string };

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const post = typeof body.post === "string" ? body.post : null;
  const items: Commenter[] = Array.isArray(body.commenters) ? body.commenters : [];
  if (items.length === 0) return NextResponse.json({ ok: false, error: "no commenters" }, { status: 400, headers: CORS });

  let upserted = 0;
  for (const c of items) {
    const username = String(c.username ?? "").trim().replace(/^@/, "").toLowerCase();
    if (!username || username.length > 60) continue;
    const res = await pool.query(
      `INSERT INTO spotify_leads (ig_username, full_name, source_post, comment_text, lead_status)
       VALUES ($1,$2,$3,$4,'New')
       ON CONFLICT (ig_username) DO UPDATE SET
         full_name = COALESCE(spotify_leads.full_name, EXCLUDED.full_name),
         source_post = COALESCE(spotify_leads.source_post, EXCLUDED.source_post),
         comment_text = COALESCE(spotify_leads.comment_text, EXCLUDED.comment_text),
         updated_at = now()`,
      [username, c.full_name ?? null, post, (c.comment ?? "").slice(0, 500) || null]
    );
    upserted += res.rowCount ?? 0;
  }
  const total = (await pool.query<{ c: number }>(`SELECT COUNT(*)::int c FROM spotify_leads`)).rows[0]?.c ?? 0;
  return NextResponse.json({ ok: true, received: items.length, upserted, total }, { headers: CORS });
}
