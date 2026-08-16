/**
 * One-off gold harvest: scan messages from known lead contacts (auto-replies
 * AND real replies) over N days, extract emails from bodies, classify roles,
 * add NEW contacts to the leads. Usage: node scripts/ooo-harvest-backfill.mjs [daysBack]
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

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const BOUNCE_FROM_RE = /^(mailer-daemon|postmaster|mail delivery)/i;
const JUNK_EMAIL_RE = /(no-?reply|donotreply|notifications?@|@.*\.(png|jpg|gif)$|googlemail\.com|google\.com|@example\.|sentry|cloudflare|w3\.org|@promosoundgroup)/i;
const FILE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|css|js)$/i;

function detectRole(bodyLower, email, artistName) {
  const idx = bodyLower.indexOf(email);
  const before = idx > 0 ? bodyLower.slice(Math.max(0, idx - 48), idx) : "";
  if (/booking/.test(before)) return "booking";
  if (/manag|mgmt/.test(before)) return "management";
  if (/paperwork|admin|account|invoice|advanc/.test(before)) return "generic";
  if (/press|promo|demo/.test(before)) return "booking";
  const local = email.split("@")[0];
  const domain = email.split("@")[1] ?? "";
  const name = (artistName ?? "").toLowerCase().replace(/^dj\s+/, "");
  const parts = name.split(/\s+/).filter((p) => p.length >= 2);
  if (parts.some((p) => local.includes(p) || domain.includes(p))) return "personal";
  if (/booking|book@/.test(local)) return "booking";
  if (/manag|mgmt/.test(local + domain)) return "management";
  if (/^(info|contact|hello|mail|office)$/.test(local)) return "generic";
  return "unknown";
}

// Known lead contacts
const known = await pool.query(
  `SELECT DISTINCT LOWER(TRIM(ac.value)) AS email, ac.artist_beatport_id, am.artist_name
   FROM artist_contacts ac
   LEFT JOIN artist_metrics am ON am.artist_beatport_id = ac.artist_beatport_id
   WHERE ac.type = 'email'`
);
const knownByEmail = new Map(known.rows.map((r) => [r.email, r]));
const existingByArtist = new Map();
for (const r of known.rows) {
  if (!existingByArtist.has(r.artist_beatport_id)) existingByArtist.set(r.artist_beatport_id, new Set());
  existingByArtist.get(r.artist_beatport_id).add(r.email);
}

const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
await client.connect();
const lock = await client.getMailboxLock("INBOX");

const findings = []; // {artist, name, email, role, fromAuto}
try {
  const since = new Date(Date.now() - DAYS * 86400e3);
  const candidates = [];
  for await (const msg of client.fetch({ since }, { envelope: true, uid: true })) {
    const fromAddr = msg.envelope?.from?.[0]?.address?.toLowerCase() ?? "";
    if (!fromAddr || fromAddr === user.toLowerCase() || BOUNCE_FROM_RE.test(fromAddr)) continue;
    const lead = knownByEmail.get(fromAddr);
    if (!lead) continue;
    candidates.push({ uid: msg.uid, fromAddr, lead, subject: (msg.envelope?.subject ?? "").trim() });
  }
  console.log(`[harvest] листів від відомих лідів: ${candidates.length}`);

  for (const c of candidates) {
    const dl = await client.download(String(c.uid), "1", { uid: true }).catch(() => null);
    if (!dl?.content) continue;
    const chunks = [];
    for await (const ch of dl.content) chunks.push(ch);
    let body = Buffer.concat(chunks).toString("utf8").slice(0, 8000)
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-F]{2})/g, (_, h) => { try { return Buffer.from(h, "hex").toString("utf8"); } catch { return ""; } })
      .replace(/<[^>]+>/g, " ");
    const bodyLower = body.toLowerCase();
    const emails = [...new Set((bodyLower.match(EMAIL_RE) ?? []))]
      .filter((e) => e !== c.fromAddr && e !== user.toLowerCase() && !JUNK_EMAIL_RE.test(e) && !FILE_EXT_RE.test(e));
    for (const email of emails) {
      const already = existingByArtist.get(c.lead.artist_beatport_id)?.has(email);
      if (already) continue;
      const role = detectRole(bodyLower, email, c.lead.artist_name);
      const conf = role === "booking" || role === "personal" || role === "management" ? 0.8 : 0.6;
      await pool.query(
        `INSERT INTO artist_contacts (artist_beatport_id, type, value, confidence, status, email_type, source_context)
         VALUES ($1, 'email', $2, $3, 'ok', $4, 'reply-body harvest')
         ON CONFLICT (artist_beatport_id, type, LOWER(TRIM(value))) DO NOTHING`,
        [c.lead.artist_beatport_id, email, conf, role]
      ).catch(() => {});
      existingByArtist.get(c.lead.artist_beatport_id)?.add(email);
      findings.push({ artist: c.lead.artist_beatport_id, name: c.lead.artist_name, email, role, subject: c.subject.slice(0, 40) });
    }
  }
} finally {
  lock.release();
}
await client.logout();

const order = { booking: 0, personal: 1, management: 2, generic: 3, unknown: 4 };
findings.sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9) || (a.name ?? "").localeCompare(b.name ?? ""));
console.log(`\n[GOLD] нових контактів: ${findings.length}`);
for (const f of findings) console.log(`  [${f.role}] ${f.name ?? f.artist} → ${f.email}  (з: "${f.subject}")`);
await pool.end();
