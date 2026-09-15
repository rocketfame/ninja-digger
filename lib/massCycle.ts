/**
 * The mass channel as a cycle, driven by facts, not by the clock
 * (user, 15.09): fill to the ceiling → broadcast → wait for delivery →
 * delete → repeat. The hourly cron calls `advance()`, which performs
 * whichever step the state has earned. Every step is idempotent, so a
 * crashed or slow run simply resumes next hour.
 *
 * Nothing here needs a laptop: eSputnik's API creates the group, schedules
 * the campaign and deletes the contacts.
 *
 * Isolation (unchanged, three layers): a candidate for deletion is a row
 * of OUR ledger, and in eSputnik it has no Shopify id and no group other
 * than "Leads: …". Buyers become 'converted' the hour they buy and are
 * never touched.
 */
import { pool } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import { sendTelegramMessage } from "@/lib/telegram";
import { PLATFORMS, type Platform } from "@/lib/leadPolicy";
import { api, esputnikBaseSize, esputnikDelete } from "@/lib/esputnik";
import { cleanFirstName, contactEmail, isCustomerContact, type EsputnikContact } from "@/lib/esputnikStatus";
import { recordHandover, selectMassLeads } from "@/lib/leadBridge";

const LABEL: Record<string, string> = { soundcloud: "SoundCloud", spotify: "Spotify", youtube: "YouTube" };
const TZ: Record<string, string> = {
  US: "America/New_York", CA: "America/Toronto", MX: "America/Mexico_City", BR: "America/Sao_Paulo", AR: "America/Argentina/Buenos_Aires",
  GB: "Europe/London", IE: "Europe/Dublin", PT: "Europe/Lisbon", ES: "Europe/Madrid", FR: "Europe/Paris", DE: "Europe/Berlin", NL: "Europe/Amsterdam",
  BE: "Europe/Brussels", IT: "Europe/Rome", PL: "Europe/Warsaw", SE: "Europe/Stockholm", NO: "Europe/Oslo", DK: "Europe/Copenhagen", FI: "Europe/Helsinki",
  UA: "Europe/Kyiv", TR: "Europe/Istanbul", IL: "Asia/Jerusalem", IN: "Asia/Kolkata", JP: "Asia/Tokyo", KR: "Asia/Seoul", AU: "Australia/Sydney", NZ: "Pacific/Auckland", ZA: "Africa/Johannesburg",
};

/** Customer groups a lead campaign must never reach. */
const EXCLUDED_GROUPS = [202712561, 187278414, 202714346, 202714347, 202702374, 202702372];

type Knobs = {
  ceiling: number;          // esputnik_ceiling — base must never exceed this (24 500)
  perPlatform: number;      // esputnik_daily_push — max per platform per cycle (0 = off)
  maxCycles: number;        // esputnik_max_cycles_per_day
  platforms: Platform[];
  messages: Record<string, number>; // esputnik_message_<platform> — template id per platform
  sendHourKyiv: number;     // esputnik_send_hour (Kyiv), default 15
};

async function knobs(): Promise<Knobs> {
  const g = (k: string, d: string) => getSetting(k, d);
  const platforms = (await g("esputnik_push_platforms", "soundcloud,spotify,youtube")).split(",").map((s) => s.trim().toLowerCase())
    .filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p) && p !== "beatport");
  const messages: Record<string, number> = {};
  for (const p of platforms) { const v = parseInt(await g(`esputnik_message_${p}`, "0"), 10); if (v > 0) messages[p] = v; }
  return {
    ceiling: parseInt(await g("esputnik_ceiling", "24500"), 10) || 24500,
    perPlatform: parseInt(await g("esputnik_daily_push", "0"), 10) || 0,
    maxCycles: parseInt(await g("esputnik_max_cycles_per_day", "1"), 10) || 1,
    platforms, messages,
    sendHourKyiv: parseInt(await g("esputnik_send_hour", "0"), 10) || 0,
  };
}

const kyivDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(d); // YYYY-MM-DD
const kyivHour = (d = new Date()) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", hour12: false }).format(d));

export type Advance = { step: string; detail: Record<string, unknown> };

/** One turn of the crank. Returns what it did. */
export async function advance(budgetMs = 240_000): Promise<Advance[]> {
  const t0 = Date.now();
  const k = await knobs();
  const done: Advance[] = [];
  const left = () => budgetMs - (Date.now() - t0);

  // ── A. delete groups whose campaign has delivered ─────────────────────
  const delivered = await pool.query<{ group_id: string; group_name: string; members: number; delivered: number; scheduled_at: string | null }>(
    `SELECT group_id, group_name, members, delivered, scheduled_at FROM mass_groups
      WHERE deleted_at IS NULL AND broadcast_id IS NOT NULL
        AND (delivered >= GREATEST(1, members * 0.5) OR scheduled_at < now() - interval '36 hours')
      ORDER BY created_at LIMIT 3`
  ).then((r) => r.rows);
  for (const g of delivered) {
    if (left() < 60_000) break;
    const r = await deleteGroupContacts(Number(g.group_id), left() - 20_000);
    if (r.remaining === 0) await pool.query(`UPDATE mass_groups SET deleted_at = now() WHERE group_id = $1`, [g.group_id]);
    done.push({ step: "delete", detail: { group: g.group_name, ...r } });
  }

  // ── B. schedule broadcasts for filled groups without one ──────────────
  const unsent = await pool.query<{ group_id: string; group_name: string; platform: string; members: number }>(
    `SELECT group_id, group_name, platform, members FROM mass_groups WHERE deleted_at IS NULL AND broadcast_id IS NULL AND members > 0 ORDER BY created_at`
  ).then((r) => r.rows);
  for (const g of unsent) {
    const messageId = k.messages[g.platform];
    if (!messageId) { done.push({ step: "broadcast-skipped", detail: { group: g.group_name, reason: `no esputnik_message_${g.platform}` } }); continue; }
    // esputnik_send_hour = 0 → send the moment the group is filled (the cycle
    // is fact-driven, so the campaign follows the fill, not the clock).
    const startDate = k.sendHourKyiv > 0 ? nextSendSlot(k.sendHourKyiv) : null;
    try {
      const b = await api<{ broadcastId?: number; id?: number }>("/v1/broadcast", {
        method: "POST",
        body: JSON.stringify({ messageId: String(messageId), groups: [Number(g.group_id)], excludedGroups: EXCLUDED_GROUPS, title: g.group_name, ...(startDate ? { startDate } : {}) }),
      });
      const bid = b.broadcastId ?? b.id ?? 0;
      if (startDate) await pool.query(`UPDATE mass_groups SET broadcast_id = $2, message_id = $3, scheduled_at = ($4 || ':00')::timestamp AT TIME ZONE 'Europe/Kyiv' WHERE group_id = $1`, [g.group_id, bid || -1, messageId, startDate]);
      else await pool.query(`UPDATE mass_groups SET broadcast_id = $2, message_id = $3, scheduled_at = now() WHERE group_id = $1`, [g.group_id, bid || -1, messageId]);
      done.push({ step: "broadcast", detail: { group: g.group_name, broadcastId: bid, startDate: startDate ?? "now" } });
    } catch (e) {
      done.push({ step: "broadcast-failed", detail: { group: g.group_name, error: e instanceof Error ? e.message : String(e) } });
    }
  }

  // ── C. fill a new cycle if allowed ─────────────────────────────────────
  const open = await pool.query<{ c: string }>(`SELECT COUNT(*) c FROM mass_groups WHERE deleted_at IS NULL`).then((r) => Number(r.rows[0].c));
  const cyclesToday = await pool.query<{ c: string }>(`SELECT COALESCE(MAX(cycle),0) c FROM mass_groups WHERE day = $1`, [kyivDay()]).then((r) => Number(r.rows[0].c));
  if (k.perPlatform > 0 && open === 0 && cyclesToday < k.maxCycles && left() > 90_000) {
    const base = await esputnikBaseSize({ maxAgeMin: 0, budgetMs: 90_000 }).catch(() => null);
    if (base === null) {
      done.push({ step: "fill-skipped", detail: { reason: "base size unreadable" } });
      await sendTelegramMessage("⛔ eSputnik: не зміг прочитати розмір бази — цикл відкладено.").catch(() => {});
    } else {
      let budget = Math.max(0, k.ceiling - base);
      const cycle = cyclesToday + 1;
      const filled: string[] = [];
      for (const p of k.platforms) {
        if (left() < 45_000 || budget <= 0) break;
        const take = Math.min(k.perPlatform, budget);
        const r = await fillGroup(p, take, cycle, left() - 15_000).catch((e) => ({ name: "", id: 0, members: 0, error: e instanceof Error ? e.message : String(e) }));
        if (r.id) {
          await pool.query(`INSERT INTO mass_groups (group_id, group_name, platform, cycle, day, members) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (group_id) DO UPDATE SET members = EXCLUDED.members`, [r.id, r.name, p, cycle, kyivDay(), r.members]);
          budget -= r.members;
          filled.push(`${LABEL[p] ?? p} ${r.members}`);
        }
        done.push({ step: "fill", detail: { platform: p, ...r } });
      }
      if (filled.length) await sendTelegramMessage(`📤 eSputnik цикл ${cycle}: ${filled.join(" · ")}\nБаза була ${base} із стелі ${k.ceiling}`).catch(() => {});
    }
  }
  return done;
}

/** Next HH:00 Kyiv today if still ahead by ≥30 min, else tomorrow. Format eSputnik wants: YYYY-MM-DDTHH:mm. */
function nextSendSlot(hourKyiv: number): string {
  // eSputnik interprets startDate in the ORGANISATION timezone (Europe/Kyiv).
  // If the slot is still ≥ 20 min ahead today, use today; else tomorrow.
  const now = new Date();
  const minutesNow = kyivHour(now) * 60 + Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", minute: "2-digit" }).format(now));
  const day = minutesNow + 20 <= hourKyiv * 60 ? kyivDay(now) : kyivDay(new Date(now.getTime() + 86400_000));
  return `${day}T${String(hourKyiv).padStart(2, "0")}:00`;
}

/** Create the group by upserting the batch into it (eSputnik attaches only on creation), read it back. */
async function fillGroup(platform: Platform, limit: number, cycle: number, budgetMs: number): Promise<{ name: string; id: number; members: number }> {
  const t0 = Date.now();
  const day = kyivDay();
  const dd = `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;
  const name = cycle > 1 ? `Leads: ${LABEL[platform] ?? platform} ${dd} /${cycle} (auto)` : `Leads: ${LABEL[platform] ?? platform} ${dd} (auto)`;
  const rows = await selectMassLeads({ platforms: [platform], limit });
  if (rows.length === 0) return { name, id: 0, members: 0 };
  for (let i = 0; i < rows.length; i += 3000) {
    const chunk = rows.slice(i, i + 3000);
    await api("/v1/contacts", {
      method: "POST",
      body: JSON.stringify({
        contacts: chunk.map((l) => ({
          firstName: cleanFirstName(l.name),
          channels: [{ type: "email", value: l.email }],
          ...(l.country && TZ[l.country.toUpperCase()] ? { timeZone: TZ[l.country.toUpperCase()], address: { countryCode: l.country.toUpperCase() } } : {}),
        })),
        dedupeOn: "email", contactFields: ["firstName", "timeZone", "address"], groupNames: [name], restoreDeleted: true,
      }),
    });
  }
  // find the group, wait for it to fill, read it back
  let gid = 0;
  for (let i = 0; i < 10 && !gid; i++) { gid = await groupIdByName(name); if (!gid) await new Promise((r) => setTimeout(r, 2000)); }
  if (!gid) throw new Error(`group ${name} not created`);
  let members = new Set<string>();
  for (let tries = 0; tries < 30 && Date.now() - t0 < budgetMs; tries++) {
    await new Promise((r) => setTimeout(r, 3000));
    const now = await groupMembersById(gid);
    if (now.size >= rows.length || (now.size > 0 && now.size === members.size)) { members = now; break; }
    members = now;
  }
  const landed = rows.filter((l) => members.has(l.email.toLowerCase()));
  await recordHandover(landed, name, "esputnik");
  return { name, id: gid, members: landed.length };
}

async function groupIdByName(name: string): Promise<number> {
  const groups = await api<{ id: number; name: string }[]>("/v1/groups");
  return (Array.isArray(groups) ? groups : []).find((g) => g.name === name)?.id ?? 0;
}

async function groupMembersById(gid: number): Promise<Set<string>> {
  const out = new Set<string>();
  for (let start = 1; ; start += 500) {
    const page = await api<EsputnikContact[]>(`/v1/group/${gid}/contacts?startindex=${start}&maxrows=500`);
    if (!Array.isArray(page) || page.length === 0) break;
    for (const row of page) { const e = contactEmail(row); if (e) out.add(e); }
    if (page.length < 500) break;
  }
  return out;
}

/**
 * Remove a delivered group's contacts from eSputnik. Customers (Shopify id,
 * shop mirror, or any non-Leads group) are skipped, never deleted; they are
 * merely detached from the lead group. Returns how many still remain.
 */
async function deleteGroupContacts(gid: number, budgetMs: number): Promise<{ deleted: number; customers: number; remaining: number }> {
  const t0 = Date.now();
  const customerSet = new Set<string>((await pool.query<{ email: string }>(`SELECT email FROM shop_customers UNION SELECT email FROM lead_exports WHERE outcome = 'converted'`)).rows.map((r) => r.email));
  let deleted = 0, customers = 0;
  const detach: number[] = [];
  for (let pass = 0; pass < 20; pass++) {
    if (Date.now() - t0 > budgetMs) break;
    const page = await api<EsputnikContact[]>(`/v1/group/${gid}/contacts?startindex=1&maxrows=500`).catch(() => null);
    if (!Array.isArray(page) || page.length === 0) break;
    for (const row of page) {
      if (!row.id || Date.now() - t0 > budgetMs) continue;
      const e = contactEmail(row);
      if (row.externalCustomerId || (e && customerSet.has(e)) || isCustomerContact(row)) { customers++; detach.push(row.id); continue; }
      try { await esputnikDelete(row.id); deleted++; } catch { /* retry next pass */ }
    }
    if (detach.length) { await api(`/v1/group/${gid}/contacts/detach`, { method: "POST", body: JSON.stringify({ contactIds: detach.splice(0) }) }).catch(() => {}); }
    if (page.length < 500) { const again = await groupMembersById(gid).catch(() => new Set<string>()); if (again.size === 0) break; }
  }
  const remaining = (await groupMembersById(gid).catch(() => new Set<string>())).size;
  return { deleted, customers, remaining };
}

/** Called after each activity pull: count delivered per open group and recompute segments. */
export async function reconcile(): Promise<{ groups: number; segmented: number }> {
  const open = await pool.query<{ group_id: string; group_name: string }>(`SELECT group_id, group_name FROM mass_groups WHERE deleted_at IS NULL AND broadcast_id IS NOT NULL`).then((r) => r.rows);
  for (const g of open) {
    await pool.query(
      `UPDATE mass_groups SET delivered = (
         SELECT COUNT(DISTINCT le.email) FROM lead_exports le
          WHERE le.batch = $2 AND EXISTS (SELECT 1 FROM email_events e WHERE e.email = le.email AND e.event = 'delivered' AND e.ts >= le.exported_at))
       WHERE group_id = $1`, [g.group_id, g.group_name]);
  }
  const seg = await pool.query(
    `UPDATE lead_exports le SET segment = s.seg FROM (
       SELECT le2.email,
              CASE WHEN COALESCE(le2.outcome,'') IN ('bounced','complained','unsubscribed') OR LOWER(le2.email) IN (SELECT LOWER(email) FROM email_blacklist) THEN 'blacklist'
                   WHEN le2.outcome = 'converted' THEN 'converted'
                   WHEN EXISTS (SELECT 1 FROM email_events e WHERE e.email = le2.email AND e.event = 'click' AND e.ts >= le2.exported_at) THEN 'hot'
                   WHEN EXISTS (SELECT 1 FROM email_events e WHERE e.email = le2.email AND e.event IN ('opened','uniqueopened') AND e.ts >= le2.exported_at) THEN 'warm'
                   WHEN EXISTS (SELECT 1 FROM email_events e WHERE e.email = le2.email AND e.event = 'delivered' AND e.ts >= le2.exported_at) THEN 'cold'
                   ELSE NULL END seg
         FROM lead_exports le2 WHERE le2.batch LIKE 'Leads: %' AND le2.exported_at > now() - interval '45 days') s
     WHERE s.email = le.email AND s.seg IS DISTINCT FROM le.segment AND s.seg IS NOT NULL`
  );
  return { groups: open.length, segmented: seg.rowCount ?? 0 };
}

export { setSetting };
