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
export function groupNameFor(platform: string, date = new Date()): string {
  const label: Record<string, string> = { soundcloud: "SoundCloud", spotify: "Spotify", youtube: "YouTube", beatport: "Beatport" };
  const d = `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${date.getUTCFullYear()}`;
  return `Leads: ${label[platform] ?? platform} ${d} (auto)`;
}

/** Our own groups: the only place a lead may live in eSputnik. */
export const LEAD_GROUP_RE = /^Leads: .* \(auto\)$/;

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
 * firstName carries characters it dislikes — 188 of 1 497 vanished that way
 * on the first push. Letters, digits, space, dot, apostrophe, hyphen only;
 * empty after cleaning means "send no name at all".
 */
export function cleanFirstName(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  const s = name.normalize("NFC").replace(/[^\p{L}\p{N} .'\-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return s || undefined;
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
