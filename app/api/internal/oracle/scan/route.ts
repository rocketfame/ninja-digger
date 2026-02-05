/**
 * Oracle Mode: one-off scan of a chart/source URL.
 * POST body: { url: string }
 * Returns: { ok, source?, type?, artists?, chartCount?, genre?, sourceUrl? | error }
 */

import { NextResponse } from "next/server";
import { runOracleScan } from "@/lib/oracleScan";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!url) {
      return NextResponse.json(
        { ok: false, error: "URL is required." },
        { status: 400 }
      );
    }
    const result = await runOracleScan(url);
    if (result.ok) {
      return NextResponse.json(result);
    }
    return NextResponse.json(result, { status: 422 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
