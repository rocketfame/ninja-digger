/**
 * POST /api/internal/blacklist — add email to blacklist
 * GET  /api/internal/blacklist — list all blacklisted emails
 * DELETE /api/internal/blacklist — remove email from blacklist
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = (body.email || "").trim().toLowerCase();
    const reason = (body.reason || "").trim() || "Manual block";

    if (!email || !email.includes("@")) {
      return NextResponse.json({ ok: false, error: "Invalid email" }, { status: 400 });
    }

    // 1. Add to blacklist
    await pool.query(
      `INSERT INTO email_blacklist (email, reason) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET reason = $2`,
      [email, reason]
    );

    // 2. Mark all matching contacts as 'blocked'
    const updated = await pool.query(
      `UPDATE ra_promoter_contacts SET status = 'blocked'
       WHERE LOWER(value) = $1 AND type = 'email' AND status != 'blocked'`,
      [email]
    );

    // 3. Also mark matching Beatport artist contacts as blocked
    const bpUpdated = await pool.query(
      `UPDATE artist_contacts SET status = 'blocked'
       WHERE LOWER(value) = $1 AND type = 'email' AND status != 'blocked'`,
      [email]
    ).catch(() => ({ rowCount: 0 }));

    return NextResponse.json({
      ok: true,
      email,
      reason,
      contactsBlocked: (updated.rowCount ?? 0) + (bpUpdated.rowCount ?? 0),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const result = await pool.query<{ id: number; email: string; reason: string; created_at: string }>(
      "SELECT id, email, reason, created_at FROM email_blacklist ORDER BY created_at DESC LIMIT 500"
    );
    return NextResponse.json({ ok: true, blacklist: result.rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const email = (body.email || "").trim().toLowerCase();
    if (!email) return NextResponse.json({ ok: false, error: "Missing email" }, { status: 400 });

    await pool.query("DELETE FROM email_blacklist WHERE email = $1", [email]);

    // Restore contacts
    await pool.query(
      `UPDATE ra_promoter_contacts SET status = 'ok'
       WHERE LOWER(value) = $1 AND type = 'email' AND status = 'blocked'`,
      [email]
    );
    await pool.query(
      `UPDATE artist_contacts SET status = 'ok'
       WHERE LOWER(value) = $1 AND type = 'email' AND status = 'blocked'`,
      [email]
    ).catch(() => {});

    return NextResponse.json({ ok: true, removed: email });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
