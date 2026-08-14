/**
 * One-off historical inbox sweep (default 120 days): harvest old bounces and
 * opt-out replies into the DB segments. No Telegram notifications.
 * Usage: node scripts/inbox-backfill.mjs [daysBack]
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
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const OPT_OUT_RE = /(not interested|no,? thanks?|not for me|stop (emailing|contacting|sending)|unsubscribe|remove (me|us)|take (me|us) off|don'?t (contact|email|write)|no longer interested|leave (me|us) alone|не цікаво|не интересно|nicht interessiert|kein interesse|no me interesa|pas intéressé)/i;
const AUTO_REPLY_RE = /^(automatic reply|auto.?reply|autosvar|out of office|ooo[:\s]|abwesenheit|réponse automatique|respuesta automática|delivery status|undeliverable|vacation)/i;
const FILE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|css|js)$/i;

const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
await client.connect();
const lock = await client.getMailboxLock("INBOX");

let bounced = 0, optOuts = 0, scanned = 0;
const bounceUids = [];
const humanReplies = []; // { addr, uid }

try {
  const since = new Date(Date.now() - DAYS * 86400e3);
  for await (const msg of client.fetch({ since }, { envelope: true, uid: true })) {
    scanned++;
    const fromAddr = msg.envelope?.from?.[0]?.address?.toLowerCase() ?? "";
    const fromName = msg.envelope?.from?.[0]?.name ?? "";
    const subject = msg.envelope?.subject ?? "";
    if (!fromAddr) continue;
    if (BOUNCE_FROM_RE.test(fromAddr) || BOUNCE_FROM_RE.test(fromName)) bounceUids.push(msg.uid);
    else if (fromAddr !== user.toLowerCase() && !AUTO_REPLY_RE.test(subject.trim())) humanReplies.push({ addr: fromAddr, uid: msg.uid });
  }
  console.log(`[sweep] scanned ${scanned} messages: ${bounceUids.length} bounce candidates, ${humanReplies.length} human senders`);

  // Bounces → invalidate extracted addresses
  for (const uid of bounceUids) {
    const dl = await client.download(String(uid), undefined, { uid: true }).catch(() => null);
    if (!dl?.content) continue;
    const chunks = [];
    for await (const c of dl.content) chunks.push(c);
    const body = Buffer.concat(chunks).toString("utf8").slice(0, 50000);
    const found = new Set(
      (body.match(EMAIL_RE) ?? [])
        .map((e) => e.toLowerCase())
        .filter((e) => e !== user.toLowerCase() && !BOUNCE_FROM_RE.test(e) && !e.includes("googlemail.com") && !e.includes("google.com") && !FILE_EXT_RE.test(e))
    );
    for (const email of found) {
      const r = await pool.query(
        `UPDATE artist_contacts SET status='bounced' WHERE type='email' AND LOWER(TRIM(value)) = $1 AND status != 'bounced'`,
        [email]
      );
      if ((r.rowCount ?? 0) > 0) { bounced += r.rowCount; console.log(`  bounced: ${email}`); }
    }
  }

  // Opt-outs: only for senders matching known contacts, check body text
  const knownSet = new Set(
    (await pool.query(`SELECT DISTINCT LOWER(TRIM(value)) v FROM artist_contacts WHERE type='email'`)).rows.map((r) => r.v)
  );
  for (const { addr, uid } of humanReplies) {
    if (!knownSet.has(addr)) continue;
    const dl = await client.download(String(uid), "1", { uid: true }).catch(() => null);
    if (!dl?.content) continue;
    const chunks = [];
    for await (const c of dl.content) chunks.push(c);
    const text = Buffer.concat(chunks).toString("utf8").slice(0, 5000);
    if (!OPT_OUT_RE.test(text)) continue;
    await pool.query(
      `INSERT INTO email_blacklist (email, reason) VALUES ($1, 'opt-out (historical sweep)') ON CONFLICT (email) DO NOTHING`,
      [addr]
    );
    await pool.query(
      `UPDATE lead_profiles lp SET status='Not Interested', updated_at=now()
       FROM artist_contacts ac
       WHERE ac.artist_beatport_id = lp.artist_beatport_id AND ac.type='email' AND LOWER(TRIM(ac.value)) = $1
         AND lp.status NOT IN ('Won','In Progress')`,
      [addr]
    );
    optOuts++;
    console.log(`  opt-out: ${addr}`);
  }
} finally {
  lock.release();
}
await client.logout();
console.log(`[done] bounced marked: ${bounced}, opt-outs: ${optOuts}`);
await pool.end();
