/**
 * One-time inbox backlog sweep: move non-delivery notices + our own [TEST] review
 * mails to Trash (reversible — Gmail keeps Trash 30 days; never expunged).
 * Dry-run by default; pass `move` as argv to actually move.
 *   node scripts/inbox-backlog-clean.mjs        # count only
 *   node scripts/inbox-backlog-clean.mjs move    # move to Trash
 */
import { readFileSync } from "node:fs";
import { ImapFlow } from "imapflow";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").replace(/^["']|["']$/g, "").trim();
const user = get("GMAIL_USER"), pass = get("GMAIL_APP_PASSWORD");
if (!user || !pass) throw new Error("GMAIL creds missing");
const DO_MOVE = process.argv[2] === "move";

// Junk categories — bounce/non-delivery DSNs (EN + Gmail UA subjects) and TEST mail.
const SUBJECT_TERMS = [
  "Повідомлення не доставлено", "не доставлено", "Не вдалося доставити", "Ще не доставлено",
  "Delivery Status Notification", "Undeliverable", "Mail delivery failed",
  "failure notice", "Returned mail", "Delivery incomplete", "[TEST",
];

const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
await client.connect();
const lock = await client.getMailboxLock("INBOX");
const uids = new Set();
try {
  // by sender (bounces)
  for (const from of ["mailer-daemon", "postmaster"]) {
    const r = await client.search({ from }, { uid: true }).catch(() => []);
    (r || []).forEach((u) => uids.add(u));
    console.log(`  from:${from} → ${(r || []).length}`);
  }
  // by subject term
  for (const term of SUBJECT_TERMS) {
    const r = await client.search({ subject: term }, { uid: true }).catch(() => []);
    (r || []).forEach((u) => uids.add(u));
    if ((r || []).length) console.log(`  subject:"${term}" → ${(r || []).length}`);
  }

  const all = [...uids];
  console.log(`\nTOTAL unique junk in INBOX: ${all.length}`);
  if (!DO_MOVE) { console.log("(dry-run — pass 'move' to Trash them)"); }
  else if (all.length) {
    const boxes = await client.list().catch(() => []);
    const trash = boxes.find((b) => b.specialUse === "\\Trash")?.path || "[Gmail]/Trash";
    let moved = 0;
    for (let i = 0; i < all.length; i += 200) {
      const batch = all.slice(i, i + 200);
      await client.messageMove(batch, trash, { uid: true }).catch((e) => console.log("batch err", e.message));
      moved += batch.length;
      console.log(`  moved ${moved}/${all.length} → ${trash}`);
    }
    console.log(`\nDONE: moved ${moved} to Trash (recoverable 30 days).`);
  }
} finally {
  lock.release();
  await client.logout();
}
