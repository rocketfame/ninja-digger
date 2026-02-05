/**
 * Oracle Mode: one-off scan of a chart/source URL.
 * POST body: { url: string, segmentName?: string, notes?: string }
 * Returns: { ok?, source, chartMeta, items[], counts | error }
 */

import { NextResponse } from "next/server";
import { runOracleScan } from "@/lib/oracleScan";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!url) {
      return NextResponse.json(
        { ok: false, error: "URL is required." },
        { status: 400 }
      );
    }

    if (process.env.NODE_ENV !== "test") {
      console.log("[oracle/scan] URL:", url);
    }
    const result = await runOracleScan(url);

    if (result.ok) {
      if (process.env.NODE_ENV !== "test") {
        console.log("[oracle/scan] source:", result.source, "counts:", result.counts);
      }
      return NextResponse.json({
        ok: true,
        source: result.source,
        chartMeta: result.chartMeta,
        items: result.items,
        counts: result.counts,
      });
    }

    if (process.env.NODE_ENV !== "test") {
      console.log("[oracle/scan] error:", result.error);
    }
    return NextResponse.json(result, { status: 422 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (process.env.NODE_ENV !== "test") {
      console.error("[oracle/scan] exception:", message);
    }
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
