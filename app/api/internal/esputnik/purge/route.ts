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
import { esputnikConfigured, findContact, groupMembers, purgeCustomersFromGroup, detachFromGroup } from "@/lib/esputnik";
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
