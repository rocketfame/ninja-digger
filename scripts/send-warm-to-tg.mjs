/**
 * One-off: fetch each warm lead's latest reply text from Gmail and push it to
 * the Telegram bot (with tg_notifications mapping so swipe-reply works).
 * Flags negative context. No status changes.
 */
import { config } from "dotenv";
import { ImapFlow } from "imapflow";
import pg from "pg";

config({ path: ".env.local" });
config();

const user = process.env.GMAIL_USER;
const pass = process.env.GMAIL_APP_PASSWORD;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 4 });

const NEGATIVE_RE = /(not interested|no,? thanks?|not for me|stop (emailing|contacting|sending)|unsubscribe|remove (me|us)|take (me|us) off|don'?t (contact|email|write)|no longer interested|leave (me|us) alone|spam|how did you get|delete my|gdpr|fuck|piss off|never (email|contact)|report(ing)? you)/i;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function cleanText(raw) {
  let text = raw
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_, h) => { try { return Buffer.from(h, "hex").toString("utf8"); } catch { return ""; } })
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const quoteIdx = text.search(/\nOn .{5,80} wrote:|\n>{1,2} /);
  if (quoteIdx > 40) text = text.slice(0, quoteIdx).trim();
  return text.slice(0, 800);
}

async function sendTg(text) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const data = await res.json();
  return data.ok ? data.result.message_id : null;
}

const warm = await pool.query(
  `SELECT DISTINCT ON (lp.artist_beatport_id)
          lp.artist_beatport_id, am.artist_name, LOWER(TRIM(ac.value)) AS email, lp.status
   FROM lead_profiles lp
   JOIN artist_contacts ac ON ac.artist_beatport_id = lp.artist_beatport_id
   LEFT JOIN artist_metrics am ON am.artist_beatport_id = lp.artist_beatport_id
   WHERE lp.status IN ('Responded', 'In Progress') AND ac.type = 'email'
     AND lp.artist_beatport_id != 'test-lead-001'
   ORDER BY lp.artist_beatport_id, ac.confidence DESC`
);
console.log(`warm leads: ${warm.rows.length}`);

const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
await client.connect();
const lock = await client.getMailboxLock("INBOX");
const STATUS_UA = { "Responded": "Відповів", "In Progress": "В діалозі" };

try {
  const since = new Date(Date.now() - 120 * 86400e3);
  for (const row of warm.rows) {
    const uids = await client.search({ from: row.email, since }, { uid: true }).catch(() => []);
    if (!uids || uids.length === 0) { console.log(`  no mail found: ${row.email}`); continue; }
    const uid = uids[uids.length - 1];
    let subject = "";
    for await (const m of client.fetch(String(uid), { envelope: true, uid: true }, { uid: true })) {
      subject = (m.envelope?.subject ?? "").trim();
    }
    let text = "";
    const dl = await client.download(String(uid), "1", { uid: true }).catch(() => null);
    if (dl?.content) {
      const chunks = [];
      for await (const c of dl.content) chunks.push(c);
      text = cleanText(Buffer.concat(chunks).toString("utf8"));
    }
    const negative = NEGATIVE_RE.test(text);
    const name = row.artist_name ?? row.artist_beatport_id;
    const msgId = await sendTg(
      `${negative ? "⚠️" : "💬"} <b>Історична відповідь ліда</b> · <i>${STATUS_UA[row.status] ?? row.status}</i>\n\n` +
      `🎧 <b>${esc(name)}</b>\n📧 ${esc(row.email)}\n` +
      (subject ? `✉️ ${esc(subject)}\n` : "") +
      (text ? `\n<blockquote>${esc(text)}</blockquote>\n` : "\n<i>(текст не витягнувся — глянь у Gmail)</i>\n") +
      (negative ? `\n⚠️ <b>Схоже на негатив/прохання не писати — перевір!</b>\n` : "") +
      `\n↩️ <i>Reply на це повідомлення = відповісти артисту на email.</i>`
    );
    if (msgId != null) {
      await pool.query(
        `INSERT INTO tg_notifications (tg_message_id, artist_beatport_id, artist_name, email, subject)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tg_message_id) DO NOTHING`,
        [msgId, row.artist_beatport_id, row.artist_name, row.email, subject || null]
      );
      console.log(`  sent to TG: ${name}${negative ? " [NEGATIVE?]" : ""}`);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
} finally {
  lock.release();
}
await client.logout();
await pool.end();
console.log("[done]");
