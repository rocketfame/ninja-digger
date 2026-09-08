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
 *   - `engagement=engaged` restricts to people who actually opened/clicked our
 *     cold mail — a warm segment, far safer for the main domain than raw cold
 *
 * Params: platform=soundcloud|spotify|youtube|beatport|all, limit (max 5000),
 *         batch=<label>, format=json|csv, verified=only|any,
 *         engagement=any|engaged, dry=1 (preview, records nothing)
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isAuthorized, unauthorized } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PLATFORMS = ["soundcloud", "spotify", "youtube", "beatport"] as const;
type Platform = (typeof PLATFORMS)[number];

/** One SELECT per source table, normalised to the same shape. */
function sourceSql(p: Platform): string {
  switch (p) {
    case "soundcloud":
      return `SELECT LOWER(email) email, 'soundcloud' platform, COALESCE(full_name, username) name,
                     followers_count followers, country_code country, permalink_url profile_url,
                     email_found_at found_at, COALESCE(opens,0) opens, email_status
                FROM sc_artists
               WHERE email IS NOT NULL AND COALESCE(email_status,'') NOT IN ('bounced','unsub','junk')`;
    case "spotify":
      return `SELECT LOWER(email), 'spotify', COALESCE(full_name, ig_username), followers, NULL, NULL,
                     enriched_at, COALESCE(opens,0), email_status
                FROM spotify_leads
               WHERE email IS NOT NULL AND COALESCE(email_status,'') NOT IN ('bounced','unsub','junk')`;
    case "youtube":
      return `SELECT LOWER(email), 'youtube', name, followers, NULL, source_url,
                     email_found_at, 0, email_status
                FROM radar_leads
               WHERE email IS NOT NULL AND COALESCE(email_status,'') NOT IN ('bounced','unsub','junk')`;
    case "beatport":
      return `SELECT LOWER(TRIM(ac.value)), 'beatport', am.artist_name, NULL, NULL, NULL,
                     ac.created_at, COALESCE(ac.opens,0), ac.status
                FROM artist_contacts ac
                LEFT JOIN artist_metrics am ON am.artist_beatport_id = ac.artist_beatport_id
               WHERE ac.type='email' AND COALESCE(ac.status,'ok')='ok'`;
  }
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const q = new URL(request.url).searchParams;

  const platformParam = (q.get("platform") ?? "soundcloud").toLowerCase();
  const platforms: Platform[] = platformParam === "all" ? [...PLATFORMS] : PLATFORMS.filter((p) => p === platformParam);
  if (platforms.length === 0) {
    return NextResponse.json({ error: `platform must be one of ${PLATFORMS.join(", ")} or "all"` }, { status: 400 });
  }
  const limit = Math.min(5000, Math.max(1, parseInt(q.get("limit") ?? "500", 10) || 500));
  const dry = q.get("dry") === "1";
  const verifiedOnly = (q.get("verified") ?? "only") !== "any";
  const engagedOnly = (q.get("engagement") ?? "any") === "engaged";
  const batch = q.get("batch") ?? `${platformParam}-${new Date().toISOString().slice(0, 10)}`;

  const union = platforms.map(sourceSql).join("\n UNION ALL\n");
  const rows = await pool
    .query<{ email: string; platform: string; name: string | null; followers: number | null; country: string | null; profile_url: string | null; found_at: string | null; verdict: string | null }>(
      `WITH src AS (${union})
       SELECT DISTINCT ON (s.email) s.email, s.platform, s.name, s.followers, s.country, s.profile_url,
              s.found_at, v.verdict
         FROM src s
         LEFT JOIN email_verification v ON v.email = s.email
        WHERE s.email NOT IN (SELECT LOWER(email) FROM email_blacklist)
          AND s.email NOT IN (SELECT email FROM lead_exports)
          ${verifiedOnly ? `AND v.verdict = 'valid'` : `AND COALESCE(v.verdict,'unknown') <> 'invalid'`}
          ${engagedOnly ? `AND (s.opens > 0 OR s.email_status = 'engaged')` : ``}
        ORDER BY s.email, s.found_at DESC NULLS LAST
        LIMIT $1`,
      [limit]
    )
    .then((r) => r.rows)
    .catch((e) => { throw e; });

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
    filters: { platform: platformParam, verified: verifiedOnly ? "smtp-verified live only" : "not-invalid", engagement: engagedOnly ? "opened or clicked our mail" : "any" },
    leads: rows,
    ts: new Date().toISOString(),
  });
}

/** Feedback loop: { outcomes: [{ email, outcome }] }. Bad outcomes are suppressed here too. */
export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
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
