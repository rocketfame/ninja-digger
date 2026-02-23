/**
 * POST /api/internal/enrich/flag
 * Flag a link or contact as incorrect, or unflag it.
 *
 * Body: { table: "link" | "contact", id: string, flagged: boolean }
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { table, id, flagged } = body as {
      table: "link" | "contact";
      id: string;
      flagged: boolean;
    };

    if (!table || !id || typeof flagged !== "boolean") {
      return NextResponse.json({ error: "table, id, flagged required" }, { status: 400 });
    }

    const tableName = table === "link" ? "artist_links" : "artist_contacts";
    const newStatus = flagged ? "flagged" : "ok";

    await pool.query(
      `UPDATE ${tableName} SET status = $1 WHERE id = $2`,
      [newStatus, id]
    );

    return NextResponse.json({ ok: true, status: newStatus });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
