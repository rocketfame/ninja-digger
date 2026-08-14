/**
 * One-off historical REPLY sweep: senders matching known lead contacts within
 * N days → lead_profiles 'Responded' + outreach_event 'replied'.
 * Auto-replies and opt-outs are skipped (opt-outs were handled separately).
 * No Telegram notifications. Usage: node scripts/reply-backfill.mjs [daysBack]
 */
import { config } from "dotenv";
import { ImapFlow } from "imapflow";
import pg from "pg";

config({ path: ".env.local" });
config();

const DAYS = parseInt(process.argv[2] || "120", 10);
const user = process.env.GMAIL_USER;
const pass = process.env.GMAIL_APP_PASSWORD;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 4 });

const BOUNCE_FROM_RE = /^(mailer-daemon|postmaster|mail delivery (subsystem|system))/i;
const AUTO_REPLY_RE = /^(automatic reply|auto.?reply|autosvar|out of office|ooo[:\s]|abwesenheit|réponse automatique|respuesta automática|delivery status|undeliverable|vacation|email acknowledgement)/i;
const OPT_OUT_RE = /(not interested|no,? thanks?|not for me|stop (emailing|contacting|sending)|unsubscribe|remove (me|us)|take (me|us) off|don'?t (contact|email|write)|no longer interested|leave (me|us) alone)/i;
const REPLYABLE = ["Attempt 1", "Attempt 2", "No Response", "Cold", "Contacted"];

const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
await client.connect();
const lock = await client.getMailboxLock("INBOX");

const senders = new Map(); // addr -> earliest subject
try {
  const since = new Date(Date.now() - DAYS * 86400e3);
  for await (const msg of client.fetch({ since }, { envelope: true, uid: true })) {
    const fromAddr = msg.envelope?.from?.[0]?.address?.toLowerCase() ?? "";
    const fromName = msg.envelope?.from?.[0]?.name ?? "";
    const subject = (msg.envelope?.subject ?? "").trim();
    if (!fromAddr || fromAddr === user.toLowerCase()) continue;
    if (BOUNCE_FROM_RE.test(fromAddr) || BOUNCE_FROM_RE.test(fromName)) continue;
    if (AUTO_REPLY_RE.test(subject)) continue;
    if (!senders.has(fromAddr)) senders.set(fromAddr, { subject, uid: msg.uid });
  }
} finally {
  lock.release();
}
console.log(`[reply-sweep] unique human senders in ${DAYS}d: ${senders.size}`);

const known = await pool.query(
  `SELECT DISTINCT ac.artist_beatport_id, LOWER(TRIM(ac.value)) AS email, am.artist_name, lp.status
   FROM artist_contacts ac
   JOIN lead_profiles lp ON lp.artist_beatport_id = ac.artist_beatport_id
   LEFT JOIN artist_metrics am ON am.artist_beatport_id = ac.artist_beatport_id
   WHERE ac.type = 'email' AND lp.status = ANY($1::text[])
     AND LOWER(TRIM(ac.value)) = ANY($2::text[])`,
  [REPLYABLE, [...senders.keys()]]
);
console.log(`[reply-sweep] matched known lead contacts: ${known.rows.length}`);

let updated = 0;
const optOutAddrs = [];
for (const row of known.rows) {
  const meta = senders.get(row.email);
  // opt-out double-check on body (skip marking as warm if it's a rejection)
  const lockB = await client.getMailboxLock("INBOX");
  let text = "";
  try {
    const dl = await client.download(String(meta.uid), "1", { uid: true }).catch(() => null);
    if (dl?.content) {
      const chunks = [];
      for await (const c of dl.content) chunks.push(c);
      text = Buffer.concat(chunks).toString("utf8").slice(0, 4000);
    }
  } finally {
    lockB.release();
  }
  if (OPT_OUT_RE.test(text)) { optOutAddrs.push(row.email); continue; }

  const r = await pool.query(
    `UPDATE lead_profiles SET status = 'Responded', updated_at = now()
     WHERE artist_beatport_id = $1 AND status = ANY($2::text[])`,
    [row.artist_beatport_id, REPLYABLE]
  );
  if ((r.rowCount ?? 0) > 0) {
    await pool.query(
      `INSERT INTO outreach_events (artist_beatport_id, template_id, channel, contact_value, sent_at, outcome)
       VALUES ($1, 'reply', 'email', $2, now(), 'replied')`,
      [row.artist_beatport_id, row.email]
    ).catch(() => {});
    updated++;
    console.log(`  responded: ${row.artist_name ?? row.artist_beatport_id} <${row.email}> "${meta.subject.slice(0, 60)}"`);
  }
}
for (const addr of optOutAddrs) {
  await pool.query(`INSERT INTO email_blacklist (email, reason) VALUES ($1, 'opt-out (reply sweep)') ON CONFLICT (email) DO NOTHING`, [addr]);
  await pool.query(
    `UPDATE lead_profiles lp SET status='Not Interested', updated_at=now()
     FROM artist_contacts ac WHERE ac.artist_beatport_id = lp.artist_beatport_id
       AND ac.type='email' AND LOWER(TRIM(ac.value)) = $1 AND lp.status NOT IN ('Won','In Progress')`,
    [addr]
  );
  console.log(`  opt-out: ${addr}`);
}
await client.logout();
console.log(`[done] responded: ${updated}, opt-outs: ${optOutAddrs.length}`);
await pool.end();
