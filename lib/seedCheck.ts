/**
 * Seed-скриньки: де насправді опинився лист (user, 23.09: "роби seed-тест").
 *
 * Open rate alone cannot tell "the letter is in Spam" from "the letter is in
 * Inbox but Gmail blocked the tracking pixel" — 23.09 both looked like 1 %.
 * So every group carries a handful of our own addresses (`esputnik_seeds`),
 * and two hours after the broadcast this reads the mailbox over IMAP and says
 * which Gmail folder each seed landed in.
 *
 * Gmail exposes the folder as a label through the IMAP X-GM-LABELS extension:
 *   \\Inbox + CATEGORY_PROMOTIONS → Promotions tab (fine, but not Primary)
 *   \\Inbox alone                 → Primary (best)
 *   \\Spam                        → the warm-up is not working
 * Credentials: GMAIL_USER / GMAIL_APP_PASSWORD (the same reply inbox; seeds use
 * plus-addressing so they never look like a lead's reply).
 */
import { ImapFlow } from "imapflow";
import { pool } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import { sendTelegramMessage } from "@/lib/telegram";

export type SeedPlacement = { to: string; folder: "Primary" | "Promotions" | "Updates" | "Spam" | "Other"; subject: string };

const kyivDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(d);

function folderOf(labels: Set<string>): SeedPlacement["folder"] {
  if (labels.has("\\Junk") || labels.has("\\Spam")) return "Spam";
  if (labels.has("CATEGORY_PROMOTIONS")) return "Promotions";
  if (labels.has("CATEGORY_UPDATES")) return "Updates";
  if (labels.has("\\Inbox") || labels.has("\\Important")) return "Primary";
  return "Other";
}

/** Read the seed placements for messages that arrived since `since`. */
export async function seedPlacements(since: Date): Promise<SeedPlacement[]> {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return [];
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
  await client.connect();
  const out: SeedPlacement[] = [];
  try {
    // "[Gmail]/All Mail" holds every message whatever its folder; the labels say where it is
    const lock = await client.getMailboxLock("[Gmail]/All Mail");
    try {
      const uids = await client.search({ since, from: "psg-offers.com" }, { uid: true });
      for (const uid of (uids || []).slice(-10)) {
        const msg = await client.fetchOne(String(uid), { envelope: true, labels: true }, { uid: true });
        if (!msg || typeof msg === "boolean") continue;
        const to = msg.envelope?.to?.[0]?.address ?? "?";
        out.push({ to, folder: folderOf(new Set(msg.labels ?? [])), subject: msg.envelope?.subject ?? "" });
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
  return out;
}

const ICON: Record<SeedPlacement["folder"], string> = { Primary: "✅", Promotions: "🟡", Updates: "🟡", Spam: "⛔", Other: "❔" };
const WORD: Record<SeedPlacement["folder"], string> = {
  Primary: "Основні (найкраще)", Promotions: "Промоакції", Updates: "Оновлення", Spam: "СПАМ", Other: "інша папка",
};

/**
 * Once a Kyiv day, a couple of hours after the day's broadcast, report where
 * the seeds landed. Returns what it found (empty when there is nothing to say).
 */
export async function seedCheck(now = new Date()): Promise<{ sent: boolean; placements: SeedPlacement[]; reason?: string }> {
  const seeds = (await getSetting("esputnik_seeds", "")).split(",").map((s) => s.trim()).filter(Boolean);
  if (seeds.length === 0) return { sent: false, placements: [], reason: "no seeds configured" };
  const today = kyivDay(now);
  if ((await getSetting("seed_check_day", "")) === today) return { sent: false, placements: [], reason: "already checked today" };

  // only after the day's broadcast has had two hours to arrive
  const g = await pool.query<{ scheduled_at: string; group_name: string }>(
    `SELECT scheduled_at, group_name FROM mass_groups WHERE broadcast_id IS NOT NULL AND broadcast_id <> -1
       AND (scheduled_at AT TIME ZONE 'Europe/Kyiv')::date = $1::date ORDER BY scheduled_at DESC LIMIT 1`, [today]);
  const row = g.rows[0];
  if (!row) return { sent: false, placements: [], reason: "no broadcast today yet" };
  const sched = new Date(row.scheduled_at);
  if (now.getTime() - sched.getTime() < 2 * 3600_000) return { sent: false, placements: [], reason: "broadcast younger than 2 h" };

  const placements = await seedPlacements(new Date(sched.getTime() - 3600_000)).catch(() => []);
  if (placements.length === 0) return { sent: false, placements: [], reason: "no seed mail found yet" };

  await setSetting("seed_check_day", today);
  const worst = placements.some((p) => p.folder === "Spam") ? "Spam" : placements.some((p) => p.folder !== "Primary") ? "Promotions" : "Primary";
  const head = worst === "Spam" ? "⛔ Лист лягає у СПАМ" : worst === "Primary" ? "✅ Лист у вхідних" : "🟡 Лист у вкладці Промоакції";
  const lines = [`📬 Перевірка доставки (${row.group_name})`, head, ...placements.map((p) => `${ICON[p.folder]} ${p.to} — ${WORD[p.folder]}`)];
  await sendTelegramMessage(lines.join("\n")).catch(() => {});
  return { sent: true, placements };
}
