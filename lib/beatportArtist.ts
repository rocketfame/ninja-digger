/**
 * Fetch canonical artist name and image from Beatport artist page.
 * URL format: https://www.beatport.com/artist/{slug}/{id}
 * We use this as source of truth when we have a numeric Beatport artist ID.
 */

const BEATPORT_ORIGIN = "https://www.beatport.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type BeatportArtistInfo = {
  name: string;
  imageUrl: string | null;
  slug: string | null;
  url: string;
};

/**
 * Returns true if id looks like a Beatport numeric artist ID (not synthetic like bptoptracker:xxx).
 */
export function isNumericBeatportId(id: string): boolean {
  return /^\d+$/.test(String(id).trim());
}

/**
 * Resolve Beatport artist URL by slug: GET /artist/{slug}, follow redirect to /artist/{slug}/{id}.
 * Returns { url, numericId } or null. Use when BPTT resolve returns 404 (BPTT often 404s on slug-only server-side).
 */
export async function resolveBeatportArtistUrl(slug: string): Promise<{ url: string; numericId: string } | null> {
  if (!slug?.trim()) return null;
  const cleanSlug = slug.trim().replace(/^\/+|\/+$/g, "").replace(/\s+/g, "-").toLowerCase();
  if (!cleanSlug) return null;
  try {
    const url = `${BEATPORT_ORIGIN}/artist/${encodeURIComponent(cleanSlug)}`;
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    const final = res.url;
    if (!final) return null;
    const match = final.match(/\/artist\/[^/]+\/(\d+)(?:\?|$)/i);
    if (!match) return null;
    return { url: final, numericId: match[1] };
  } catch {
    return null;
  }
}

/**
 * Fetch artist page and parse name + image. Uses slug if provided, else tries /artist/artist/{id}.
 * Updates artist_metrics.artist_name when name differs (caller can pass pool to persist).
 */
export async function fetchBeatportArtistInfo(
  artistBeatportId: string,
  slugFromDb: string | null
): Promise<BeatportArtistInfo | null> {
  const id = String(artistBeatportId).trim();
  if (!id || !isNumericBeatportId(id)) return null;

  const slug = (slugFromDb || "artist").replace(/^\/+|\/+$/g, "") || "artist";
  const pathsToTry = [`/artist/${slug}/${id}`, `/artist/${id}`];

  for (const path of pathsToTry) {
    const url = `${BEATPORT_ORIGIN}${path}`;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "en-US,en;q=0.9",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
      });
      if (!res.ok) continue;
      const finalUrl = res.url;
      const html = await res.text();
      const name = parseArtistName(html);
      const imageUrl = parseArtistImage(html);
      const slugFromUrl = finalUrl.match(/\/artist\/([^/]+)\/\d+$/)?.[1] ?? null;
      if (name) {
        return { name, imageUrl, slug: slugFromUrl, url: finalUrl };
      }
    } catch {
      continue;
    }
  }
  return null;
}

function parseArtistName(html: string): string | null {
  const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)?.[1];
  if (ogTitle) {
    const beforePipe = ogTitle.split("|")[0]?.trim();
    if (beforePipe) return beforePipe;
  }
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1];
  if (h1) return h1.trim() || null;
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  if (title) return title.split("|")[0]?.trim() || null;
  return null;
}

function parseArtistImage(html: string): string | null {
  const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)?.[1];
  if (ogImage) return ogImage.trim();
  const twitterImage = html.match(/<meta\s+name="twitter:image"\s+content="([^"]+)"/i)?.[1];
  if (twitterImage) return twitterImage.trim();
  return null;
}
