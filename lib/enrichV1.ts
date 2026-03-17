/**
 * Enrichment v1: search-based discovery for соціальні мережі, нішові сайти музикантів, контакти.
 *
 * ЩО ШУКАЄМО (пошук: DuckDuckGo HTML → Bing → Startpage, без браузера):
 * - Instagram, SoundCloud, Linktree/Beacons/Carrd, Resident Advisor — як раніше.
 * - Bandcamp: "Artist Name" site:bandcamp.com → артисти/лейбли, часто є контакт у біо.
 * - Mixcloud: "Artist Name" site:mixcloud.com → DJ-профілі, контакти в описі.
 * - Reverb Nation: "Artist Name" site:reverbnation.com → профілі музикантів.
 * - SoundCloud: з профілю та опису витягуємо максимум email (часто є в біо); додатково пошук "Artist soundcloud email contact".
 *
 * ЩО ЗАПОВНЮЄМО:
 * - artist_links: один ряд на тип (instagram, soundcloud, linktree, resident_advisor, bandcamp, mixcloud, reverbnation, website).
 * - artist_contacts: email з усіх зібраних сторінок; source_url = звідки знайшли; для SoundCloud/Linktree трохи вища впевненість.
 *
 * Обмеження: rate limit 2 с, кеш URL 24 год, перевірка nameMatches. Публічні дані лише.
 */

import * as cheerio from "cheerio";
import { ProxyAgent } from "undici";
import { query, pool } from "@/lib/db";
import { computeConfidence, validateInstagramHandle } from "./enrichClassify";

/** Пул реалістичних User-Agent рядків — щоб кожен запит виглядав як інший браузер. */
const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
] as const;
function randomUA(): string { return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]; }

const RATE_DELAY_MS = 1000;       // затримка між запитами до сайтів (було 2000)
const SEARCH_DELAY_MS = 2000;     // довша затримка між запитами до пошуковиків (було 4000)
const CACHE_TTL_SECONDS = 86400;  // 24h
const REQUEST_TIMEOUT_MS = 10000;
const GLOBAL_TIMEOUT_MS = 50000;  // глобальний таймаут для всього enrichment — повертаємо що є

/**
 * Proxy rotation для пошукових запитів.
 * Встановіть SEARCH_PROXY_URL в .env:
 *   - HTTP/HTTPS proxy: http://user:pass@proxy.example.com:8080
 *   - Rotating proxy (Webshare, Bright Data): http://user:pass@p.webshare.io:80
 *   - ScraperAPI: використовує окремий формат (SCRAPER_API_KEY)
 *
 * Проксі використовується ТІЛЬКИ для пошукових систем (DDG, Bing, Startpage).
 * Прямі запити до сайтів (SoundCloud, RA, Instagram...) йдуть без проксі.
 */
function getSearchProxyAgent(): ProxyAgent | null {
  const proxyUrl = process.env.SEARCH_PROXY_URL;
  if (!proxyUrl) return null;
  try {
    return new ProxyAgent(proxyUrl);
  } catch {
    return null;
  }
}

/** ScraperAPI — альтернатива проксі: обертає URL і сам обходить anti-bot.
 *  Встановіть SCRAPER_API_KEY в .env.
 *  Якщо є SCRAPER_API_KEY — використовується замість прямого fetch для пошуку. */
function scraperApiUrl(targetUrl: string): string | null {
  const key = process.env.SCRAPER_API_KEY;
  if (!key) return null;
  return `https://api.scraperapi.com?api_key=${key}&url=${encodeURIComponent(targetUrl)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
/** Випадкова затримка ± 30% від базового значення — щоб патерн не був рівномірним. */
function jitteredDelay(baseMs: number): Promise<void> {
  const jitter = baseMs * 0.3;
  const actual = baseMs + (Math.random() * 2 - 1) * jitter;
  return delay(Math.max(500, Math.round(actual)));
}

export type DiscoveredLink = {
  type: "instagram" | "soundcloud" | "linktree" | "website" | "resident_advisor" | "bandcamp" | "mixcloud" | "reverbnation" | "facebook" | "twitter";
  url: string;
  confidence: number;
  source: string;
  quality_score?: number;
  validation_note?: string;
};

export type DiscoveredContact = {
  type: "email";
  value: string;
  source_url: string | null;
  confidence: number;
  email_type?: string;
  source_context?: string;
};

/** Повний набір заголовків сучасного Chrome — включно з sec-ch-ua для проходження bot-detection. */
function browserHeaders(referer?: string): Record<string, string> {
  const ua = randomUA();
  const isFirefox = ua.includes("Firefox");
  const headers: Record<string, string> = {
    "User-Agent": ua,
    "Accept-Language": "en-US,en;q=0.9",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": referer ? "cross-site" : "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
  };
  if (referer) headers["Referer"] = referer;
  if (!isFirefox) {
    // Chrome-specific client hints
    headers["sec-ch-ua"] = '"Chromium";v="131", "Not_A Brand";v="24"';
    headers["sec-ch-ua-mobile"] = "?0";
    headers["sec-ch-ua-platform"] = ua.includes("Macintosh") ? '"macOS"' : ua.includes("Windows") ? '"Windows"' : '"Linux"';
  }
  return headers;
}

/** Зберігаємо cookies між запитами до одного хосту — DDG/Bing перевіряють cookie. */
const cookieJar = new Map<string, string>();
function getCookieHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}
function applyCookies(url: string, headers: Record<string, string>): void {
  const host = getCookieHost(url);
  const cookie = cookieJar.get(host);
  if (cookie) headers["Cookie"] = cookie;
}
function storeCookies(url: string, setCookieHeaders: string[]): void {
  if (!setCookieHeaders.length) return;
  const host = getCookieHost(url);
  const existing = cookieJar.get(host) ?? "";
  const existingPairs = existing ? existing.split("; ").filter(Boolean) : [];
  const existingMap = new Map(existingPairs.map(p => { const [k] = p.split("="); return [k, p]; }));
  for (const raw of setCookieHeaders) {
    const pair = raw.split(";")[0]?.trim();
    if (pair) {
      const [k] = pair.split("=");
      existingMap.set(k, pair);
    }
  }
  cookieJar.set(host, [...existingMap.values()].join("; "));
}

/**
 * Fetch для пошукових систем — використовує проксі або ScraperAPI якщо налаштовано.
 * Пріоритет: ScraperAPI > SEARCH_PROXY_URL > прямий запит.
 */
async function fetchForSearch(url: string, extraHeaders?: Record<string, string>): Promise<string> {
  // 1. ScraperAPI — найпростіше, обертає URL
  const scraperUrl = scraperApiUrl(url);
  if (scraperUrl) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS * 2); // ScraperAPI може бути повільнішим
    try {
      const res = await fetch(scraperUrl, {
        signal: controller.signal,
        headers: { "User-Agent": randomUA() },
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`ScraperAPI HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      clearTimeout(t);
      throw e;
    }
  }

  // 2. Proxy Agent
  const proxyAgent = getSearchProxyAgent();
  if (proxyAgent) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers = browserHeaders(extraHeaders?.Referer);
      if (extraHeaders) Object.assign(headers, extraHeaders);
      applyCookies(url, headers);
      const res = await fetch(url, {
        signal: controller.signal,
        headers,
        redirect: "follow",
        // @ts-expect-error — Node.js undici dispatcher, not in standard fetch types
        dispatcher: proxyAgent,
      });
      clearTimeout(t);
      const setCookies = res.headers.getSetCookie?.() ?? [];
      storeCookies(url, setCookies);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      clearTimeout(t);
      throw e;
    }
  }

  // 3. Fallback — прямий fetch (як раніше)
  return fetchWithTimeout(url, extraHeaders);
}

async function fetchWithTimeout(url: string, extraHeaders?: Record<string, string>): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers = browserHeaders(extraHeaders?.Referer);
    if (extraHeaders) Object.assign(headers, extraHeaders);
    applyCookies(url, headers);
    const res = await fetch(url, {
      signal: controller.signal,
      headers,
      redirect: "follow",
    });
    clearTimeout(t);
    // Зберігаємо cookies з відповіді
    const setCookies = res.headers.getSetCookie?.() ?? [];
    storeCookies(url, setCookies);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

/** Check url_cache; if hit and not expired return body; else fetch, store (if DB ok), return. Falls back to fetchWithoutCache when DB unavailable. */
async function fetchWithCache(url: string): Promise<string | null> {
  const normalized = url.trim();
  if (!normalized) return null;
  try {
    const rows = await query<{ body: string | null; fetched_at: Date; ttl_seconds: number }>(
      `SELECT body, fetched_at, ttl_seconds FROM url_cache WHERE url = $1`,
      [normalized]
    );
    const row = rows[0];
    if (row?.body) {
      const age = (Date.now() - new Date(row.fetched_at).getTime()) / 1000;
      if (age < (row.ttl_seconds ?? CACHE_TTL_SECONDS)) return row.body;
    }
  } catch {
    // No DB or no table: skip cache, fetch below
  }
  try {
    await jitteredDelay(RATE_DELAY_MS);
    const body = await fetchWithTimeout(normalized);
    try {
      await pool.query(
        `INSERT INTO url_cache (url, body, fetched_at, ttl_seconds) VALUES ($1, $2, now(), $3)
         ON CONFLICT (url) DO UPDATE SET body = EXCLUDED.body, fetched_at = now()`,
        [normalized, body.slice(0, 500000), CACHE_TTL_SECONDS]
      );
    } catch {
      // Cache write failed; still return body
    }
    return body;
  } catch {
    return null;
  }
}

/** Extract real URL from DuckDuckGo redirect link (duckduckgo.com/l/?uddg=...). */
function unwrapDDGRedirect(href: string): string | null {
  if (!href || !href.includes("uddg=")) return null;
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (!uddg) return null;
    const decoded = decodeURIComponent(uddg);
    const target = new URL(decoded);
    if (target.hostname.includes("duckduckgo.com")) return null;
    return target.href;
  } catch {
    return null;
  }
}

/** Bing HTML search fallback; returns result URLs. */
async function searchBing(q: string): Promise<string[]> {
  const encoded = encodeURIComponent(q);
  const searchUrl = `https://www.bing.com/search?q=${encoded}&count=15`;
  try {
    await jitteredDelay(SEARCH_DELAY_MS);
    const html = await fetchForSearch(searchUrl, { Referer: "https://www.bing.com/" });
    const $ = cheerio.load(html);
    const seen = new Set<string>();
    const urls: string[] = [];
    $(".b_algo h2 a").each((_, el) => {
      const href = $(el).attr("href");
      if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
        try {
          const u = new URL(href);
          if (!u.hostname.includes("bing.com") && !u.hostname.includes("microsoft.com") && !seen.has(u.href)) {
            seen.add(u.href);
            urls.push(u.href);
          }
        } catch {
          // skip
        }
      }
    });
    return urls;
  } catch {
    return [];
  }
}

/** Startpage HTML search fallback; returns result URLs. */
async function searchStartpage(q: string): Promise<string[]> {
  const encoded = encodeURIComponent(q);
  const searchUrl = `https://www.startpage.com/sp/search?query=${encoded}`;
  try {
    await jitteredDelay(SEARCH_DELAY_MS);
    const html = await fetchForSearch(searchUrl, { Referer: "https://www.startpage.com/" });
    const $ = cheerio.load(html);
    const seen = new Set<string>();
    const urls: string[] = [];
    $("h3.clk a, .w-gl__result-url").each((_, el) => {
      const href = $(el).attr("href");
      if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
        try {
          const u = new URL(href);
          if (!u.hostname.includes("startpage.com") && !seen.has(u.href)) {
            seen.add(u.href);
            urls.push(u.href);
          }
        } catch {
          // skip
        }
      }
    });
    return urls;
  } catch {
    return [];
  }
}

/** Extract real URLs from DDG HTML by finding uddg= in raw HTML (fallback when selectors miss). */
function extractUddgUrlsFromHtml(html: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  const re = /uddg=([^&"'\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const decoded = decodeURIComponent(m[1]);
      const u = new URL(decoded);
      if (!u.hostname.includes("duckduckgo.com") && !seen.has(u.href)) {
        seen.add(u.href);
        urls.push(u.href);
      }
    } catch {
      // skip
    }
  }
  return urls;
}

/** Прогрів DDG: відвідуємо головну сторінку для отримання cookies. Виконується один раз. */
let ddgWarmedUp = false;
async function warmUpDDG(): Promise<void> {
  if (ddgWarmedUp) return;
  ddgWarmedUp = true;
  try {
    await fetchForSearch("https://html.duckduckgo.com/html/", { Referer: "" });
  } catch {
    // Ignore — this is best-effort cookie warmup
  }
  await jitteredDelay(1500);
}

/** DuckDuckGo HTML search; returns list of result URLs. Supports current DDG (redirect links uddg=) and legacy .result__a/.result__url. Regex fallback for uddg= in raw HTML. Falls back to Bing if DDG returns nothing. */
async function searchDDG(q: string): Promise<string[]> {
  const encoded = encodeURIComponent(q);
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encoded}`;
  try {
    await warmUpDDG();
    await jitteredDelay(SEARCH_DELAY_MS);
    const html = await fetchForSearch(searchUrl, { Referer: "https://html.duckduckgo.com/" });
    const $ = cheerio.load(html);
    const seen = new Set<string>();
    const urls: string[] = [];

    // Current DDG: results are links to duckduckgo.com/l/?uddg=ENCODED_REAL_URL
    $("a[href*='duckduckgo.com/l/']").each((_, el) => {
      const href = $(el).attr("href");
      const real = href ? unwrapDDGRedirect(href) : null;
      if (real && !seen.has(real)) {
        seen.add(real);
        urls.push(real);
      }
    });

    $("a[href*='uddg=']").each((_, el) => {
      const href = $(el).attr("href");
      const fullHref = href?.startsWith("http") ? href : (href ? new URL(href, "https://duckduckgo.com").href : "");
      const real = fullHref ? unwrapDDGRedirect(fullHref) : null;
      if (real && !seen.has(real)) {
        seen.add(real);
        urls.push(real);
      }
    });

    // Fallback: scan raw HTML for uddg= (handles different DOM or encoded links)
    if (urls.length === 0) {
      for (const real of extractUddgUrlsFromHtml(html)) {
        if (!seen.has(real)) {
          seen.add(real);
          urls.push(real);
        }
      }
    }

    // Legacy: direct result links and .result__url text
    if (urls.length === 0) {
      $(".result__a").each((_, el) => {
        const href = $(el).attr("href");
        if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
          try {
            const u = new URL(href);
            if (!u.hostname.includes("duckduckgo.com") && !seen.has(u.href)) {
              seen.add(u.href);
              urls.push(u.href);
            }
          } catch {
            // skip
          }
        }
      });
      $(".result__url").each((_, el) => {
        const text = $(el).text().trim();
        if (text && /^[\w.-]+\.[a-z]{2,}/i.test(text)) {
          const u = text.startsWith("http") ? text : `https://${text}`;
          try {
            const parsed = new URL(u);
            if (!seen.has(parsed.href)) {
              seen.add(parsed.href);
              urls.push(parsed.href);
            }
          } catch {
            // skip
          }
        }
      });
    }

    if (urls.length === 0) {
      const bingUrls = await searchBing(q);
      if (bingUrls.length > 0) return bingUrls;
      const startUrls = await searchStartpage(q);
      return startUrls;
    }
    return urls;
  } catch {
    const bingUrls = await searchBing(q);
    if (bingUrls.length > 0) return bingUrls;
    return searchStartpage(q);
  }
}

/** For tests: run search and return URLs (DDG then Bing fallback). */
export async function getSearchResultUrls(q: string): Promise<string[]> {
  return searchDDG(q);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "artist";
}

function nameMatches(html: string, artistName: string): boolean {
  const lower = html.toLowerCase();
  const terms = artistName.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 3);
  return terms.length === 0 || terms.some((t) => t.length > 2 && lower.includes(t));
}

/** Сторінка Instagram "Sorry, this page isn't available" (профіль не існує або прихований). */
function isInstagramNotFoundPage(html: string): boolean {
  const lower = html.toLowerCase();
  return lower.includes("this page isn't available") || lower.includes("sorry, this page");
}

/** Для Instagram (і подібних SPA) контент часто підвантажується через JS. Приймаємо URL лише якщо username містить ім'я/слаг і при цьому не є "голим" слагом — щоб не прийняти чужі профілі (напр. instagram.com/valeron замість valeron_music). */
function urlSuggestArtist(type: DiscoveredLink["type"], url: string, artistName: string, slug: string): boolean {
  if (type !== "instagram") return false;
  try {
    const u = new URL(url);
    const pathSeg = u.pathname.split("/").filter(Boolean)[0] ?? "";
    if (!pathSeg) return false;
    const pathLower = pathSeg.toLowerCase();
    const nameNorm = artistName.toLowerCase().replace(/\s+/g, "");
    const slugNorm = slug.toLowerCase().replace(/-/g, "");
    if (pathLower === slugNorm || pathLower === nameNorm) return false;
    return (
      pathLower.includes(nameNorm) ||
      pathLower.includes(slugNorm) ||
      (nameNorm.length >= 3 && pathLower.includes(nameNorm.slice(0, Math.min(4, nameNorm.length))))
    );
  } catch {
    return false;
  }
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/** Нижній регістр для дедуплікації; false якщо це явно не контакт артиста. */
function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase().split(/[?&#\s]/)[0];
  if (!e || !e.includes("@") || e.length > 254) return null;
  if (e.endsWith(".png") || e.endsWith(".jpg") || e.endsWith(".gif") || e.endsWith(".webp")) return null;
  const noReply = /^(noreply|no-reply|donotreply|do-not-reply|newsletter|notifications|webmaster|support|info@ra\.co|promotersupport)@/i;
  if (noReply.test(e)) return null;
  // Фільтруємо технічні/сервісні домени (sentry, error tracking, analytics тощо)
  const junkDomains = /(@|\.)sentry\.io$|(@|\.)ingest\..*sentry|@ra\.co$|@bandcamp\.com$/i;
  if (junkDomains.test(e)) return null;
  return e;
}

/** Витягує email з HTML; повертає унікальні нормалізовані з позначкою чи з mailto: (вища впевненість). */
function extractEmails(html: string): { value: string; fromMailto: boolean }[] {
  const seen = new Set<string>();
  const out: { value: string; fromMailto: boolean }[] = [];
  const mailtos = html.match(/mailto:([^"'\s>]+)/gi) || [];
  for (const m of mailtos) {
    const e = normalizeEmail(m.replace(/^mailto:/i, "").trim());
    if (e && !seen.has(e)) {
      seen.add(e);
      out.push({ value: e, fromMailto: true });
    }
  }
  const matches = html.match(EMAIL_REGEX) || [];
  for (const raw of matches) {
    const e = normalizeEmail(raw);
    if (e && !seen.has(e)) {
      seen.add(e);
      out.push({ value: e, fromMailto: false });
    }
  }
  return out;
}

/** SoundCloud API v2: витягуємо description (bio) з профілю — де артисти часто публікують email.
 *  SoundCloud HTML — це JS-оболонка без реального контенту; email лише через API resolve.
 *  Крок: 1) fetch HTML сторінки → 2) дістати client_id з __sc_hydration → 3) api-v2 resolve → description. */
async function fetchSoundCloudDescription(profileUrl: string, log: EnrichLog = () => {}): Promise<string | null> {
  try {
    // 1. Fetch page HTML — SoundCloud часто повертає HTTP 403 але з повним HTML (JS-оболонка).
    //    fetchWithCache кидає на non-200, тому робимо прямий fetch що приймає 403.
    let html: string | null = null;
    try {
      await jitteredDelay(RATE_DELAY_MS);
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const hdrs = browserHeaders();
      applyCookies(profileUrl, hdrs);
      const res = await fetch(profileUrl, {
        signal: controller.signal,
        headers: hdrs,
      });
      clearTimeout(t);
      storeCookies(profileUrl, res.headers.getSetCookie?.() ?? []);
      // Приймаємо 200 та 403 — SoundCloud віддає hydration дані в обох випадках
      if (res.status !== 200 && res.status !== 403) {
        log(`[SC-API] page HTTP ${res.status} for ${profileUrl}`);
        return null;
      }
      html = await res.text();
    } catch (e) {
      log(`[SC-API] page fetch error: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
    if (!html || html.length < 500) {
      log(`[SC-API] no html for ${profileUrl} (${html?.length ?? 0} bytes)`);
      return null;
    }
    const hydMatch = html.match(/__sc_hydration\s*=\s*(\[[\s\S]*?\]);/);
    if (!hydMatch) {
      log(`[SC-API] no __sc_hydration in HTML (${html.length} bytes)`);
      return null;
    }
    let clientId: string | null = null;
    try {
      const hydData = JSON.parse(hydMatch[1]) as { hydratable: string; data: unknown }[];
      for (const item of hydData) {
        if (item.hydratable === "apiClient" && typeof item.data === "object" && item.data !== null) {
          clientId = (item.data as { id?: string }).id ?? null;
          break;
        }
      }
    } catch {
      log(`[SC-API] failed to parse hydration JSON`);
    }
    if (!clientId) {
      // Fallback: regex for client_id in JS bundles
      const cidMatch = html.match(/client_id=([a-zA-Z0-9]{20,})/);
      clientId = cidMatch ? cidMatch[1] : null;
    }
    if (!clientId) {
      log(`[SC-API] no client_id found`);
      return null;
    }
    log(`[SC-API] client_id=${clientId.slice(0, 8)}...`);

    // 2. Resolve profile via API v2 — нормалізуємо URL (прибираємо www., бо API не розпізнає www.soundcloud.com)
    const normalizedUrl = profileUrl
      .replace(/\/$/, "")
      .replace(/^http:/, "https:")
      .replace(/\/\/www\.soundcloud\.com/i, "//soundcloud.com");
    log(`[SC-API] resolving ${normalizedUrl}`);
    const apiUrl = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(normalizedUrl)}&client_id=${clientId}`;
    await jitteredDelay(RATE_DELAY_MS);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(apiUrl, {
        signal: controller.signal,
        headers: { "User-Agent": randomUA(), Accept: "application/json" },
      });
      clearTimeout(t);
      if (!res.ok) {
        log(`[SC-API] resolve HTTP ${res.status}`);
        return null;
      }
      const data = await res.json() as { description?: string; username?: string };
      const desc = data.description ?? "";
      log(`[SC-API] resolved username="${data.username ?? "?"}" description length=${desc.length}`);
      return desc || null;
    } catch (e) {
      clearTimeout(t);
      log(`[SC-API] resolve error: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  } catch (e) {
    log(`[SC-API] error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** Збирає email з усіх зібраних сторінок (Linktree, SoundCloud, контакт-пошук) з пріоритетом за джерелом. */
function collectContactsFromPages(
  contacts: DiscoveredContact[],
  sourceUrl: string,
  html: string,
  options: { confidenceMailto: number; confidencePlain: number; maxPerPage: number; artistName: string }
): void {
  const extracted = extractEmails(html).slice(0, options.maxPerPage);
  const seen = new Set(contacts.map((c) => c.value.toLowerCase()));
  for (const { value } of extracted) {
    if (seen.has(value)) continue;
    const { confidence, emailType, sourceContext, reason } = computeConfidence(
      sourceUrl,
      value,
      options.artistName
    );
    if (confidence < 30) continue;
    seen.add(value);
    contacts.push({
      type: "email",
      value,
      source_url: sourceUrl,
      confidence,
      email_type: emailType,
      source_context: sourceContext,
    });
    console.log(`[enrich] email ${value} → type:${emailType} confidence:${confidence}`);
  }
}

/** Впевненість за джерелом для email. Усі посилання з RA (соцмережі, сайт) використовуються для збору email. */
const EMAIL_CONFIDENCE: Record<string, { mailto: number; plain: number }> = {
  resident_advisor: { mailto: 0.95, plain: 0.95 },
  linktree: { mailto: 0.9, plain: 0.9 },
  bandcamp: { mailto: 0.85, plain: 0.85 },
  soundcloud: { mailto: 0.8, plain: 0.8 },
  mixcloud: { mailto: 0.75, plain: 0.75 },
  reverbnation: { mailto: 0.75, plain: 0.75 },
  website: { mailto: 0.8, plain: 0.75 },
  instagram: { mailto: 0.7, plain: 0.7 },
  facebook: { mailto: 0.65, plain: 0.65 },
  twitter: { mailto: 0.65, plain: 0.65 },
};

/** Макс. email з однієї сторінки — щоб виводити всі знайдені. */
const EMAIL_MAX_PER_PAGE = 15;

/** Classify href to our link type; null if not a tracked type. */
function linkTypeFromHref(href: string): DiscoveredLink["type"] | null {
  try {
    const h = href.toLowerCase();
    if (/instagram\.com\/[^/?#]+/.test(h)) return "instagram";
    if (/linktr\.ee\/[^/?#]+/.test(h) || /beacons\.ai\/[^/?#]+/.test(h) || /carrd\.co\/[^/?#]+/.test(h)) return "linktree";
    if (/soundcloud\.com\/[^/?#]+/.test(h)) return "soundcloud";
    if (/residentadvisor\.net\/[^/?#]+/.test(h) || /ra\.co\/dj\/[^/?#]+/.test(h)) return "resident_advisor";
    if (/bandcamp\.com\/[^/?#]+/.test(h)) return "bandcamp";
    if (/mixcloud\.com\/[^/?#]+/.test(h)) return "mixcloud";
    if (/reverbnation\.com\/[^/?#]+/.test(h)) return "reverbnation";
    if (/facebook\.com\/[^/?#]+/.test(h) || /fb\.com\/[^/?#]+/.test(h)) return "facebook";
    if (/twitter\.com\/[^/?#]+/.test(h) || /x\.com\/[^/?#]+/.test(h)) return "twitter";
    if (/^https?:\/\/[^/]+(\/|$)/.test(h) && !/instagram|linktr|beacons|carrd|soundcloud|residentadvisor|bandcamp|mixcloud|reverbnation|duckduckgo|google|facebook|twitter|x\.com/i.test(h)) return "website";
  } catch {
    return null;
  }
  return null;
}

/** З сторінки артиста на RA витягуємо всі зовнішні посилання (Instagram, SoundCloud, Linktree, Facebook, Twitter тощо). Один URL на тип; впевненість висока — це офіційні посилання з профілю. */
function extractSocialLinksFromRAPage(html: string, raPageUrl: string): DiscoveredLink[] {
  const $ = cheerio.load(html);
  const out: DiscoveredLink[] = [];
  const seen = new Set<DiscoveredLink["type"]>();
  const confidence = 0.95;
  const baseUrl = raPageUrl.startsWith("http") ? raPageUrl : `https://${raPageUrl}`;
  $("a[href]").each((_, el) => {
    let href = $(el).attr("href")?.trim();
    if (!href) return;
    if (href.startsWith("//")) href = "https:" + href;
    if (!href.startsWith("http")) return;
    const type = linkTypeFromHref(href);
    if (!type || type === "resident_advisor") return;
    if (seen.has(type)) return;
    try {
      const u = new URL(href, baseUrl);
      if (u.hostname.toLowerCase().includes("residentadvisor") || u.hostname.toLowerCase().includes("ra.co")) return;
      const url = u.origin + u.pathname.replace(/\/$/, "") || href;
      if (url.length > 500) return;
      seen.add(type);
      out.push({ type, url, confidence, source: "resident_advisor" });
    } catch {
      // skip invalid
    }
  });
  return out;
}

/** Extract external links from HTML and add cross-validated ones if URL path matches name/slug. One per type; replace only if higher confidence. */
function addCrossValidatedLinks(
  links: DiscoveredLink[],
  html: string,
  parentSource: string,
  name: string,
  slug: string,
  baseConfidence: number
): void {
  const $ = cheerio.load(html);
  const terms = name.toLowerCase().split(/\s+/).filter((t) => t.length > 2).slice(0, 3);
  $("a[href^='http']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const type = linkTypeFromHref(href);
    if (!type) return;
    const existing = links.find((l) => l.type === type);
    if (existing && existing.confidence >= baseConfidence) return;
    try {
      const u = new URL(href);
      const pathSlug = u.pathname.replace(/^\/|\/$/g, "").split("/")[0] || "";
      const pathLower = u.pathname.toLowerCase();
      const hostLower = u.hostname.toLowerCase();
      const pathMatches = pathSlug && (pathSlug.toLowerCase().includes(slug.toLowerCase()) || terms.some((t) => pathLower.includes(t)));
      const siteMatches = type === "website" && terms.some((t) => pathLower.includes(t) || hostLower.includes(t));
      if (!pathMatches && !siteMatches) return;
      let url = u.origin + u.pathname.replace(/\/$/, "") || href;
      if (url.length > 500) return;
      if (existing) {
        existing.url = url;
        existing.confidence = baseConfidence;
        existing.source = `cross_validated:${parentSource}`;
      } else {
        links.push({ type, url, confidence: baseConfidence, source: `cross_validated:${parentSource}` });
      }
    } catch {
      // skip invalid URL
    }
  });
}

/** З сторінки пошуку RA (ra.co/search?query=...) витягуємо посилання на профілі артистів (/dj/..., /artist/...). */
function extractRAArtistLinksFromSearchPage(html: string, searchPageUrl: string): string[] {
  const $ = cheerio.load(html);
  const baseUrl = searchPageUrl.startsWith("http") ? searchPageUrl : "https://ra.co";
  const seen = new Set<string>();
  const urls: string[] = [];
  $("a[href]").each((_, el) => {
    let href = $(el).attr("href")?.trim();
    if (!href) return;
    if (href.startsWith("//")) href = "https:" + href;
    const path = href.startsWith("http") ? new URL(href, baseUrl).pathname : href;
    if (!path.includes("/dj/") && !path.includes("/artist/")) return;
    try {
      const u = new URL(href, baseUrl);
      const host = u.hostname.toLowerCase();
      if (!host.includes("ra.co") && !host.includes("residentadvisor.net")) return;
      const full = u.origin + u.pathname.replace(/\/$/, "");
      if (seen.has(full)) return;
      seen.add(full);
      urls.push(full);
    } catch {
      // skip
    }
  });
  return urls;
}

/** Чи виглядає URL як сторінка артиста на RA (ra.co/dj/..., residentadvisor.net/.../dj/...). */
function isRAArtistPageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (host.includes("ra.co") && path.includes("/dj/")) return true;
    if (host.includes("residentadvisor.net") && (path.includes("/dj/") || path.includes("/artist/"))) return true;
    return false;
  } catch {
    return false;
  }
}

/** Перевірка, що це сторінка артиста: ім'я або слаг є в HTML; або для прямого RA URL — просто не сторінка помилки (RA часто SPA, контент через JS). */
function raPageMatchesArtist(html: string, name: string, slug: string, pageUrl: string, isDirectUrl: boolean): boolean {
  if (isDirectUrl && html.length > 10000) return true;
  const lower = html.toLowerCase();
  if (lower.includes("page not found") || lower.includes("this page doesn't exist")) return false;
  if (/["'>]\s*404\s*[<"']/.test(html) || /\b404\s+not\s+found/i.test(html)) return false;
  const nameOk = nameMatches(html, name);
  if (nameOk) return true;
  if (slug.length >= 2 && lower.includes(slug.toLowerCase())) return true;
  if (pageUrl.toLowerCase().includes(slug.toLowerCase()) && html.length > 1500) return true;
  if (isDirectUrl && html.length > 200) return true;
  return false;
}

export type EnrichLog = (msg: string) => void;

/** Discover links: спочатку Resident Advisor — заходимо на сторінку артиста, витягуємо всі соцпосилання з неї; далі з усіх посилань збираємо email. Якщо RA не знайшли — fallback пошук по типах. */
export async function discoverLinks(
  artistName: string,
  artistSlug: string | null,
  log: EnrichLog = () => {}
): Promise<{ links: DiscoveredLink[]; contacts: DiscoveredContact[] }> {
  const links: DiscoveredLink[] = [];
  const contacts: DiscoveredContact[] = [];
  const name = artistName.trim() || "artist";
  const slug = (artistSlug || slugify(name)).slice(0, 40);
  const quotedName = name.includes(" ") ? `"${name}"` : name;

  log(`[discoverLinks] name="${name}" slug="${slug}"`);

  const startTime = Date.now();
  const isTimedOut = () => Date.now() - startTime > GLOBAL_TIMEOUT_MS;
  const hasEmail = () => contacts.some((c) => c.type === "email");

  const hasLink = (t: DiscoveredLink["type"]) => links.find((l) => l.type === t);

  let raPageUrl: string | null = null;
  let raHtml: string | null = null;

  // Крок 1a: спочатку пробуємо прямий URL за слагом (як у флоу: ra.co/dj/valeron)
  const directRACandidates = [
    `https://ra.co/dj/${slug}`,
    `https://www.residentadvisor.net/dj/${slug}`,
  ];
  log(`[1a] Прямі RA URL: ${directRACandidates.join(", ")}`);
  for (const candidateUrl of directRACandidates) {
    const html = await fetchWithCache(candidateUrl);
    log(`[1a] GET ${candidateUrl} -> ${html?.length ?? 0} bytes`);
    if (!html || html.length < 200) {
      log(`[1a] skip (no html or <200 bytes)`);
      continue;
    }
    if (!raPageMatchesArtist(html, name, slug, candidateUrl, true)) {
      log(`[1a] raPageMatchesArtist=false (name in HTML? slug? isDirect+len>500?)`);
      continue;
    }
    raPageUrl = candidateUrl;
    raHtml = html;
    log(`[1a] OK -> використовуємо ${candidateUrl}`);
    break;
  }

  // Крок 1b: заходимо на Resident Advisor і робимо пошук по імені — з результатів беремо посилання на артиста
  if (!raPageUrl && !isTimedOut()) {
    log(`[1b] Прямий URL не дав результату, пробуємо RA пошук`);
    const raSearchUrls = [
      `https://ra.co/search?query=${encodeURIComponent(name)}`,
      `https://www.residentadvisor.net/search?query=${encodeURIComponent(name)}`,
    ];
    for (const searchUrl of raSearchUrls) {
      const searchHtml = await fetchWithCache(searchUrl);
      log(`[1b] GET ${searchUrl} -> ${searchHtml?.length ?? 0} bytes`);
      if (!searchHtml || searchHtml.length < 500) continue;
      const profileUrls = extractRAArtistLinksFromSearchPage(searchHtml, searchUrl);
      log(`[1b] Знайдено профілів на сторінці пошуку: ${profileUrls.length} — ${profileUrls.slice(0, 5).join(", ")}`);
      for (const candidateUrl of profileUrls.slice(0, 3)) {
        const html = await fetchWithCache(candidateUrl);
        log(`[1b] GET profile ${candidateUrl} -> ${html?.length ?? 0} bytes`);
        if (!html) continue;
        if (!raPageMatchesArtist(html, name, slug, candidateUrl, false)) {
          log(`[1b] raPageMatchesArtist=false для ${candidateUrl}`);
          continue;
        }
        raPageUrl = candidateUrl;
        raHtml = html;
        log(`[1b] OK -> використовуємо ${candidateUrl}`);
        break;
      }
      if (raPageUrl) break;
    }
  }

  // Крок 1c: якщо через RA пошук не знайшли — пошук у DDG
  if (!raPageUrl && !isTimedOut()) {
    const raQuery = `${quotedName} site:residentadvisor.net OR site:ra.co`;
    log(`[1c] RA пошук не дав результату, DDG: "${raQuery}"`);
    const raResultUrls = (await searchDDG(raQuery)).filter(isRAArtistPageUrl);
    log(`[1c] DDG повернув ${raResultUrls.length} RA URL: ${raResultUrls.slice(0, 5).join(", ")}`);
    for (const candidateUrl of raResultUrls.slice(0, 5)) {
      const html = await fetchWithCache(candidateUrl);
      log(`[1c] GET ${candidateUrl} -> ${html?.length ?? 0} bytes`);
      if (!html) continue;
      if (!raPageMatchesArtist(html, name, slug, candidateUrl, false)) continue;
      raPageUrl = candidateUrl;
      raHtml = html;
      log(`[1c] OK -> використовуємо ${candidateUrl}`);
      break;
    }
  }

  if (raPageUrl && raHtml) {
    try {
      log(`[RA] Сторінка RA знайдена, витягуємо посилання з HTML (${raHtml.length} bytes)`);
      const raUrlNormalized = raPageUrl.replace(/\/$/, "");
      if (!hasLink("resident_advisor")) {
        links.push({ type: "resident_advisor", url: raUrlNormalized, confidence: 0.95, source: "search" });
      }
      const fromRA = extractSocialLinksFromRAPage(raHtml, raPageUrl);
      log(`[RA] Витягнуто з RA сторінки посилань: ${fromRA.length} — ${fromRA.map((l) => l.type + ":" + l.url).join("; ")}`);
      for (const link of fromRA) {
        const existing = hasLink(link.type);
        if (!existing) links.push(link);
        else if (link.confidence > existing.confidence) {
          existing.url = link.url;
          existing.confidence = link.confidence;
          existing.source = link.source;
        }
      }
      collectContactsFromPages(contacts, raPageUrl, raHtml, {
        confidenceMailto: 0.95,
        confidencePlain: 0.95,
        maxPerPage: EMAIL_MAX_PER_PAGE,
        artistName: name,
      });
      log(`[RA] Email з RA сторінки: ${contacts.length}`);
      for (const link of links) {
        // SoundCloud: HTML — JS-оболонка без email; використовуємо API v2 для отримання description (bio)
        if (link.type === "soundcloud") {
          log(`[RA] SoundCloud link — пробуємо API v2 для ${link.url}`);
          const scDesc = await fetchSoundCloudDescription(link.url, log);
          if (scDesc) {
            const conf = EMAIL_CONFIDENCE.soundcloud ?? { mailto: 0.8, plain: 0.8 };
            collectContactsFromPages(contacts, link.url, scDesc, {
              confidenceMailto: conf.mailto,
              confidencePlain: conf.plain,
              maxPerPage: EMAIL_MAX_PER_PAGE,
              artistName: name,
            });
            log(`[RA] SoundCloud API email -> contacts=${contacts.length}`);
          }
          continue;
        }
        const html = link.type === "resident_advisor" && raHtml ? raHtml : await fetchWithCache(link.url);
        if (!html) {
          log(`[RA] fetch link ${link.type} ${link.url} -> no html`);
          continue;
        }
        const conf = EMAIL_CONFIDENCE[link.type] ?? { mailto: 0.65, plain: 0.65 };
        collectContactsFromPages(contacts, link.url, html, {
          confidenceMailto: conf.mailto,
          confidencePlain: conf.plain,
          maxPerPage: EMAIL_MAX_PER_PAGE,
          artistName: name,
        });
      }
      log(`[RA] Всього contacts після обходу посилань: ${contacts.length}`);
    } catch (e) {
      log(`[RA] помилка: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    log(`[RA] Сторінку RA не знайдено (raPageUrl=${raPageUrl ? "ok" : "null"})`);
  }

  // Fallback: якщо через RA нічого не знайшли або типів не вистачає — пошук по кожному типу
  // Пріоритет: email-rich джерела першими (linktree, soundcloud, bandcamp)
  const domains: { type: DiscoveredLink["type"]; query: string }[] = [
    { type: "linktree", query: `${quotedName} linktr.ee OR beacons.ai OR carrd.co` },
    { type: "soundcloud", query: `${quotedName} site:soundcloud.com` },
    { type: "bandcamp", query: `${quotedName} site:bandcamp.com` },
    { type: "resident_advisor", query: `${quotedName} site:residentadvisor.net` },
    { type: "mixcloud", query: `${quotedName} site:mixcloud.com` },
    { type: "reverbnation", query: `${quotedName} site:reverbnation.com` },
    { type: "instagram", query: `${quotedName} site:instagram.com` },
  ];

  log(`[fallback] Типів посилань зараз: ${links.length}, запускаємо пошук по типах для недостатніх`);
  for (const { type, query: q } of domains) {
    if (isTimedOut()) { log(`[fallback] TIMEOUT — зупинка (${Date.now() - startTime}ms)`); break; }
    if (hasLink(type)) continue;
    // Якщо вже маємо email і витратили >30с — можна зупинитись, решта типів необов'язкова
    if (hasEmail() && Date.now() - startTime > 30000) { log(`[fallback] email є + >30с — пропускаємо решту`); break; }
    log(`[fallback] Пошук ${type}: ${q}`);
    const resultUrls = await searchDDG(q);
    log(`[fallback] ${type} -> ${resultUrls.length} URL: ${resultUrls.slice(0, 3).join(", ")}`);
    const maxCandidates = type === "instagram" ? 5 : 2;
    for (const candidateUrl of resultUrls.slice(0, maxCandidates)) {
      const html = await fetchWithCache(candidateUrl);
      if (!html) continue;
      if (type === "instagram" && isInstagramNotFoundPage(html)) continue;
      const nameOk = nameMatches(html, name) || urlSuggestArtist(type, candidateUrl, name, slug);
      if (!nameOk) {
        log(`[fallback] ${type} ${candidateUrl} nameMatches/urlSuggest=false`);
        continue;
      }
      let url = candidateUrl;
      try {
        const u = new URL(candidateUrl);
        url = u.origin + u.pathname.replace(/\/$/, "") || candidateUrl;
      } catch {
        // keep as is
      }
      let linkConfidence = candidateUrl.includes(slug) ? 0.9 : 0.6;
      if (type === "instagram") {
        try {
          const pathSeg = new URL(candidateUrl).pathname.split("/").filter(Boolean)[0] ?? "";
          const slugNorm = slug.toLowerCase().replace(/-/g, "");
          if (pathSeg.length > slugNorm.length && pathSeg.toLowerCase().includes(slugNorm)) linkConfidence = 0.95;
        } catch {
          // keep default
        }
      }
      links.push({ type, url, confidence: linkConfidence, source: "search" });
      // SoundCloud: HTML — JS-оболонка без email, використовуємо API v2
      if (type === "soundcloud") {
        log(`[fallback] SoundCloud — пробуємо API v2 для ${url}`);
        const scDesc = await fetchSoundCloudDescription(url, log);
        if (scDesc) {
          const conf = EMAIL_CONFIDENCE.soundcloud ?? { mailto: 0.8, plain: 0.8 };
          collectContactsFromPages(contacts, url, scDesc, {
            confidenceMailto: conf.mailto,
            confidencePlain: conf.plain,
            maxPerPage: EMAIL_MAX_PER_PAGE,
            artistName: name,
          });
          log(`[fallback] SoundCloud API email -> contacts=${contacts.length}`);
        }
      } else {
        const conf = EMAIL_CONFIDENCE[type] ?? { mailto: 0.65, plain: 0.65 };
        collectContactsFromPages(contacts, candidateUrl, html, {
          confidenceMailto: conf.mailto,
          confidencePlain: conf.plain,
          maxPerPage: EMAIL_MAX_PER_PAGE,
          artistName: name,
        });
      }
      if (type === "soundcloud" || type === "resident_advisor" || type === "linktree") {
        addCrossValidatedLinks(links, html, type, name, slug, 0.75);
      }
      log(`[fallback] ${type} OK -> ${candidateUrl}`);
      break;
    }
  }

  // Крок 3: Direct URL probing — коли пошукові системи заблоковані, пробуємо прямі URL за шаблоном
  if (isTimedOut()) {
    log(`[direct] TIMEOUT — пропускаємо direct probing (${Date.now() - startTime}ms)`);
    log(`[discoverLinks] Підсумок (timeout): links=${links.length}, contacts=${contacts.length}`);
    return { links, contacts };
  }
  // Якщо вже маємо email — пропускаємо direct probing (основна ціль досягнута)
  if (hasEmail()) {
    log(`[direct] Email вже знайдений — пропускаємо direct probing`);
    log(`[discoverLinks] Підсумок (early exit): links=${links.length}, contacts=${contacts.length}`);
    return { links, contacts };
  }
  const slugNoSep = slug.replace(/-/g, "");
  const directProbes: { type: DiscoveredLink["type"]; urls: string[] }[] = [
    {
      type: "soundcloud",
      urls: [`https://soundcloud.com/${slug}`, ...(slugNoSep !== slug ? [`https://soundcloud.com/${slugNoSep}`] : [])],
    },
    {
      type: "instagram",
      urls: [`https://www.instagram.com/${slugNoSep}/`, ...(slugNoSep !== slug ? [`https://www.instagram.com/${slug.replace(/-/g, "_")}/`] : [])],
    },
    {
      type: "linktree",
      urls: [`https://linktr.ee/${slugNoSep}`, `https://linktr.ee/${slug}`],
    },
    {
      type: "bandcamp",
      urls: [`https://${slug}.bandcamp.com/`],
    },
    {
      type: "facebook",
      urls: [`https://www.facebook.com/${slugNoSep}`],
    },
  ];

  const probedTypes = directProbes.filter((p) => !hasLink(p.type));
  if (probedTypes.length > 0) {
    log(`[direct] Probing ${probedTypes.length} типів: ${probedTypes.map((p) => p.type).join(", ")}`);
  }
  for (const { type, urls: probeUrls } of probedTypes) {
    if (isTimedOut()) { log(`[direct] TIMEOUT mid-probing`); break; }
    let found = false;
    for (const probeUrl of probeUrls) {
      try {
        await jitteredDelay(RATE_DELAY_MS);
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const hdrs = browserHeaders();
        applyCookies(probeUrl, hdrs);
        const res = await fetch(probeUrl, {
          signal: controller.signal,
          headers: hdrs,
          redirect: "follow",
        });
        clearTimeout(t);
        storeCookies(probeUrl, res.headers.getSetCookie?.() ?? []);
        const status = res.status;
        const body = await res.text();
        log(`[direct] ${type} ${probeUrl} -> HTTP ${status}, ${body.length} bytes`);
        // Прийнятні статуси: 200, 403 (SoundCloud спеціально); відхиляємо 4xx/5xx крім 403 для SC
        if (status === 404 || status === 410) continue;
        if (status >= 400 && !(status === 403 && type === "soundcloud")) continue;
        if (body.length < 500) continue;
        // Instagram: перевіряємо, чи сторінка не "not found"
        if (type === "instagram" && isInstagramNotFoundPage(body)) {
          log(`[direct] ${type} ${probeUrl} -> Instagram not found page`);
          continue;
        }
        // Linktree 404 check
        if (type === "linktree" && (body.includes("page not found") || status === 404)) continue;

        let urlNorm = probeUrl;
        try { urlNorm = new URL(probeUrl).origin + new URL(probeUrl).pathname.replace(/\/$/, ""); } catch { /* keep */ }
        links.push({ type, url: urlNorm, confidence: 0.7, source: "direct_probe" });
        log(`[direct] ${type} OK -> ${urlNorm}`);

        // SoundCloud: використовуємо API для email
        if (type === "soundcloud") {
          const scDesc = await fetchSoundCloudDescription(probeUrl, log);
          if (scDesc) {
            const conf = EMAIL_CONFIDENCE.soundcloud ?? { mailto: 0.8, plain: 0.8 };
            collectContactsFromPages(contacts, urlNorm, scDesc, {
              confidenceMailto: conf.mailto,
              confidencePlain: conf.plain,
              maxPerPage: EMAIL_MAX_PER_PAGE,
              artistName: name,
            });
            log(`[direct] SoundCloud API email -> contacts=${contacts.length}`);
          }
        } else if (type !== "instagram" && type !== "facebook") {
          // Для не-SPA платформ збираємо email з HTML
          const conf = EMAIL_CONFIDENCE[type] ?? { mailto: 0.65, plain: 0.65 };
          collectContactsFromPages(contacts, urlNorm, body, {
            confidenceMailto: conf.mailto,
            confidencePlain: conf.plain,
            maxPerPage: EMAIL_MAX_PER_PAGE,
            artistName: name,
          });
        }
        found = true;
        break;
      } catch (e) {
        log(`[direct] ${type} ${probeUrl} -> error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!found) log(`[direct] ${type} -> не знайдено`);
  }

  log(`[discoverLinks] Підсумок: links=${links.length}, contacts=${contacts.length}`);
  return { links, contacts };
}

/** Run enrichment for one artist; upsert artist_links and artist_contacts. */
export async function runEnrichmentForArtist(
  artistBeatportId: string,
  log: EnrichLog = () => {}
): Promise<{
  linksAdded: number;
  contactsAdded: number;
  error?: string;
}> {
  let artistName = "";
  let artistSlug: string | null = null;
  try {
    log(`[runEnrichment] artistBeatportId=${artistBeatportId}`);
    const rows = await query<{ artist_name: string | null; artist_slug: string | null }>(
      `SELECT am.artist_name,
              (SELECT ce.artist_slug FROM chart_entries ce WHERE ce.artist_beatport_id = am.artist_beatport_id AND ce.artist_slug IS NOT NULL LIMIT 1) AS artist_slug
       FROM artist_metrics am WHERE am.artist_beatport_id = $1`,
      [artistBeatportId]
    );
    const r = rows[0];
    artistName = r?.artist_name ?? "";
    artistSlug = r?.artist_slug ?? null;
    if (!artistName && !artistSlug) {
      log(`[runEnrichment] artist_metrics пусто, беру з chart_entries`);
      const ceRows = await query<{ artist_name: string; artist_slug: string | null }>(
        `SELECT artist_name, artist_slug FROM chart_entries WHERE artist_beatport_id = $1 LIMIT 1`,
        [artistBeatportId]
      );
      artistName = ceRows[0]?.artist_name ?? "";
      artistSlug = ceRows[0]?.artist_slug ?? null;
    }
    log(`[runEnrichment] artistName="${artistName}" artistSlug=${artistSlug ?? "null"}`);
  } catch (e) {
    log(`[runEnrichment] помилка БД: ${e}`);
    return { linksAdded: 0, contactsAdded: 0, error: String(e) };
  }

  const { links, contacts } = await discoverLinks(artistName, artistSlug, log);

  let linksAdded = 0;
  let contactsAdded = 0;
  try {
    for (const link of links) {
      if (link.type === "instagram") {
        await jitteredDelay(3000);
        const handle = link.url.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/$/, "").trim();
        if (handle) {
          try {
            const validation = await validateInstagramHandle(handle, artistName, fetchWithCache);
            link.quality_score = validation.confidence;
            link.validation_note = validation.confidence < 40 ? "low_confidence" : validation.note;
          } catch (e) {
            log(`[enrich] Instagram validation error: ${e instanceof Error ? e.message : String(e)}`);
            link.quality_score = 30;
            link.validation_note = "unverified";
          }
        }
      }
      const validatedAt = link.type === "instagram" && link.quality_score != null ? new Date() : null;
      await pool.query(
        `INSERT INTO artist_links (artist_beatport_id, type, url, confidence, source, quality_score, validation_note, validated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (artist_beatport_id, type) DO UPDATE SET
           url = EXCLUDED.url,
           confidence = EXCLUDED.confidence,
           source = EXCLUDED.source,
           quality_score = COALESCE(EXCLUDED.quality_score, artist_links.quality_score),
           validation_note = COALESCE(EXCLUDED.validation_note, artist_links.validation_note),
           validated_at = CASE WHEN EXCLUDED.validated_at IS NOT NULL THEN EXCLUDED.validated_at ELSE artist_links.validated_at END`,
        [
          artistBeatportId,
          link.type,
          link.url,
          link.confidence,
          link.source,
          link.quality_score ?? null,
          link.validation_note ?? null,
          validatedAt,
        ]
      );
      linksAdded++;
    }
    for (const c of contacts) {
      await pool.query(
        `INSERT INTO artist_contacts (artist_beatport_id, type, value, source_url, confidence, status, email_type, quality_score, source_context)
         VALUES ($1, $2, $3, $4, $5, 'ok', $6, $7, $8)
         ON CONFLICT (artist_beatport_id, type, value) DO UPDATE SET
           source_url = COALESCE(EXCLUDED.source_url, artist_contacts.source_url),
           confidence = GREATEST(artist_contacts.confidence, EXCLUDED.confidence),
           email_type = EXCLUDED.email_type,
           quality_score = EXCLUDED.quality_score,
           source_context = EXCLUDED.source_context`,
        [
          artistBeatportId,
          c.type,
          c.value,
          c.source_url,
          c.confidence / 100,
          c.email_type ?? "unknown",
          c.confidence,
          c.source_context ?? "unknown",
        ]
      );
      contactsAdded++;
    }
  } catch (e) {
    return { linksAdded, contactsAdded, error: String(e) };
  }
  return { linksAdded, contactsAdded };
}
