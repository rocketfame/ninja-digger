/**
 * Phase 7 — Outreach (manual). Get/upsert lead_outreach. No auto-messages.
 */

import { query, pool } from "@/lib/db";

export const OUTREACH_STATUSES = [
  "not_started",
  "contacted",
  "replied",
  "declined",
  "converted",
] as const;

export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export type OutreachRow = {
  artist_id: number;
  status: string;
  contact_email: string | null;
  contact_other: string | null;
  readiness: boolean;
  updated_at: string;
};

export async function getOutreach(artistId: number): Promise<OutreachRow | null> {
  const rows = await query<OutreachRow>(
    `SELECT artist_id, status, contact_email, contact_other, readiness, updated_at::text AS updated_at
     FROM lead_outreach WHERE artist_id = $1`,
    [artistId]
  );
  return rows[0] ?? null;
}

export async function setOutreach(
  artistId: number,
  data: {
    status?: OutreachStatus | string;
    contact_email?: string | null;
    contact_other?: string | null;
    readiness?: boolean;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO lead_outreach (artist_id, status, contact_email, contact_other, readiness)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (artist_id)
     DO UPDATE SET
       status = EXCLUDED.status,
       contact_email = EXCLUDED.contact_email,
       contact_other = EXCLUDED.contact_other,
       readiness = EXCLUDED.readiness,
       updated_at = NOW()`,
    [
      artistId,
      data.status ?? "not_started",
      data.contact_email ?? null,
      data.contact_other ?? null,
      data.readiness ?? false,
    ]
  );
}
