/**
 * GET /api/internal/validation — proof that what we send is verified.
 *
 * Answers three questions with numbers, not promises:
 *   queue     — how much of the sending queue has passed the SMTP mailbox check
 *   sent24h   — of the emails actually sent in the last 24h, how many went to a
 *               verified-live mailbox (this is the real audit line)
 *   suppressed— what each validation layer has removed so far
 *
 * The "validated base" is not a separate list: verification writes dead
 * mailboxes into email_blacklist, and every sender barrel already filters
 * `LOWER(email) NOT IN (SELECT LOWER(email) FROM email_blacklist)`. So a
 * suppressed address is physically unable to receive a send.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const QUEUE_SQL = `
  SELECT LOWER(email) email FROM sc_artists
   WHERE email IS NOT NULL AND COALESCE(sc_touch,0)=0 AND (lead_status IS NULL OR lead_status='New')
     AND COALESCE(email_status,'') NOT IN ('bounced','unsub','junk')
  UNION ALL
  SELECT LOWER(TRIM(value)) FROM artist_contacts WHERE type='email' AND COALESCE(status,'ok')='ok'
  UNION ALL
  SELECT LOWER(email) FROM radar_leads
   WHERE email IS NOT NULL AND COALESCE(touch,0)=0 AND COALESCE(status,'new') IN ('new','queued')
     AND COALESCE(email_status,'') NOT IN ('bounced','unsub','junk')
  UNION ALL
  SELECT LOWER(email) FROM spotify_leads
   WHERE email IS NOT NULL AND COALESCE(sp_touch,0)=0 AND (lead_status IS NULL OR lead_status='New')`;

export async function GET() {
  const one = async <T>(sql: string): Promise<T> =>
    pool.query(sql).then((r) => (r.rows[0] ?? {}) as T).catch(() => ({} as T));

  const queue = await one<Record<string, string>>(`
    WITH q AS (${QUEUE_SQL})
    SELECT COUNT(*) total,
           COUNT(*) FILTER (WHERE v.verdict = 'valid')     verified_live,
           COUNT(*) FILTER (WHERE v.verdict = 'catch_all') catch_all,
           COUNT(*) FILTER (WHERE v.verdict = 'unknown')   unverifiable,
           COUNT(*) FILTER (WHERE v.email IS NULL)         not_checked_yet
      FROM q LEFT JOIN email_verification v ON v.email = q.email`);

  const sent24h = await one<Record<string, string>>(`
    SELECT COUNT(*) sent,
           COUNT(*) FILTER (WHERE v.verdict = 'valid')     to_verified_live,
           COUNT(*) FILTER (WHERE v.verdict = 'catch_all') to_catch_all,
           COUNT(*) FILTER (WHERE v.verdict = 'unknown')   to_unverifiable,
           COUNT(*) FILTER (WHERE v.email IS NULL)         to_unchecked,
           COUNT(*) FILTER (WHERE v.verdict = 'invalid')   to_dead_LEAK
      FROM outreach_events o
      LEFT JOIN email_verification v ON v.email = LOWER(o.contact_value)
     WHERE o.channel='email' AND o.template_id LIKE '%\\_touch\\_%'
       AND o.sent_at > now() - interval '24 hours'`);

  const suppressed = await pool.query<{ layer: string; n: string }>(`
    SELECT CASE
             WHEN reason LIKE '%smtp: mailbox%' THEN 'smtp_mailbox_dead'
             WHEN reason LIKE 'junk:%'          THEN 'policy_junk_role'
             WHEN reason LIKE 'brevo:%'         THEN 'brevo_bounce_unsub'
             WHEN reason LIKE 'opt-out%'        THEN 'lead_opted_out'
             ELSE 'other' END layer,
           COUNT(*) n
      FROM email_blacklist GROUP BY 1 ORDER BY 2 DESC`).then((r) => r.rows).catch(() => []);

  // Proof of the no-double-contact rule: handed-over addresses must receive
  // zero cold mail while the marketing side owns them.
  const handover = await one<Record<string, string>>(`
    SELECT COUNT(*) handed_over,
           COUNT(*) FILTER (WHERE outcome IS NULL) awaiting_outcome,
           COUNT(*) FILTER (WHERE outcome = 'cold') released_back,
           (SELECT COUNT(*) FROM outreach_events o
             JOIN lead_exports le ON le.email = LOWER(o.contact_value)
            WHERE o.channel='email' AND o.template_id LIKE '%\\_touch\\_%'
              AND o.sent_at > le.exported_at AND COALESCE(le.outcome,'') <> 'cold') cold_mail_after_handover_LEAK
      FROM lead_exports`);

  const lastRun = await one<{ at: string; checked: string }>(
    `SELECT MAX(checked_at) at, COUNT(*) checked FROM email_verification WHERE checked_at > now() - interval '24 hours'`
  );

  const num = (v: unknown) => Number(v ?? 0);
  const qTotal = num(queue.total);
  const qChecked = qTotal - num(queue.not_checked_yet);
  const sTotal = num(sent24h.sent);

  return NextResponse.json({
    queue: {
      ...queue,
      coverage_pct: qTotal ? Number(((100 * qChecked) / qTotal).toFixed(1)) : 0,
    },
    sent24h: {
      ...sent24h,
      // Every send must be to a non-suppressed address; a non-zero LEAK means a
      // barrel bypassed the blacklist filter and needs fixing.
      verified_pct: sTotal ? Number(((100 * num(sent24h.to_verified_live)) / sTotal).toFixed(1)) : 0,
    },
    suppressed,
    handover,
    verification_last_24h: { addresses_checked: num(lastRun.checked), last_check: lastRun.at ?? null },
    note: "Dead mailboxes go to email_blacklist; every sender barrel filters against it, so a suppressed address cannot be sent to.",
    ts: new Date().toISOString(),
  });
}
