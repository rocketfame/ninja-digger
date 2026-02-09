/**
 * BP Top Tracker artist URL: https://www.bptoptracker.com/artist/{slug}/{numeric_id}
 * BP Top Tracker тягне дані з Beatport (API) — каталог артистів той самий, numeric_id = Beatport artist ID.
 */

const BPTOTRACKER_ORIGIN = "https://www.bptoptracker.com";

/**
 * Повертає коректний URL артиста на bptoptracker.com.
 * Якщо немає slug або не числовий id — повертає null (посилання без id дає 404).
 */
export function getBptoptrackerArtistUrl(slug: string | null, numericId: string | null): string | null {
  if (!slug?.trim() || !numericId?.trim()) return null;
  if (!/^\d+$/.test(numericId.trim())) return null;
  const cleanSlug = slug.trim().replace(/^\/+|\/+$/g, "").replace(/\s+/g, "-").toLowerCase();
  if (!cleanSlug) return null;
  return `${BPTOTRACKER_ORIGIN}/artist/${encodeURIComponent(cleanSlug)}/${numericId.trim()}`;
}

/** Slug з імені артиста для URL (lowercase, пробіли → дефіси). */
export function slugifyArtistName(name: string | null): string {
  if (!name?.trim()) return "artist";
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "artist";
}

/**
 * Витягнути numeric Beatport artist ID з фінального URL bptoptracker (наприклад /artist/snow/11744 → "11744").
 */
export function parseNumericIdFromBptoptrackerUrl(url: string): string | null {
  const match = String(url).match(/\/artist\/[^/]+\/(\d+)(?:\?|$)/i);
  return match ? match[1] : null;
}

/**
 * Resolve BP Top Tracker artist URL: fetch /artist/slug with cookie, follow redirects.
 * Returns final URL (e.g. /artist/slug/id) or null on 404/failure.
 */
export async function resolveBptoptrackerArtistUrl(slug: string): Promise<string | null> {
  if (!slug?.trim()) return null;
  const cleanSlug = slug.trim().replace(/^\/+|\/+$/g, "").replace(/\s+/g, "-");
  if (!cleanSlug) return null;
  try {
    const { getBptoptrackerCookie } = await import("./bptoptrackerAuth");
    const cookie = await getBptoptrackerCookie();
    const url = `${BPTOTRACKER_ORIGIN}/artist/${encodeURIComponent(cleanSlug)}`;
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml",
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    if (!res.ok) return null;
    const final = res.url;
    if (!final) return null;
    const path = new URL(final, BPTOTRACKER_ORIGIN).pathname;
    if (/\/artist\/[^/]+\/\d+/.test(path)) return final;
    return null;
  } catch {
    return null;
  }
}
