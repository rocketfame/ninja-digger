/**
 * POST /api/internal/ra/scrape
 * Scrape RA events for the next 6 weeks, save events + promoters to DB.
 */
import { NextResponse } from "next/server";
import { scrapeAndSaveRAEvents } from "@/lib/raEvents";

export const maxDuration = 120;

export async function POST() {
  try {
    const result = await scrapeAndSaveRAEvents();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// GET handler for Vercel Cron
export async function GET() { return POST(); }
