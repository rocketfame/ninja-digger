/**
 * Bridge to the email-marketing side (eSputnik).
 *
 * GET  /api/internal/leads/export — hand over ONE batch of leads.
 * POST /api/internal/leads/export — report outcomes back (bounce/complaint/...),
 *      so what the other side learns lands in our suppression list too.
 *
 * Safety rules baked in, because these addresses go out under the MAIN domain:
 *   - the mass cycle (massEligibleSql): one mass email per 30 days, never
 *     within 15 days of a cold personal email, 3 unopened in a row → 60 days
 *     off, buyers never; lead_exports is the ledger, email is the key
 *   - never anything in email_blacklist (junk, dead mailbox, opt-out, bounce)
 *   - by default only mailboxes SMTP-verified as live (email_verification.valid)
 *   - `engagement=replied` = people who wrote back to us (warmest we have)
 *     `engagement=engaged` = people who opened our cold mail, taken straight
 *     from email_events (Brevo's own log). Apple's `loadedbyproxy` pixel
 *     prefetch is deliberately NOT an open — it is a machine, not a person.
 *     Cold mail is plain text, so Brevo tracks NO clicks — do not ask for them.
 *
 * Params: platform=soundcloud|spotify|youtube|beatport|all, limit (max 5000),
 *         batch=<label>, format=json|csv, verified=only|any|all,
 *         engagement=any|engaged|replied, min_followers=N, country=US,CA, dry=1,
 *         cursor=<last email of the previous page>
 *
 * Paging: the response carries `total_available` (how many match the filters
 * right now) and `next_cursor`. Feed next_cursor back as ?cursor= to continue.
 * It is a keyset, not an offset, because a live call records what it hands over
 * and the result set shrinks between pages - an offset would then skip rows.
 */
import { NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/apiAuth";
import { MASS_SOURCES, PLATFORMS, type Platform } from "@/lib/leadPolicy";
import { countMassLeads, recordHandover, recordOutcome, selectMassLeads } from "@/lib/leadBridge";
import { csvCell } from "@/lib/csv";

/**
 * The marketing side gets its OWN token (LEADGEN_TOKEN), not the dashboard
 * password: it must be able to pull batches and report outcomes, and nothing
 * else. Dashboard/cron auth still works for us.
 */
function bridgeAuthorized(request: Request): boolean {
  const token = process.env.LEADGEN_TOKEN;
  if (token && request.headers.get("authorization") === `Bearer ${token}`) return true;
  return isAuthorized(request);
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!bridgeAuthorized(request)) return unauthorized();
  const q = new URL(request.url).searchParams;

  const platformParam = (q.get("platform") ?? "soundcloud").toLowerCase();
  const platforms: Platform[] = platformParam === "all" ? [...PLATFORMS] : PLATFORMS.filter((p) => p === platformParam);
  if (platforms.length === 0) {
    return NextResponse.json({ error: `platform must be one of ${PLATFORMS.join(", ")} or "all"` }, { status: 400 });
  }
  const limit = Math.min(5000, Math.max(1, parseInt(q.get("limit") ?? "500", 10) || 500));
  const dry = q.get("dry") === "1";
  // Accept the obvious spellings for "don't filter" — a typo used to silently
  // keep the strict filter and look like an empty segment.
  const verifiedParam = (q.get("verified") ?? "only").toLowerCase();
  const verifiedOnly = !["any", "all", "no", "false", "0", "off"].includes(verifiedParam);
  // NOTE: we send cold mail as plain text, so Brevo records NO clicks — the
  // real warmth ladder here is: replied > opened > nothing.
  const engagement = (q.get("engagement") ?? "any").toLowerCase();
  const eng = engagement === "engaged" ? "engaged" : engagement === "replied" ? "replied" : "any";
  const minFollowers = Math.max(0, parseInt(q.get("min_followers") ?? "0", 10) || 0);
  const countries = (q.get("country") ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  const batch = q.get("batch") ?? `${platformParam}-${new Date().toISOString().slice(0, 10)}`;
  // Keyset pagination on email: a live call records what it hands over and the
  // result set shrinks under the reader's feet, so an offset would skip rows.
  const cursor = (q.get("cursor") ?? q.get("after") ?? "").trim().toLowerCase();

  const sel = { platforms, limit, verifiedOnly, engagement: eng as "any" | "engaged" | "replied", minFollowers, countries, cursor: cursor || undefined };
  const rows = await selectMassLeads(sel).catch((e: unknown) => { console.error("[leads/export] query failed:", e); return null; });
  if (rows === null) return NextResponse.json({ error: "query failed", batch, platform: platformParam }, { status: 500 });

  if (!dry && rows.length > 0) await recordHandover(rows, batch, "esputnik");

  if (q.get("format") === "csv") {
    const header = "email,platform,name,followers,country,profile_url,found_at\n";
    const body = rows.map((r) => [r.email, r.platform, r.name, r.followers, r.country, r.profile_url, r.found_at].map(csvCell).join(",")).join("\n");
    return new NextResponse(header + body, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${batch}.csv"` },
    });
  }
  // How many are left under these filters, so the other side can plan.
  const total = await countMassLeads(sel).catch(() => null);

  return NextResponse.json({
    batch, dry, count: rows.length,
    total_available: total,
    next_cursor: rows.length === limit ? rows[rows.length - 1].email : null,
    filters: {
      platform: platformParam,
      verified: verifiedOnly ? "smtp-verified live only" : "not-invalid",
      engagement: eng === "replied" ? "replied to our cold mail (warmest)" : eng === "engaged" ? "opened our mail" : "any",
      ...(minFollowers > 0 ? { min_followers: minFollowers } : {}),
      ...(countries.length > 0 ? { country: countries } : {}),
    },
    leads: rows,
    ts: new Date().toISOString(),
  });
}

/**
 * Feedback loop — and the whole of the "sync" with the marketing side.
 *
 * There is no second system to reconcile against: the mass system reports
 * what it did into email_events, the same table Brevo's events land in,
 * tagged meta.src (esputnik | listmonk) with the campaign. One timeline per
 * person answers "who was mailed, from where, when" with a single query.
 *
 * Body: { src?: esputnik|listmonk, outcomes: [{ email, outcome, at?, campaign? }] }
 *   outcome: sent | delivered | opened | clicked | bounced | complained |
 *            unsubscribed | converted | cold
 * Negative outcomes suppress the address for US too, immediately; 'cold'
 * hands the lead back. Implementation: lib/leadBridge.recordOutcome.
 */
export async function POST(request: Request) {
  if (!bridgeAuthorized(request)) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as {
    src?: string;
    outcomes?: { email?: string; outcome?: string; at?: string; campaign?: string }[];
  };
  const src = (MASS_SOURCES as readonly string[]).includes(String(body.src ?? "").toLowerCase()) ? (String(body.src).toLowerCase() as "esputnik" | "listmonk") : "esputnik";
  const items = (body.outcomes ?? []).filter((o) => o.email && o.outcome);
  if (items.length === 0) return NextResponse.json({ error: "outcomes[] required" }, { status: 400 });

  let recorded = 0, logged = 0, suppressed = 0, released = 0;
  for (const { email, outcome, at, campaign } of items) {
    const r = await recordOutcome({
      email: String(email), outcome: String(outcome), src, campaign,
      at: at && !Number.isNaN(Date.parse(at)) ? new Date(at) : undefined,
    });
    if (r.logged) logged++; if (r.recorded) recorded++; if (r.suppressed) suppressed++; if (r.released) released++;
  }
  return NextResponse.json({ ok: true, recorded, logged, suppressed, released, ts: new Date().toISOString() });
}
