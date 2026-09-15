/**
 * POST /api/internal/esputnik/purge?date=YYYY-MM-DD (default today)
 * Re-runs the "leads ≠ customers" second line of defence on that day's lead
 * groups and reconciles the ledger with what is really in each group:
 *   - customers found in a lead group → detached there, converted here
 *   - ledger rows whose address is NOT in the group → deleted (they were
 *     never mailed, so they must stay eligible for a later push)
 * Dashboard/cron auth. Nothing here touches a contact outside Leads groups.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isAuthorized, unauthorized } from "@/lib/apiAuth";
import { esputnikConfigured, esputnikDelete, findContact, groupMembers, purgeCustomersFromGroup, detachFromGroup } from "@/lib/esputnik";
import { contactEmail, isCustomerContact, type EsputnikContact } from "@/lib/esputnikStatus";
import { api } from "@/lib/esputnik";
import { groupNameFor } from "@/lib/esputnikStatus";
import { PLATFORMS } from "@/lib/leadPolicy";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  if (!esputnikConfigured()) return NextResponse.json({ error: "ESPUTNIK_API_KEY not set" }, { status: 500 });
  const q = new URL(request.url).searchParams;
  const date = q.get("date") ? new Date(`${q.get("date")}T00:00:00Z`) : new Date();
  const out: Record<string, unknown> = {};
  // ?orphans=1 — leads we upserted into eSputnik that never got a group and
  // never reached the ledger (the failed first push of 14.09 left 1 698 such).
  // Candidates = addresses selectable by the mass channel that eSputnik knows
  // but that are in NO group; delete them. Customers (any non-lead group or
  // shop id) are never touched.
  if (q.get("orphans") === "1") {
    const { selectMassLeads } = await import("@/lib/leadBridge");
    const t0 = Date.now();
    const cand = await selectMassLeads({ platforms: ["soundcloud"], limit: 1800 });
    let checked = 0, orphans = 0, deleted = 0, failed = 0;
    for (const l of cand) {
      if (Date.now() - t0 > 250_000) break;
      try {
        const c = await findContact(l.email);
        checked++;
        if (!c || !c.id) continue;
        if (isCustomerContact(c)) continue;
        if ((c.groups ?? []).length === 0) { orphans++; await esputnikDelete(c.id); deleted++; }
      } catch { failed++; }
    }
    return NextResponse.json({ ok: true, candidates: cand.length, checked, orphans, deleted, failed, tookMs: Date.now() - t0 });
  }
  // ?drop=<groupId,groupId,…> — delete every NON-customer contact of these
  // groups from eSputnik and mark them retired here (one touch, ever). Used
  // to clean up duplicate/unsent groups left by repeated push attempts.
  // A contact that also sits in a group NOT in this list is only detached,
  // never deleted. Customers are never touched.
  const drop = (q.get("drop") ?? "").split(",").map((x) => parseInt(x, 10)).filter((n) => n > 0);
  if (drop.length) {
    const t0 = Date.now();
    // Customers by Shopify mirror + ledger (converted) — one DB read, no per-contact API calls.
    const customerSet = new Set<string>((await pool.query<{ email: string }>(`SELECT email FROM shop_customers UNION SELECT email FROM lead_exports WHERE outcome = 'converted'`)).rows.map((r) => r.email));
    let seen = 0, deleted = 0, skipped = 0, failed = 0;
    const doneEmails: string[] = [];
    for (const gid of drop) {
      for (let start = 1; ; start += 500) {
        if (Date.now() - t0 > 240_000) break;
        const page = await api<EsputnikContact[]>(`/v1/group/${gid}/contacts?startindex=${start}&maxrows=500`).catch(() => null);
        if (!Array.isArray(page) || page.length === 0) break;
        for (const row of page) {
          if (!row.id || Date.now() - t0 > 240_000) continue;
          seen++;
          const e = contactEmail(row);
          if (row.externalCustomerId || (e && customerSet.has(e))) { skipped++; continue; }
          try { await esputnikDelete(row.id); deleted++; if (e) doneEmails.push(e); } catch { failed++; }
        }
        if (page.length < 500) break;
      }
    }
    if (doneEmails.length) await pool.query(`UPDATE lead_exports SET outcome='retired', outcome_at=now(), verified_gone=true WHERE email = ANY($1::text[]) AND COALESCE(outcome,'') NOT IN ('converted','bounced','complained','unsubscribed')`, [doneEmails]).catch(() => {});
    return NextResponse.json({ ok: true, groups: drop, seen, deleted, skippedCustomers: skipped, failed, tookMs: Date.now() - t0 });
  }
  // ?verify=N — ledger says 'retired' but is the contact really gone? Check up
  // to N of them against eSputnik and delete the ones still there (the
  // parallel sweep of 14.09 left ~3 800 behind). Customers are never touched.
  const verifyN = parseInt(q.get("verify") ?? "0", 10) || 0;
  if (verifyN > 0) {
    const t0 = Date.now();
    const rows = await pool.query<{ email: string }>(`SELECT email FROM lead_exports WHERE outcome='retired' AND batch LIKE 'Leads: %' AND COALESCE(verified_gone, false) = false ORDER BY outcome_at LIMIT $1`, [verifyN]).then((r) => r.rows);
    let gone = 0, deleted = 0, customers = 0, failed = 0;
    for (const { email } of rows) {
      if (Date.now() - t0 > 250_000) break;
      try {
        const c = await findContact(email);
        if (!c) { gone++; }
        else if (isCustomerContact(c)) { customers++; await pool.query(`UPDATE lead_exports SET outcome='converted', outcome_at=now() WHERE email=$1`, [email]); }
        else if (c.id) { await esputnikDelete(c.id); deleted++; }
        await pool.query(`UPDATE lead_exports SET verified_gone = true WHERE email = $1`, [email]);
      } catch { failed++; }
    }
    return NextResponse.json({ ok: true, checked: rows.length, gone, deleted, customers, failed, tookMs: Date.now() - t0 });
  }
  // ?reschedule=HH:MM — cancel today's open broadcasts and re-create them at
  // HH:MM Kyiv today (used once on 15.09 when the first slot was computed in UTC).
  const resched = q.get("reschedule");
  if (resched && /^\d{2}:\d{2}$/.test(resched)) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
    const rows = await pool.query<{ group_id: string; group_name: string; broadcast_id: string; message_id: string }>(`SELECT group_id, group_name, broadcast_id, message_id FROM mass_groups WHERE deleted_at IS NULL AND broadcast_id IS NOT NULL AND delivered = 0`).then((r) => r.rows);
    const out: unknown[] = [];
    for (const g of rows) {
      try {
        if (Number(g.broadcast_id) > 0) await api(`/v1/broadcast/${g.broadcast_id}`, { method: "DELETE" }).catch(() => {});
        const b = await api<{ broadcastId?: number; id?: number }>("/v1/broadcast", { method: "POST", body: JSON.stringify({ messageId: String(g.message_id), groups: [Number(g.group_id)], excludedGroups: [202712561, 187278414, 202714346, 202714347, 202702374, 202702372], title: g.group_name, startDate: `${day}T${resched}` }) });
        const bid = b.broadcastId ?? b.id ?? -1;
        await pool.query(`UPDATE mass_groups SET broadcast_id = $2, scheduled_at = ($3 || ':00')::timestamp AT TIME ZONE 'Europe/Kyiv' WHERE group_id = $1`, [g.group_id, bid, `${day}T${resched}`]);
        out.push({ group: g.group_name, broadcastId: bid, startDate: `${day}T${resched}` });
      } catch (e) { out.push({ group: g.group_name, error: e instanceof Error ? e.message : String(e) }); }
    }
    return NextResponse.json({ ok: true, rescheduled: out });
  }
  // ?inspect=a@x,b@y — show what eSputnik holds for these addresses (id, ext id, groups)
  const inspect = (q.get("inspect") ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (inspect.length) {
    const seen: Record<string, unknown> = {};
    for (const e of inspect) seen[e] = await findContact(e).catch((err) => ({ error: String(err) }));
    out.inspect = seen;
  }
  // ?detach=a@x,b@y — force these addresses out of the day's lead groups
  const force = (q.get("detach") ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  for (const p of PLATFORMS.filter((x) => x !== "beatport")) {
    const group = groupNameFor(p, date);
    try {
      const purge = await purgeCustomersFromGroup(group);
      if (force.length) purge.detached.push(...(await detachFromGroup(group, force)));
      const members = await groupMembers(group);
      const ledger = await pool.query<{ email: string }>(`SELECT email FROM lead_exports WHERE batch = $1`, [group]).then((r) => r.rows.map((x) => x.email));
      const notInGroup = ledger.filter((e) => !members.has(e));
      if (notInGroup.length) {
        await pool.query(`DELETE FROM lead_exports WHERE batch = $1 AND email = ANY($2::text[])`, [group, notInGroup]);
        await pool.query(`DELETE FROM email_events WHERE event = 'sent' AND meta->>'campaign' = $1 AND email = ANY($2::text[])`, [group, notInGroup]).catch(() => {});
      }
      out[group] = { checked: purge.checked, customersDetached: purge.detached, inGroup: members.size, ledgerBefore: ledger.length, ledgerReleased: notInGroup.length };
    } catch (e) {
      out[group] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return NextResponse.json({ ok: true, date: date.toISOString().slice(0, 10), groups: out });
}
