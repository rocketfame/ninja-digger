/**
 * GET /api/segments/email/list?type=no_reply|warm|dead — JSON rows of a segment
 * (used by the dashboard dialog modal).
 */

import { NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/apiAuth";
import { getSegmentRows, type EmailSegmentType } from "@/lib/emailSegments";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TYPES: EmailSegmentType[] = ["no_reply", "warm", "dead"];

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") as EmailSegmentType | null;
  if (!type || !TYPES.includes(type)) {
    return NextResponse.json({ error: "bad type" }, { status: 400 });
  }
  const rows = await getSegmentRows(type);
  return NextResponse.json({ ok: true, rows });
}
