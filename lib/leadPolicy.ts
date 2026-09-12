/**
 * The one definition of every lead segment we talk about.
 *
 * These questions used to be answered separately in seven places — the
 * marketing bridge, the validation audit, the verification script, the four
 * sender barrels and the daily report — and the answers had drifted apart. The
 * worst case cost us a segment: "engaged" read per-table `opens` counters in
 * one place and Brevo's event log in another, and radar_leads has no `opens`
 * column at all, so its openers were invisible to half the system.
 *
 * Everything here is a plain SQL fragment with no parameters, so it composes
 * into any query and stays unit-testable.
 */

/** Brevo events that mean a human engaged. Apple's `loadedbyproxy` pixel prefetch is a machine, not a person. */
export const OPEN_EVENTS = ["opened", "uniqueopened", "click", "clicks"] as const;

/** Same list, for the TypeScript side (brevo-poll classifying an incoming event). */
export function isOpenEvent(event: string): boolean {
  return (OPEN_EVENTS as readonly string[]).includes(event.toLowerCase());
}

const quoted = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(",");

/** Addresses that opened or clicked one of our emails — the warm segment. */
export const OPENED_SQL = `SELECT email FROM email_events WHERE event IN (${quoted(OPEN_EVENTS)})`;

/** Addresses that wrote back. Every reply lands in tg_notifications. */
export const REPLIED_SQL = `SELECT LOWER(email) FROM tg_notifications WHERE email IS NOT NULL`;

/** Addresses we may never mail again: dead mailbox, junk/role, bounce, opt-out. */
export const SUPPRESSED_SQL = `SELECT LOWER(email) FROM email_blacklist`;

/**
 * Addresses the SMTP layer has looked at and not found dead. 'unknown' stays in:
 * it is what Outlook, Yahoo and iCloud return because they refuse probes, and
 * that is a fifth of the base — unverifiable is not the same as bad. What is
 * excluded is 'invalid' and, deliberately, NEVER CHECKED: an address is not
 * usable until the mailbox check has seen it. That check runs off-platform
 * (port 25 is blocked on Vercel), so a fresh address waits for the next pass.
 */
export const MAILBOX_CHECKED_SQL = `SELECT email FROM email_verification WHERE verdict <> 'invalid'`;

/** Addresses the marketing side owns right now — released when it reports 'cold'. */
export const HANDED_OVER_SQL = `SELECT email FROM lead_exports WHERE COALESCE(outcome,'') <> 'cold'`;

/**
 * The mass channel's rules, in one place so eSputnik and listmonk both obey
 * them through the same bridge:
 *   - ONE mass email per address, ever (user, 12.09: "повертати не треба").
 *     An address handed over once is never handed over again, whatever the
 *     outcome; the ledger row is the proof of the touch.
 *   - never within 15 days of a cold personal email
 *   - a purchase moves the person to the customer flow: no more mass mail
 * Bounce, complaint and unsubscribe are not listed here because they land in
 * email_blacklist, which every channel already honours.
 */
export const MASS_CYCLE = { afterColdDays: 15 } as const;

/** Sources that write mass-channel events into email_events (meta.src). */
export const MASS_SOURCES = ["esputnik", "listmonk"] as const;

/** Ever handed over to the mass channel — once is the limit. */
export const MASS_TOUCHED_SQL = `SELECT email FROM lead_exports`;

/**
 * Bought or registered: the customer flow on the main site owns them now.
 * Two sources, either is enough: what the mass channel learned (ledger) and
 * the shop's own customer list, mirrored daily from Shopify.
 */
export const CONVERTED_SQL = `SELECT email FROM lead_exports WHERE outcome = 'converted'
     UNION SELECT email FROM shop_customers`;


/**
 * May the mass channel take this address in this batch? `col` holds the
 * address, `coldCol` the timestamp of the last cold personal email (NULL if
 * none). Suppression is not repeated here: the bridge applies SUPPRESSED_SQL
 * itself, as every channel does.
 */
export function massEligibleSql(col = "email", coldCol = "cold_at"): string {
  const e = `LOWER(${col})`;
  return `${e} NOT IN (${MASS_TOUCHED_SQL})
     AND ${e} NOT IN (${CONVERTED_SQL})
     AND (${coldCol} IS NULL OR ${coldCol} < now() - interval '${MASS_CYCLE.afterColdDays} days')`;
}

/**
 * May we send COLD mail to this address?
 *
 * `col` is the column or expression holding the address, so a barrel can pass
 * `email` and the Beatport pipeline can pass `TRIM(ac.value)`.
 *
 * Sending in parallel with the marketing side would mean two different letters
 * from one brand, which is the fastest way to earn complaints — hence the
 * handover check. Russian/Belarusian domains are excluded on policy.
 */
export function contactableSql(col = "email", opts: { requireMailboxCheck?: boolean } = {}): string {
  const e = `LOWER(${col})`;
  // The mailbox check is a gate for SENDING. The verifier that produces those
  // verdicts must not be behind it, or it can never see the addresses it is
  // supposed to check — which is exactly what happened the first hour.
  const checked = opts.requireMailboxCheck === false ? `` : `\n     AND ${e} IN (${MAILBOX_CHECKED_SQL})`;
  return `${col} IS NOT NULL
     AND ${e} NOT IN (${SUPPRESSED_SQL})
     AND ${e} NOT IN (SELECT email FROM shop_customers)
     AND ${col} !~* '\\.(ru|su|by)$|yandex\\.'
     AND ${e} NOT IN (${HANDED_OVER_SQL})${checked}`;
}

export const PLATFORMS = ["soundcloud", "spotify", "youtube", "beatport"] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * The four lead tables as one normalised relation.
 *
 * Every branch names AND types its columns: a UNION takes names from its first
 * branch only, so an unaliased branch works inside the full union and breaks
 * the moment one platform is selected on its own. A bare NULL needs a cast for
 * the same reason — alone in a branch there is no sibling column to infer from.
 *
 * `touch` is how many cold emails the lead has had (Beatport tracks this in
 * lead_profiles rather than on the contact row, so it reports 0 here).
 * `cold_at` is when the last cold email went out — the mass channel keeps its
 * distance from it (see massEligibleSql). Beatport is never mass-mailed.
 */
function sourceSql(p: Platform): string {
  switch (p) {
    case "soundcloud":
      return `SELECT LOWER(email) email, 'soundcloud' platform, COALESCE(full_name, username) name,
                     followers_count::int followers, country_code::text country, permalink_url::text profile_url,
                     email_found_at found_at, COALESCE(sc_touch,0)::int touch, email_status, contacted_at cold_at
                FROM sc_artists
               WHERE email IS NOT NULL AND COALESCE(email_status,'') NOT IN ('bounced','unsub','junk')`;
    case "spotify":
      return `SELECT LOWER(email) email, 'spotify' platform, COALESCE(full_name, ig_username) name,
                     followers::int followers, NULL::text country, NULL::text profile_url,
                     enriched_at found_at, COALESCE(sp_touch,0)::int touch, email_status, contacted_at cold_at
                FROM spotify_leads
               WHERE email IS NOT NULL AND COALESCE(email_status,'') NOT IN ('bounced','unsub','junk')`;
    case "youtube":
      return `SELECT LOWER(email) email, 'youtube' platform, name,
                     followers::int followers, NULL::text country, source_url::text profile_url,
                     email_found_at found_at, COALESCE(touch,0)::int touch, email_status, contacted_at cold_at
                FROM radar_leads
               WHERE email IS NOT NULL AND COALESCE(email_status,'') NOT IN ('bounced','unsub','junk')`;
    case "beatport":
      return `SELECT LOWER(TRIM(ac.value)) email, 'beatport' platform, am.artist_name name,
                     NULL::int followers, NULL::text country, NULL::text profile_url,
                     ac.created_at found_at, 0::int touch, ac.status email_status, NULL::timestamptz cold_at
                FROM artist_contacts ac
                LEFT JOIN artist_metrics am ON am.artist_beatport_id = ac.artist_beatport_id
               WHERE ac.type='email' AND COALESCE(ac.status,'ok')='ok'`;
  }
}

/** The normalised union, for one platform or all of them. */
export function leadSourcesSql(platforms: readonly Platform[] = PLATFORMS): string {
  if (platforms.length === 0) throw new Error("leadSourcesSql: no platforms");
  return platforms.map(sourceSql).join("\n UNION ALL\n");
}
