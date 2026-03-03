/**
 * Outreach events API
 * POST: create event, update lead_profiles status
 * GET: list events for artist
 * PATCH: update event outcome
 */

import { NextResponse } from "next/server";
import { query, pool } from "@/lib/db";

const TEMPLATE_TO_STATUS: Record<string, string> = {
  email_touch_1: "Attempt 1",
  email_touch_2: "Attempt 2",
  email_touch_3: "No Response",
  social_dm: "Attempt 1",
};

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const artistId = typeof body?.artistId === "string" ? body.artistId.trim() : null;
    const channel = typeof body?.channel === "string" ? body.channel.trim() : null;
    const templateId = typeof body?.templateId === "string" ? body.templateId.trim() : null;
    const contactValue = typeof body?.contactValue === "string" ? body.contactValue.trim() : null;
    const notes = typeof body?.notes === "string" ? body.notes.trim() : null;

    if (!artistId || !channel) {
      return NextResponse.json({ error: "artistId and channel required" }, { status: 400 });
    }

    const insert = await pool.query<{ id: number }>(
      `INSERT INTO outreach_events (artist_beatport_id, channel, template_id, contact_value, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [artistId, channel, templateId ?? null, contactValue ?? null, notes ?? null]
    );
    const id = insert.rows[0]?.id;
    if (id == null) {
      return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    }

    const newStatus = templateId ? TEMPLATE_TO_STATUS[templateId] : null;
    if (newStatus) {
      await pool.query(
        `UPDATE lead_profiles SET status = $1, updated_at = now()
         WHERE artist_beatport_id = $2 AND (status IS NULL OR status = 'New')`,
        [newStatus, artistId]
      );
    }

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const artistId = searchParams.get("artistId");
    if (!artistId) {
      return NextResponse.json({ error: "artistId required" }, { status: 400 });
    }

    const rows = await query<{
      id: number;
      artist_beatport_id: string;
      channel: string;
      template_id: string | null;
      contact_value: string | null;
      sent_at: string;
      opened_at: string | null;
      replied_at: string | null;
      outcome: string;
      notes: string | null;
      metadata: unknown;
    }>(
      `SELECT id, artist_beatport_id, channel, template_id, contact_value,
              sent_at::text AS sent_at, opened_at::text AS opened_at, replied_at::text AS replied_at,
              outcome, notes, metadata
       FROM outreach_events
       WHERE artist_beatport_id = $1
       ORDER BY sent_at DESC`,
      [artistId]
    );

    return NextResponse.json({ events: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === "number" ? body.id : body?.id != null ? Number(body.id) : null;
    const outcome = typeof body?.outcome === "string" ? body.outcome.trim() : null;
    const repliedAt = body?.repliedAt != null ? body.repliedAt : null;
    const openedAt = body?.openedAt != null ? body.openedAt : null;

    if (id == null || !Number.isInteger(id)) {
      return NextResponse.json({ error: "id required (number)" }, { status: 400 });
    }

    const updates: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (outcome !== null) {
      updates.push(`outcome = $${idx++}`);
      params.push(outcome);
    }
    if (repliedAt !== undefined) {
      updates.push(`replied_at = $${idx++}`);
      params.push(repliedAt);
    }
    if (openedAt !== undefined) {
      updates.push(`opened_at = $${idx++}`);
      params.push(openedAt);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "Provide outcome, repliedAt, or openedAt" }, { status: 400 });
    }

    params.push(id);
    await pool.query(
      `UPDATE outreach_events SET ${updates.join(", ")} WHERE id = $${idx}`,
      params
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
