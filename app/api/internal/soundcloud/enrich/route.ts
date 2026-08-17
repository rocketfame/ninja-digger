/**
 * POST /api/internal/soundcloud/enrich — walk the public funnel (bio links,
 * Linktree, website) for email-less SC artists and fill their contact email.
 */
import { NextResponse } from "next/server";
import { enrichScBatch } from "@/lib/soundcloudEnrich";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST() {
  const r = await enrichScBatch(8);
  return NextResponse.json({ ok: true, ...r });
}
