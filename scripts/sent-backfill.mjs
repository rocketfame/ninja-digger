/**
 * One-off SENT sweep: outgoing manual replies (In-Reply-To present) to known
 * lead contacts → lead 'In Progress' (confirmed conversation).
 * Automated touches are sent without In-Reply-To, so they don't match.
 * Usage: node scripts/sent-backfill.mjs [daysBack]
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

const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
await client.connect();

// Locate the \Sent special-use mailbox
const boxes = await client.list();
const sentBox = boxes.find((b) => b.specialUse === "\\Sent")?.path ?? "[Gmail]/Sent Mail";
console.log(`[sent-sweep] mailbox: ${sentBox}`);

const lock = await client.getMailboxLock(sentBox);
const repliedTo = new Map(); // addr -> subject
try {
  const since = new Date(Date.now() - DAYS * 86400e3);
  for await (const msg of client.fetch({ since }, { envelope: true, uid: true })) {
    const inReplyTo = msg.envelope?.inReplyTo;
    if (!inReplyTo) continue; // automated touch or fresh mail — not a thread reply
    const recipients = [...(msg.envelope?.to ?? []), ...(msg.envelope?.cc ?? [])]
      .map((a) => a.address?.toLowerCase())
      .filter(Boolean);
    const subject = (msg.envelope?.subject ?? "").trim();
    for (const addr of recipients) {
      if (addr !== user.toLowerCase() && !repliedTo.has(addr)) repliedTo.set(addr, subject);
    }
  }
} finally {
  lock.release();
}
await client.logout();
console.log(`[sent-sweep] manual thread-replies to ${repliedTo.size} unique recipients`);

const known = await pool.query(
  `SELECT DISTINCT ac.artist_beatport_id, LOWER(TRIM(ac.value)) AS email, am.artist_name, lp.status
   FROM artist_contacts ac
   JOIN lead_profiles lp ON lp.artist_beatport_id = ac.artist_beatport_id
   LEFT JOIN artist_metrics am ON am.artist_beatport_id = ac.artist_beatport_id
   WHERE ac.type = 'email' AND LOWER(TRIM(ac.value)) = ANY($1::text[])
     AND lp.status NOT IN ('Won', 'Not Interested', 'Blacklist')`,
  [[...repliedTo.keys()]]
);
console.log(`[sent-sweep] matched lead contacts: ${known.rows.length}`);

let updated = 0;
for (const row of known.rows) {
  const r = await pool.query(
    `UPDATE lead_profiles SET status = 'In Progress', updated_at = now()
     WHERE artist_beatport_id = $1 AND status NOT IN ('Won', 'Not Interested', 'Blacklist', 'In Progress')`,
    [row.artist_beatport_id]
  );
  if ((r.rowCount ?? 0) > 0) {
    updated++;
    console.log(`  in progress: ${row.artist_name ?? row.artist_beatport_id} <${row.email}> "${repliedTo.get(row.email)?.slice(0, 60)}"`);
  }
}
console.log(`[done] moved to In Progress: ${updated}`);
await pool.end();
