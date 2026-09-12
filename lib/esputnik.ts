/**
 * eSputnik as the mass channel's engine. Our base stays the source of truth:
 * we push a day's segment as a static group, eSputnik sends the campaign with
 * its own per-provider warm-up, we pull every outcome back onto the person's
 * timeline, and after a cycle we delete the contact there again — eSputnik
 * bills per contact stored, so only the live batch lives there.
 *
 * THE RULE ABOVE ALL OTHERS: eSputnik also holds the shop's real customers.
 * A lead and a customer never mix. We create leads without externalCustomerId
 * (the shop integration owns that field), never overwrite an existing
 * contact's fields, never delete anything that shows a sign of being a
 * customer, and the moment a lead is found among customers it is marked
 * 'converted' — out of both our channels, for good, and left alone here.
 *
 * Auth: HTTP Basic, any user name + the API key (ESPUTNIK_API_KEY).
 */
import { pool } from "@/lib/db";
import { PLATFORMS, type Platform } from "@/lib/leadPolicy";
import { recordHandover, recordOutcome, selectMassLeads } from "@/lib/leadBridge";
import { groupNameFor, isCustomerContact, mapEsputnikStatus, outcomeForEvent, type EsputnikContact } from "@/lib/esputnikStatus";

const BASE = "https://esputnik.com/api";

/** Send-time zone by country: we only know the country of a lead, never the state. */
const TZ: Record<string, string> = {
  US: "America/New_York", CA: "America/Toronto", MX: "America/Mexico_City", BR: "America/Sao_Paulo", AR: "America/Argentina/Buenos_Aires",
  GB: "Europe/London", IE: "Europe/Dublin", PT: "Europe/Lisbon", ES: "Europe/Madrid", FR: "Europe/Paris", DE: "Europe/Berlin", NL: "Europe/Amsterdam",
  BE: "Europe/Brussels", IT: "Europe/Rome", PL: "Europe/Warsaw", SE: "Europe/Stockholm", NO: "Europe/Oslo", DK: "Europe/Copenhagen", FI: "Europe/Helsinki",
  UA: "Europe/Kyiv", TR: "Europe/Istanbul", IL: "Asia/Jerusalem", IN: "Asia/Kolkata", JP: "Asia/Tokyo", KR: "Asia/Seoul", AU: "Australia/Sydney", NZ: "Pacific/Auckland", ZA: "Africa/Johannesburg",
};

export function esputnikConfigured(): boolean {
  return Boolean(process.env.ESPUTNIK_API_KEY);
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = process.env.ESPUTNIK_API_KEY;
  if (!key) throw new Error("ESPUTNIK_API_KEY missing");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`ninja:${key}`).toString("base64")}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`eSputnik ${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** Look a contact up by address: id, shop id, groups. null when unknown to eSputnik. */
export async function findContact(email: string): Promise<EsputnikContact | null> {
  const list = await api<EsputnikContact[]>(`/v1/contacts?email=${encodeURIComponent(email)}&maxrows=1`).catch(() => null);
  const hit = Array.isArray(list) ? list[0] : null;
  if (!hit?.id) return null;
  // the search row carries no groups; the full contact does
  return api<EsputnikContact>(`/v1/contact/${hit.id}`).catch(() => hit);
}

/** A lead that turned out to be a customer leaves both channels for good. */
async function markConverted(email: string): Promise<void> {
  await pool.query(
    `INSERT INTO lead_exports (email, platform, batch, outcome, outcome_at)
     VALUES ($1, 'customer', 'esputnik-customer', 'converted', now())
     ON CONFLICT (email) DO UPDATE SET outcome = 'converted', outcome_at = now()`,
    [email.toLowerCase()]
  ).catch(() => {});
}

/**
 * Push one platform's batch: select under the cycle rules, keep only
 * addresses eSputnik does not already know as customers, upsert into a dated
 * static group, write the ledger. New contacts are created without
 * externalCustomerId and with firstName only; an address that already exists
 * there as a plain lead is attached to today's group without touching its
 * fields; an address that exists as a customer is marked converted and
 * skipped.
 */
export async function pushToEsputnik(platform: Platform, limit: number, budgetMs = 200_000): Promise<{ group: string; pushed: number; failed: number; customers: number }> {
  const group = groupNameFor(platform);
  const deadline = Date.now() + budgetMs;
  const rows = await selectMassLeads({ platforms: [platform], limit });
  if (rows.length === 0) return { group, pushed: 0, failed: 0, customers: 0 };

  const fresh: typeof rows = [];
  let customers = 0;
  for (const l of rows) {
    if (Date.now() > deadline) break;
    const c = await findContact(l.email);
    if (c && isCustomerContact(c)) { customers++; await markConverted(l.email); continue; }
    fresh.push(l);
  }
  if (fresh.length === 0) return { group, pushed: 0, failed: 0, customers };

  let failed = 0;
  for (let i = 0; i < fresh.length; i += 3000) {
    const chunk = fresh.slice(i, i + 3000);
    const r = await api<{ failedContacts?: unknown[] }>("/v1/contacts", {
      method: "POST",
      body: JSON.stringify({
        contacts: chunk.map((l) => ({
          firstName: l.name ?? undefined,
          channels: [{ type: "email", value: l.email }],
          ...(l.country && TZ[l.country.toUpperCase()] ? { timeZone: TZ[l.country.toUpperCase()], address: { countryCode: l.country.toUpperCase() } } : {}),
        })),
        dedupeOn: "email",
        // only this field may be written; nothing else on an existing contact changes
        contactFields: ["firstName", "timeZone", "address"],
        groupNames: [group],
        restoreDeleted: true,
      }),
    });
    failed += r.failedContacts?.length ?? 0;
  }
  await recordHandover(fresh, group, "esputnik");
  return { group, pushed: fresh.length - failed, failed, customers };
}

type Activity = { email?: string; activityStatus?: string; activityDateTime?: string; messageName?: string; mediaType?: string };

// eSputnik's agent measured: maxrows above 1000 and windows above a day misbehave.
const PAGE = 1000;
const fmt = (d: Date) => d.toISOString().slice(0, 19);

/**
 * One window of activity. eSputnik's v2 endpoint ignores start indexes and
 * its offset cursor is not reliable either (checked by the eSputnik agent),
 * so paging is done the only way that holds: a window that comes back full
 * is split in two and each half fetched again, down to windows of a minute.
 */
async function activityWindow(from: Date, to: Date, depth = 0): Promise<Activity[]> {
  const q = new URLSearchParams({ dateFrom: fmt(from), dateTo: fmt(to), maxrows: String(PAGE) });
  const rows = await api<Activity[]>(`/v2/contacts/activity?${q}`);
  if (!Array.isArray(rows)) return [];
  if (rows.length < PAGE || depth >= 12 || to.getTime() - from.getTime() < 60_000) return rows;
  const mid = new Date((from.getTime() + to.getTime()) / 2);
  return [...(await activityWindow(from, mid, depth + 1)), ...(await activityWindow(mid, to, depth + 1))];
}

/**
 * Pull outcomes for a window. Only email activity on our LEADS groups
 * matters, but every email event is cheap to record and the ledger update
 * is a no-op for addresses we never exported.
 */
export async function pullEsputnikActivity(from: Date, to: Date, budgetMs = 80_000): Promise<{ seen: number; logged: number; suppressed: number; complete: boolean }> {
  const deadline = Date.now() + budgetMs;
  let seen = 0, logged = 0, suppressed = 0;
  // eSputnik answers slowly in the minutes a broadcast is going out (the agent
  // measured two-minute windows hanging). If the budget runs out mid-way the
  // caller must NOT advance its cursor, or the unfetched windows are lost.
  let complete = true;
  // two-hour slices keep any one request small and the bisection shallow
  for (let t = from.getTime(); t < to.getTime(); t += 2 * 3600_000) {
    if (Date.now() >= deadline) { complete = false; break; }
    const rows = await activityWindow(new Date(t), new Date(Math.min(t + 2 * 3600_000, to.getTime())));
    for (const a of rows) {
      seen++;
      if (a.mediaType && a.mediaType !== "email") continue;
      const event = mapEsputnikStatus(a.activityStatus);
      if (!a.email || !event) continue;
      const r = await recordOutcome({
        email: a.email, outcome: event, src: "esputnik", campaign: a.messageName,
        at: a.activityDateTime && !Number.isNaN(Date.parse(a.activityDateTime)) ? new Date(a.activityDateTime) : undefined,
      });
      if (r.logged) logged++;
      if (r.suppressed) suppressed++;
      // ledger wants the outcome vocabulary, the timeline the event one
      if (r.logged) await pool.query(`UPDATE lead_exports SET outcome = $2 WHERE email = $1 AND COALESCE(outcome,'') NOT IN ('bounced','complained','unsubscribed','converted')`, [a.email.toLowerCase(), outcomeForEvent(event)]).catch(() => {});
    }
  }
  return { seen, logged, suppressed, complete };
}

/**
 * Rotation out of eSputnik — the plan there is 25k contacts, so a lead keeps
 * its seat only while it earns it (rule set by the user 11.09):
 *   - a week after the push with no open → out
 *   - 30 days after the push with no purchase → out, opened or not
 * "Out" = deleted from eSputnik and 'retired' in our ledger. Retired is
 * final (user, 12.09): the address is never pushed again and, because the
 * ledger row stays and is not 'cold', the personal channel leaves it alone too.
 * Only addresses in lead_exports are ever candidates (that ledger is the list
 * of what we loaded), and each one is looked up first: any sign of being a
 * customer means it is marked converted and left untouched.
 */
export async function retireColdFromEsputnik(limit = 500, budgetMs = 60_000): Promise<{ deleted: number; customers: number; failed: number }> {
  const deadline = Date.now() + budgetMs;
  const rows = await pool
    .query<{ email: string }>(
      `SELECT email FROM lead_exports le
        WHERE platform = ANY($2::text[])
          AND COALESCE(outcome,'') NOT IN ('retired','cold','converted','bounced','complained','unsubscribed')
          AND (
            exported_at < now() - interval '30 days'
            OR (exported_at < now() - interval '7 days'
                AND NOT EXISTS (SELECT 1 FROM email_events ev
                                 WHERE ev.email = le.email AND ev.ts >= le.exported_at
                                   AND ev.event IN ('opened','click')))
          )
        ORDER BY exported_at LIMIT $1`,
      [limit, PLATFORMS.filter((p) => p !== "beatport")]
    )
    .then((r) => r.rows);
  let deleted = 0, customers = 0, failed = 0;
  for (const { email } of rows) {
    if (Date.now() > deadline) break;
    try {
      const c = await findContact(email);
      if (!c) { await recordOutcome({ email, outcome: "retired", src: "esputnik" }); continue; }
      if (isCustomerContact(c)) { customers++; await markConverted(email); continue; }
      await api(`/v1/contact/${c.id}`, { method: "DELETE" });
      await recordOutcome({ email, outcome: "retired", src: "esputnik" });
      deleted++;
    } catch (e) {
      failed++;
      console.error("[esputnik] retire failed:", email, e instanceof Error ? e.message : e);
    }
  }
  return { deleted, customers, failed };
}
