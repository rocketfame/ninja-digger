/**
 * Blocklist: UI/nav text that must never be stored as artist or track from BP Top Tracker.
 * Prevents "Try now", "Register now.", "Sign in", "About us" etc. from polluting the DB.
 */

const BLOCKLIST = new Set([
  "try now",
  "register now.",
  "register now",
  "sign in",
  "about us",
  "about us →",
  "forgot password?",
  "forgot password",
  "login",
  "password",
  "email",
  "remember me",
  "unknown",
  "tops",
  "©",
  "© 2013-2026",
  "all rights reserved",
  "privacy policy",
  "terms of service",
  "terms of use",
  "contact",
  "faq",
  "about",
  "→",
  "home",
  "dashboard",
  "settings",
  "search",
  "see more",
  "load more",
  "next",
  "previous",
  "submit",
  "cancel",
  "close",
  "menu",
  "nav",
  "footer",
  "cookie",
  "accept",
  "decline",
  "bptoptracker",
  "beatport top tracker",
  "keeping an eye",
  "don't miss",
  "historical data",
  "register for free",
  "beatport top 100",
  "140 / deep dubstep / grime",
]);

const BLOCKLIST_TRACK = new Set([
  ...BLOCKLIST,
  "tops",
  "sign in",
  "forgot password?",
  "→",
  "© 2013-2026 bp top tracker.",
]);

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Strip trailing arrow/symbols and space for blocklist match (e.g. "about us →" → "about us"). */
function stripTrailingNav(s: string): string {
  return s.replace(/\s*[→↗⟶➔›]\s*.*$/gi, "").trim();
}

export function isBlockedArtist(name: string | null | undefined): boolean {
  if (!name || typeof name !== "string") return true;
  const n = normalizeForMatch(name);
  if (n.length < 2) return true;
  if (BLOCKLIST.has(n)) return true;
  const nStripped = normalizeForMatch(stripTrailingNav(name));
  if (nStripped && BLOCKLIST.has(nStripped)) return true;
  if (/about\s+us\b/i.test(n)) return true;
  if (n.includes("→") || n.includes("©") || n.length > 80) return true;
  if (/^(top|chart|track|artist)\s*\d*$/i.test(n)) return true;
  if (/^\d+\s*\/\s*.+/.test(n)) return true;
  return false;
}

export function isBlockedTrack(title: string | null | undefined): boolean {
  if (title == null || title === "") return false;
  const t = normalizeForMatch(String(title));
  if (t.length < 2) return false;
  if (BLOCKLIST_TRACK.has(t)) return true;
  if (t.includes("→") || t.includes("©")) return true;
  if (/^(forgot|password|sign in|login|email|remember)/i.test(t)) return true;
  return false;
}

/** Returns true if HTML looks like login/landing page, not a chart. */
export function looksLikeLoginOrLandingPage(html: string): boolean {
  const lower = html.toLowerCase();
  const hasLogin = /\b(sign in|login|password|email\s*:)\b/.test(lower);
  const hasNav = /\b(try now|register now|about us)\b/.test(lower);
  const smallOrNoChart = html.length < 15000 || !/\b(top 100|chart|position)\b/i.test(html);
  // Login page can be ~19k bytes; treat as login if it has the login form (email + password inputs)
  const hasLoginForm = /name="email"/i.test(html) && (/name="password"/i.test(html) || /password\s*:/i.test(lower));
  return ((hasLogin || hasNav) && smallOrNoChart) || hasLoginForm;
}

/** Values to use in SQL: LOWER(artist_name) IN (...). For cleanup of bad rows. */
export function getBlocklistValuesForSql(): string[] {
  return Array.from(BLOCKLIST);
}
