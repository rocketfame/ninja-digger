/**
 * Conversation memory for reply drafting. A reply is never just its last
 * sentence: the drafter must see what the lead wrote before, what we actually
 * sent back, and whether they already became a customer ("I just spent 50 on a
 * package"). Built from tg_notifications (excerpt / sent_reply) + outreach_events.
 */
import { pool } from "@/lib/db";

export type ThreadContext = { thread: string | null; customer: boolean; turns: number };

// Signals that the lead has already paid / ordered — after that we support, we don't sell.
const CUSTOMER_RE = /\b(i (just )?(spent|bought|purchased|paid|ordered)|i've (bought|purchased|paid|ordered)|placed (an|my) order|my order|order (number|#|id)|package deal|bought (a|the) package|already (paid|bought|purchased|ordered))\b/i;

export function looksLikeCustomer(text: string | null | undefined): boolean {
  return !!text && CUSTOMER_RE.test(text);
}

export async function getThreadContext(email: string, currentExcerpt?: string | null): Promise<ThreadContext> {
  const e = email.trim().toLowerCase();
  const rows = await pool
    .query<{ created_at: Date; excerpt: string | null; sent_reply: string | null; sent_at: Date | null; subject: string | null }>(
      `SELECT created_at, excerpt, sent_reply, sent_at, subject FROM tg_notifications
       WHERE LOWER(email) = $1 ORDER BY created_at DESC LIMIT 8`,
      [e]
    )
    .then((r) => r.rows.reverse())
    .catch(() => []);
  const touches = await pool
    .query<{ template_id: string; sent_at: Date; outcome: string | null }>(
      `SELECT template_id, sent_at, outcome FROM outreach_events
       WHERE LOWER(contact_value) = $1 AND channel = 'email' AND template_id LIKE '%\\_touch\\_%'
       ORDER BY sent_at ASC LIMIT 6`,
      [e]
    )
    .then((r) => r.rows)
    .catch(() => []);

  const fmt = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") : "");
  const lines: string[] = [];
  for (const t of touches) {
    if (t.outcome === "undelivered") continue;
    lines.push(`[${fmt(t.sent_at)}] WE sent outreach ${t.template_id.replace(/_/g, " ")}`);
  }
  let customer = looksLikeCustomer(currentExcerpt);
  for (const r of rows) {
    if (r.excerpt && r.excerpt.trim() !== (currentExcerpt ?? "").trim()) lines.push(`[${fmt(r.created_at)}] LEAD wrote: ${r.excerpt.slice(0, 500).replace(/\s+/g, " ")}`);
    if (looksLikeCustomer(r.excerpt)) customer = true;
    if (r.sent_reply) lines.push(`[${fmt(r.sent_at ?? r.created_at)}] WE replied: ${r.sent_reply.slice(0, 500).replace(/\s+/g, " ")}`);
  }
  return { thread: lines.length ? lines.join("\n") : null, customer, turns: rows.length };
}
