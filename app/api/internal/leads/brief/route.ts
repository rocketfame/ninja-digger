/**
 * GET /api/internal/leads/brief?email=a@b.com
 *
 * Everything a human (or an assistant in a Claude project) needs to answer one
 * lead, as plain text in a single paste: who they are, which channel they came
 * from, what we have already said, the verified chart facts that are the only
 * numbers anyone may cite, and the offer for that channel.
 *
 * This exists because the reply is only as good as the context behind it, and
 * assembling that context by hand is where wrong claims come from — a track we
 * never verified, a position nobody checked, a "new release" that is ten years
 * old.
 *
 * Returns text/plain by default (paste it straight into the chat); ?format=json
 * for programmatic use.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isAuthorized, unauthorized } from "@/lib/apiAuth";
import { getBeatportFacts } from "@/lib/leadFacts";
import { getThreadContext } from "@/lib/threadContext";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authorized(request: Request): boolean {
  const token = process.env.LEADGEN_TOKEN;
  if (token && request.headers.get("authorization") === `Bearer ${token}`) return true;
  return isAuthorized(request);
}

/** Which platform this address came from, and the id we need for chart facts. */
async function identify(email: string) {
  const bp = await pool
    .query<{ id: string; name: string | null }>(
      `SELECT ac.artist_beatport_id id, am.artist_name name FROM artist_contacts ac
         LEFT JOIN artist_metrics am ON am.artist_beatport_id = ac.artist_beatport_id
        WHERE ac.type='email' AND LOWER(TRIM(ac.value)) = $1 LIMIT 1`, [email])
    .then((r) => r.rows[0]).catch(() => undefined);
  if (bp) return { channel: "Beatport", key: "beatport", name: bp.name, beatportId: bp.id };

  const sc = await pool
    .query<{ name: string | null; url: string | null }>(
      `SELECT COALESCE(full_name, username) name, permalink_url url FROM sc_artists
        WHERE LOWER(email) = $1 LIMIT 1`, [email])
    .then((r) => r.rows[0]).catch(() => undefined);
  if (sc) return { channel: "SoundCloud", key: "soundcloud", name: sc.name, profile: sc.url };

  const sp = await pool
    .query<{ name: string | null }>(
      `SELECT COALESCE(full_name, ig_username) name FROM spotify_leads WHERE LOWER(email) = $1 LIMIT 1`, [email])
    .then((r) => r.rows[0]).catch(() => undefined);
  if (sp) return { channel: "Spotify", key: "spotify", name: sp.name };

  const rd = await pool
    .query<{ name: string | null; url: string | null }>(
      `SELECT name, source_url url FROM radar_leads WHERE LOWER(email) = $1 LIMIT 1`, [email])
    .then((r) => r.rows[0]).catch(() => undefined);
  if (rd) return { channel: "YouTube", key: "radar", name: rd.name, profile: rd.url };

  return null;
}

async function getOffer(key: string) {
  const keys = [`offer_${key}_name`, `offer_${key}_url`, `offer_${key}_code`, `offer_${key}_facts`];
  const rows = await pool
    .query<{ key: string; value: string }>(`SELECT key, value FROM app_settings WHERE key = ANY($1::text[])`, [keys])
    .then((r) => r.rows).catch(() => []);
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    name: m[keys[0]] ?? null, url: m[keys[1]] ?? null,
    code: m[keys[2]] ?? null, facts: m[keys[3]] ?? null,
  };
}

export async function GET(request: Request) {
  if (!authorized(request)) return unauthorized();
  const q = new URL(request.url).searchParams;
  const email = (q.get("email") ?? "").trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "email= required" }, { status: 400 });

  const who = await identify(email);
  const offer = who ? await getOffer(who.key) : null;
  const facts = who?.beatportId ? await getBeatportFacts(who.beatportId) : null;
  const tc = await getThreadContext(email);

  const sent = await pool
    .query<{ sent_at: string; template_id: string; sender: string | null; replied_at: string | null }>(
      `SELECT sent_at, template_id, sender, replied_at FROM outreach_events
        WHERE channel='email' AND LOWER(contact_value) = $1 ORDER BY sent_at DESC LIMIT 5`, [email])
    .then((r) => r.rows).catch(() => []);

  const suppressed = await pool
    .query<{ reason: string }>(`SELECT reason FROM email_blacklist WHERE LOWER(email) = $1 LIMIT 1`, [email])
    .then((r) => r.rows[0]?.reason ?? null).catch(() => null);

  if (q.get("format") === "json") {
    return NextResponse.json({ email, ...who, offer, facts, thread: tc.thread, customer: tc.customer, sent, suppressed });
  }

  const L: string[] = [];
  L.push(`LEAD: ${who?.name ?? "(name unknown)"} <${email}>`);
  L.push(`CHANNEL: ${who?.channel ?? "unknown — this address is not in our lead tables"}`);
  if (who && "profile" in who && who.profile) L.push(`PROFILE: ${who.profile}`);
  if (suppressed) L.push(`\n!! SUPPRESSED (${suppressed}) — do not send anything.`);
  if (tc.customer) L.push(`\n!! ALREADY A CUSTOMER — onboarding mode, no offer link, no packages.`);

  L.push(`\nWHAT WE SENT`);
  L.push(sent.length
    ? sent.map((s) => `  ${s.sent_at} ${s.template_id}${s.replied_at ? " (replied)" : ""}`).join("\n")
    : "  nothing on record");

  if (tc.thread) L.push(`\nTHREAD SO FAR\n${tc.thread}`);

  L.push(`\nVERIFIED FACTS — the only track, chart and positions you may cite`);
  L.push(facts ?? "  none on record. Do NOT name a track, chart or position.");

  if (offer?.name) {
    L.push(`\nOFFER FOR THIS CHANNEL`);
    L.push(`  ${offer.name}`);
    if (offer.url) L.push(`  ${offer.url}`);
    if (offer.code) L.push(`  code ${offer.code} (personal discount from Max)`);
    if (offer.facts) L.push(`\nPRODUCT FACTS — the only claims you may make\n${offer.facts}`);
  }

  return new NextResponse(L.join("\n"), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
