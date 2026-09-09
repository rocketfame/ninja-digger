/**
 * Bridge to the email-marketing side (eSputnik).
 *
 * GET  /api/internal/leads/export — hand over ONE batch of leads.
 * POST /api/internal/leads/export — report outcomes back (bounce/complaint/...),
 *      so what the other side learns lands in our suppression list too.
 *
 * Safety rules baked in, because these addresses go out under the MAIN domain:
 *   - never exported twice (lead_exports is the ledger, email is the dedup key)
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
 *         engagement=any|engaged|replied, min_followers=N, country=US,CA, dry=1
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isAuthorized, unauthorized } from "@/lib/apiAuth";
import { HANDED_OVER_SQL, OPENED_SQL, PLATFORMS, REPLIED_SQL, SUPPRESSED_SQL, leadSourcesSql, type Platform } from "@/lib/leadSegments";

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

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

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
  const engagedOnly = engagement === "engaged";
  const repliedOnly = engagement === "replied";
  // Segment axes for campaigns / ad audiences.
  const minFollowers = Math.max(0, parseInt(q.get("min_followers") ?? "0", 10) || 0);
  const countries = (q.get("country") ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  const batch = q.get("batch") ?? `${platformParam}-${new Date().toISOString().slice(0, 10)}`;

  const union = leadSourcesSql(platforms);
  const rows = await pool
    .query<{ email: string; platform: string; name: string | null; followers: number | null; country: string | null; profile_url: string | null; found_at: string | null; verdict: string | null }>(
      `WITH src AS (${union})
       SELECT DISTINCT ON (s.email) s.email, s.platform, s.name, s.followers, s.country, s.profile_url,
              s.found_at, v.verdict
         FROM src s
         LEFT JOIN email_verification v ON v.email = s.email
        WHERE s.email NOT IN (${SUPPRESSED_SQL})
          AND s.email NOT IN (SELECT email FROM lead_exports)
          ${verifiedOnly ? `AND v.verdict = 'valid'` : `AND COALESCE(v.verdict,'unknown') <> 'invalid'`}
          ${engagedOnly ? `AND s.email IN (${OPENED_SQL})` : ``}
          ${repliedOnly ? `AND s.email IN (${REPLIED_SQL})` : ``}
          ${minFollowers > 0 ? `AND COALESCE(s.followers, 0) >= $2` : ``}
          ${countries.length > 0 ? `AND UPPER(COALESCE(s.country, '')) = ANY($${minFollowers > 0 ? 3 : 2}::text[])` : ``}
        ORDER BY s.email, s.found_at DESC NULLS LAST
        LIMIT $1`,
      [limit, ...(minFollowers > 0 ? [minFollowers] : []), ...(countries.length > 0 ? [countries] : [])]
    )
    .then((r) => r.rows)
    .catch((e: unknown) => {
      console.error("[leads/export] query failed:", e);
      return null;
    });
  if (rows === null) {
    return NextResponse.json({ error: "query failed", batch, platform: platformParam }, { status: 500 });
  }

  if (!dry && rows.length > 0) {
    await pool.query(
      `INSERT INTO lead_exports (email, platform, batch)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[]) ON CONFLICT (email) DO NOTHING`,
      [rows.map((r) => r.email), rows.map((r) => r.platform), rows.map(() => batch)]
    );
  }

  if (q.get("format") === "csv") {
    const header = "email,platform,name,followers,country,profile_url,found_at\n";
    const body = rows.map((r) => [r.email, r.platform, r.name, r.followers, r.country, r.profile_url, r.found_at].map(csvCell).join(",")).join("\n");
    return new NextResponse(header + body, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${batch}.csv"` },
    });
  }
  return NextResponse.json({
    batch, dry, count: rows.length,
    filters: {
      platform: platformParam,
      verified: verifiedOnly ? "smtp-verified live only" : "not-invalid",
      engagement: repliedOnly ? "replied to our cold mail (warmest)" : engagedOnly ? "opened our mail" : "any",
      ...(minFollowers > 0 ? { min_followers: minFollowers } : {}),
      ...(countries.length > 0 ? { country: countries } : {}),
    },
    leads: rows,
    ts: new Date().toISOString(),
  });
}

/** Feedback loop: { outcomes: [{ email, outcome }] }. Bad outcomes are suppressed here too. */
export async function POST(request: Request) {
  if (!bridgeAuthorized(request)) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as { outcomes?: { email?: string; outcome?: string }[] };
  const items = (body.outcomes ?? []).filter((o) => o.email && o.outcome);
  if (items.length === 0) return NextResponse.json({ error: "outcomes[] required" }, { status: 400 });

  const { quarantineEmail } = await import("@/lib/emailScrub");
  let recorded = 0, suppressed = 0;
  for (const { email, outcome } of items) {
    const e = String(email).trim().toLowerCase();
    const o = String(outcome).trim().toLowerCase();
    await pool.query(
      `UPDATE lead_exports SET outcome = $2, outcome_at = now() WHERE email = $1`, [e, o]
    ).then((r) => { recorded += r.rowCount ?? 0; }).catch(() => {});
    if (/bounce|complain|spam|unsub|invalid/.test(o)) {
      await quarantineEmail(e, `esputnik feedback: ${o}`);
      suppressed++;
    }
  }
  return NextResponse.json({ ok: true, recorded, suppressed, ts: new Date().toISOString() });
}
