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
