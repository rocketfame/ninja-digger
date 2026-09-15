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
import { esputnikConfigured, esputnikDelete, findContact, groupMembers, purgeCustomersFromGroup, detachFromGroup, retireColdFromEsputnik } from "@/lib/esputnik";
import { isCustomerContact } from "@/lib/esputnikStatus";
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
  // ?retire=N — run the rotation sweep now, up to N deletions (emergency base hygiene)
  const retireN = parseInt(q.get("retire") ?? "0", 10) || 0;
  if (retireN > 0) {
    out.retired = await retireColdFromEsputnik(retireN, 270_000).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    return NextResponse.json({ ok: true, ...out });
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
