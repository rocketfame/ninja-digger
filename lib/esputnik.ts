/**
 * eSputnik as the mass channel's engine. Our base stays the source of truth:
 * we push a day's segment as a static group, eSputnik sends the campaign with
 * its own per-provider warm-up, we pull every outcome back onto the person's
 * timeline, and after a cycle we delete the contact there again — eSputnik
 * bills per contact stored, so only the live batch lives there.
 *
 * Auth: HTTP Basic, any user name + the API key (ESPUTNIK_API_KEY).
 */
import { pool } from "@/lib/db";
import { PLATFORMS, type Platform } from "@/lib/leadPolicy";
import { recordHandover, recordOutcome, selectMassLeads } from "@/lib/leadBridge";
import { groupNameFor, mapEsputnikStatus, outcomeForEvent } from "@/lib/esputnikStatus";

const BASE = "https://esputnik.com/api";

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

/**
 * Push one platform's batch: select under the cycle rules, upsert into a
 * dated static group, write the ledger. externalCustomerId = email so the
 * contact can be deleted by address later.
 */
export async function pushToEsputnik(platform: Platform, limit: number): Promise<{ group: string; pushed: number; failed: number }> {
  const group = groupNameFor(platform);
  const rows = await selectMassLeads({ platforms: [platform], limit });
  if (rows.length === 0) return { group, pushed: 0, failed: 0 };
  let failed = 0;
  for (let i = 0; i < rows.length; i += 3000) {
    const chunk = rows.slice(i, i + 3000);
    const r = await api<{ failedContacts?: unknown[] }>("/v1/contacts", {
      method: "POST",
      body: JSON.stringify({
        contacts: chunk.map((l) => ({
          externalCustomerId: l.email,
          firstName: l.name ?? undefined,
          channels: [{ type: "email", value: l.email }],
          ...(l.country ? { address: { countryCode: l.country } } : {}),
        })),
        dedupeOn: "email",
        contactFields: ["firstName", "address"],
        groupNames: [group],
        restoreDeleted: true,
      }),
    });
    failed += r.failedContacts?.length ?? 0;
  }
  await recordHandover(rows, group, "esputnik");
  return { group, pushed: rows.length - failed, failed };
}

type Activity = { email?: string; activityStatus?: string; activityDateTime?: string; messageName?: string; offset?: string; mediaType?: string };

/**
 * Pull outcomes for a window. Only email activity on our LEADS groups
 * matters, but every email event is cheap to record and the ledger update
 * is a no-op for addresses we never exported.
 */
export async function pullEsputnikActivity(from: Date, to: Date, budgetMs = 80_000): Promise<{ seen: number; logged: number; suppressed: number }> {
  const deadline = Date.now() + budgetMs;
  let offset = "";
  let seen = 0, logged = 0, suppressed = 0;
  const fmt = (d: Date) => d.toISOString().slice(0, 19);
  for (let page = 0; page < 200 && Date.now() < deadline; page++) {
    const q = new URLSearchParams({ dateFrom: fmt(from), dateTo: fmt(to), maxrows: "5000" });
    if (offset) q.set("offset", offset);
    const rows = await api<Activity[]>(`/v2/contacts/activity?${q}`);
    if (!Array.isArray(rows) || rows.length === 0) break;
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
    const last = rows[rows.length - 1]?.offset;
    if (!last || rows.length < 5000) break;
    offset = last;
  }
  return { seen, logged, suppressed };
}

/**
 * A cycle is over: contacts exported ≥30 days ago that neither bought nor
 * were suppressed are deleted from eSputnik (we pay per stored contact) and
 * marked 'cold' in the ledger. massEligibleSql lets them back in on the next
 * push automatically once the 30 days have passed.
 */
export async function retireColdFromEsputnik(limit = 500): Promise<{ deleted: number; failed: number }> {
  const rows = await pool
    .query<{ email: string }>(
      `SELECT email FROM lead_exports
        WHERE platform = ANY($2::text[]) AND exported_at < now() - interval '30 days'
          AND COALESCE(outcome,'') NOT IN ('cold','converted','bounced','complained','unsubscribed')
        ORDER BY exported_at LIMIT $1`,
      [limit, PLATFORMS.filter((p) => p !== "beatport")]
    )
    .then((r) => r.rows);
  let deleted = 0, failed = 0;
  for (const { email } of rows) {
    try {
      await api(`/v1/contact?externalCustomerId=${encodeURIComponent(email)}`, { method: "DELETE" });
      await recordOutcome({ email, outcome: "cold", src: "esputnik" });
      deleted++;
    } catch (e) {
      failed++;
      console.error("[esputnik] delete failed:", email, e instanceof Error ? e.message : e);
    }
  }
  return { deleted, failed };
}
