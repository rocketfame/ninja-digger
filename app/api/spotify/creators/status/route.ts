/** POST /api/spotify/creators/status — approve/skip a discovered creator. */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

const ALLOWED = ["candidate", "approved", "parsed", "skipped"];

export async function POST(request: Request) {
  const { username, status } = await request.json().catch(() => ({}));
  const u = String(username ?? "").trim().toLowerCase();
  if (!u || !ALLOWED.includes(status)) return NextResponse.json({ ok: false, error: "bad input" }, { status: 400 });
  await pool.query(`UPDATE spotify_creators SET status=$2, updated_at=now() WHERE ig_username=$1`, [u, status]).catch(() => {});
  return NextResponse.json({ ok: true });
}
