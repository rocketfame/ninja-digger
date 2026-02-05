/**
 * GET: fetch lead profile (status, notes).
 * PATCH: update status and/or notes.
 */

import { NextResponse } from "next/server";
import { query, pool } from "@/lib/db";

type LeadProfileRow = {
  artist_beatport_id: string;
  status: string;
  notes: string | null;
  updated_at: string;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ artistId: string }> }
) {
  const { artistId } = await params;
  if (!artistId) {
    return NextResponse.json({ error: "artistId required" }, { status: 400 });
  }
  try {
    const rows = await query<LeadProfileRow>(
      `SELECT artist_beatport_id, status, notes, updated_at::text AS updated_at
       FROM lead_profiles WHERE artist_beatport_id = $1`,
      [artistId]
    );
    const profile = rows[0] ?? null;
    if (!profile) {
      return NextResponse.json({ profile: null });
    }
    return NextResponse.json({
      profile: {
        artist_beatport_id: profile.artist_beatport_id,
        status: profile.status,
        notes: profile.notes,
        updated_at: profile.updated_at,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ artistId: string }> }
) {
  const { artistId } = await params;
  if (!artistId) {
    return NextResponse.json({ error: "artistId required" }, { status: 400 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const status = typeof body?.status === "string" ? body.status.trim() : undefined;
    const notes = body?.notes !== undefined ? (typeof body.notes === "string" ? body.notes : null) : undefined;

    const allowed = ["New", "Contacted", "In Progress", "Won", "Lost"];
    if (status !== undefined && !allowed.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    if (status === undefined && notes === undefined) {
      return NextResponse.json({ error: "Provide status and/or notes" }, { status: 400 });
    }

    const existing = await query<LeadProfileRow>(
      `SELECT artist_beatport_id, status, notes, updated_at::text AS updated_at
       FROM lead_profiles WHERE artist_beatport_id = $1`,
      [artistId]
    );
    const current = existing[0];
    const newStatus = status ?? current?.status ?? "New";
    const newNotes = notes !== undefined ? notes : (current?.notes ?? null);

    await pool.query(
      `INSERT INTO lead_profiles (artist_beatport_id, status, notes, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (artist_beatport_id) DO UPDATE SET
         status = EXCLUDED.status,
         notes = EXCLUDED.notes,
         updated_at = now()`,
      [artistId, newStatus, newNotes]
    );
    const rows = await query<LeadProfileRow>(
      `SELECT artist_beatport_id, status, notes, updated_at::text AS updated_at
       FROM lead_profiles WHERE artist_beatport_id = $1`,
      [artistId]
    );
    const profile = rows[0];
    return NextResponse.json({
      profile: profile
        ? {
            artist_beatport_id: profile.artist_beatport_id,
            status: profile.status,
            notes: profile.notes,
            updated_at: profile.updated_at,
          }
        : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
