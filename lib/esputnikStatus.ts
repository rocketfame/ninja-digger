/**
 * eSputnik activity → our email_events vocabulary. Pure, so the mapping is
 * unit-tested without a database. Our vocabulary is Brevo's (the first source
 * we had): delivered / opened / click / hard_bounce / unsubscribed / spam.
 */
export const ESPUTNIK_STATUS: Record<string, string> = {
  DELIVERED: "delivered",
  READ: "opened",
  CLICKED: "click",
  UNSUBSCRIBED: "unsubscribed",
  SPAM: "spam",
  UNDELIVERED: "hard_bounce",
};

export function mapEsputnikStatus(status: string | undefined): string | null {
  if (!status) return null;
  return ESPUTNIK_STATUS[status.toUpperCase()] ?? null;
}

/** Outcome a status means for the lead_exports ledger (see recordOutcome). */
export function outcomeForEvent(event: string): string {
  switch (event) {
    case "opened": return "opened";
    case "click": return "clicked";
    case "hard_bounce": return "bounced";
    case "spam": return "complained";
    case "unsubscribed": return "unsubscribed";
    default: return "delivered";
  }
}

/** Group (static segment) name for one day's push, e.g. "Leads: SoundCloud 12.09.2026 (auto)". */
export function groupNameFor(platform: string, date = new Date(), batch?: number): string {
  const label: Record<string, string> = { soundcloud: "SoundCloud", spotify: "Spotify", youtube: "YouTube", beatport: "Beatport" };
  const d = `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${date.getUTCFullYear()}`;
  // A fresh group per batch: eSputnik's upsert only attaches to a group it
  // creates in the same call, so a second push into an existing group lands
  // nothing. "(auto)" stays the marker the whole system keys on.
  return batch && batch > 1 ? `Leads: ${label[platform] ?? platform} ${d} #${batch} (auto)` : `Leads: ${label[platform] ?? platform} ${d} (auto)`;
}

/** Our own groups: the only place a lead may live in eSputnik. */
// Anything the agent derives from our groups (A/B splits: "… (auto) A") is still a lead group.
export const LEAD_GROUP_RE = /^Leads: /;

export type EsputnikContact = {
  id?: number; externalCustomerId?: string | null;
  channels?: { type?: string; value?: string }[];
  groups?: { id?: number; name?: string }[];
};

/** The contact's email as eSputnik holds it, lower-cased; null if none. */
export function contactEmail(c: EsputnikContact): string | null {
  const ch = (c.channels ?? []).find((x) => (x.type ?? "").toLowerCase() === "email" && x.value);
  return ch?.value ? ch.value.trim().toLowerCase() : null;
}

/**
 * eSputnik rejects a contact silently (it just drops out of the batch) when
 * firstName fails its validator. What it told us on 16.09 (524 of 1 000
 * SoundCloud names refused): at most 40 characters, at most 3 words, letters
 * in any script, digits, apostrophe and hyphen only inside a word, one dot
 * only at the end of a word of up to 3 characters ("Jr."). A name that is
 * really a domain or address, or spaced-out letters ("D o n"), is not worth
 * a fragment: empty means "send no name at all".
 */
const NAME_MAX_CHARS = 40;
const NAME_MAX_WORDS = 3;
const DOMAIN_LIKE = /@|\.(com|net|org|io|co|fm|tv|me|uk|de|br|mx|es|fr|it|nl|ru|ua|info|biz|music|art|link|app|xyz)\b/i;
export function cleanFirstName(name: string | null | undefined): string | undefined {
  if (!name || DOMAIN_LIKE.test(name)) return undefined;
  const tokens = name
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} .'\-]/gu, " ")
    .split(/\s+/)
    .flatMap((t) => (/^[^.]{1,3}\.$/.test(t) ? [t] : t.split(".")))
    .map((t) => {
      const dot = t.endsWith(".") ? "." : "";
      const core = t.slice(0, t.length - dot.length).replace(/^['\-]+|['\-]+$/g, "");
      return core ? core + dot : "";
    })
    .filter((t) => t && t.length <= NAME_MAX_CHARS);
  if (tokens.filter((t) => t.length === 1).length >= 2) return undefined;
  let out = tokens.slice(0, NAME_MAX_WORDS);
  while (out.length && out.join(" ").length > NAME_MAX_CHARS) out = out.slice(0, -1);
  return out.length ? out.join(" ") : undefined;
}

/**
 * Is this eSputnik contact a real customer rather than one of our leads?
 * Two independent signs, either is enough: the shop integration stamped it
 * with a Shopify customer id (our pushes never set externalCustomerId), or it
 * sits in any group that is not one of our `Leads: … (auto)` groups
 * (Buyers, Registration, Guests, Newcomers …). Customers are never touched.
 */
export function isCustomerContact(c: EsputnikContact): boolean {
  if (c.externalCustomerId && String(c.externalCustomerId).trim() !== "") return true;
  return (c.groups ?? []).some((g) => g.name && !LEAD_GROUP_RE.test(g.name));
}
