/**
 * POST /api/internal/soundcloud/seed  body: { url } — add a seed account.
 * Then harvest its first pages immediately.
 */
import { NextResponse } from "next/server";
import { addSeed, harvestSeedFollowers } from "@/lib/soundcloud";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url : "";
  if (!url.trim()) return NextResponse.json({ ok: false, error: "url required" }, { status: 400 });

  const added = await addSeed(url);
  if (!added.ok) return NextResponse.json(added, { status: 400 });

  const harvest = await harvestSeedFollowers(added.permalink!, 4);
  return NextResponse.json({ ok: true, permalink: added.permalink, followers: added.followers, ...harvest });
}
