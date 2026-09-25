/**
 * Which record labels may enter the label database, by country.
 *
 * Owner's rule (25.09.2026): only tier 1–3 countries. russia, belarus and
 * other hostile states — never. Ukrainian labels only when they are well known
 * and top. Anything outside the tier lists is excluded: an allowlist, not a
 * blocklist, so a country nobody thought about stays out by default.
 *
 * A label with no country on its profile is kept but must pass the language
 * and domain checks — that is where russian labels without a flag get caught.
 */

const TIER1 = ["US", "CA", "GB", "IE", "AU", "NZ", "DE", "NL", "BE", "LU", "FR", "CH", "AT", "DK", "SE", "NO", "FI", "IS"];
const TIER2 = ["ES", "IT", "PT", "JP", "KR", "SG", "IL", "AE", "PL", "CZ", "SK", "SI", "EE", "LV", "LT", "HR", "GR", "CY", "MT", "HU", "HK", "TW"];
const TIER3 = ["BR", "MX", "AR", "CL", "CO", "PE", "UY", "ZA", "RO", "BG", "TR", "IN", "TH", "MY", "PH", "ID"];
const HOSTILE = new Set(["RU", "BY", "IR", "KP", "SY"]);

const TIER = new Map<string, number>([
  ...TIER1.map((c) => [c, 1] as [string, number]),
  ...TIER2.map((c) => [c, 2] as [string, number]),
  ...TIER3.map((c) => [c, 3] as [string, number]),
]);

/** Ukraine is allowed only for labels that are demonstrably top. */
export const UA_TOP = { minScFollowers: 10_000, minChartEntries: 30 } as const;

// Letters only russian/belarusian use (ы э ё ъ); Ukrainian-only letters (і ї є ґ).
const RU_LETTERS_RE = /[ыэёъЫЭЁЪ]/;
const UA_LETTERS_RE = /[іїєґІЇЄҐ]/;
const HOSTILE_TLD_RE = /\.(ru|su|by|рф)(\/|$|:)/i;

export type CountryVerdict = { ok: true; tier: number | null; country: string | null } | { ok: false; reason: string };

export function countryVerdict(l: {
  country_code?: string | null;
  description?: string | null;
  website?: string | null;
  sc_followers?: number | null;
  chart_entries?: number | null;
}): CountryVerdict {
  let cc = (l.country_code || "").trim().toUpperCase() || null;
  const text = l.description || "";

  if (l.website && HOSTILE_TLD_RE.test(l.website)) return { ok: false, reason: `hostile domain (${l.website})` };
  if (cc && HOSTILE.has(cc)) return { ok: false, reason: `hostile country (${cc})` };
  // No flag on the profile: the language of the bio tells us.
  if (!cc && RU_LETTERS_RE.test(text)) return { ok: false, reason: "russian-language profile" };
  if (!cc && UA_LETTERS_RE.test(text)) cc = "UA";

  if (cc === "UA") {
    const top = (l.sc_followers ?? 0) >= UA_TOP.minScFollowers || (l.chart_entries ?? 0) >= UA_TOP.minChartEntries;
    return top ? { ok: true, tier: 2, country: "UA" } : { ok: false, reason: "UA label below the top bar" };
  }
  if (!cc) return { ok: true, tier: null, country: null };
  const tier = TIER.get(cc);
  return tier ? { ok: true, tier, country: cc } : { ok: false, reason: `country outside tiers 1–3 (${cc})` };
}

// Country-code TLDs that name a country; generic ones (.com, .io, .fm, .co, .me,
// .tv, .ai) say nothing and are skipped.
const TLD_COUNTRY: Record<string, string> = {
  uk: "GB", de: "DE", nl: "NL", be: "BE", fr: "FR", ch: "CH", at: "AT", dk: "DK", se: "SE", no: "NO", fi: "FI", is: "IS", ie: "IE",
  au: "AU", nz: "NZ", ca: "CA", us: "US", lu: "LU", es: "ES", it: "IT", pt: "PT", jp: "JP", kr: "KR", sg: "SG", il: "IL", ae: "AE",
  pl: "PL", cz: "CZ", sk: "SK", si: "SI", ee: "EE", lv: "LV", lt: "LT", hr: "HR", gr: "GR", cy: "CY", mt: "MT", hu: "HU", hk: "HK",
  tw: "TW", br: "BR", mx: "MX", ar: "AR", cl: "CL", pe: "PE", uy: "UY", za: "ZA", ro: "RO", bg: "BG", tr: "TR", in: "IN", th: "TH",
  my: "MY", ph: "PH", id: "ID", ua: "UA", ru: "RU", su: "RU", by: "BY", ir: "IR", rs: "RS",
};

/** Best guess of a label's country from its website domain, or null. */
export function countryFromDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.toLowerCase();
    const tld = host.split(".").pop() ?? "";
    return TLD_COUNTRY[tld] ?? null;
  } catch { return null; }
}
