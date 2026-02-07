/**
 * BP Top Tracker: obtain session cookie for authenticated requests.
 * Uses BPTOPTRACKER_EMAIL + BPTOPTRACKER_PASSWORD from env (never hardcode credentials).
 * Or use pre-set BPTOPTRACKER_COOKIE if you have a session.
 * After login we verify by fetching a chart page; if it returns login/landing, cookie is cleared.
 */

import { looksLikeLoginOrLandingPage } from "./bptoptrackerBlocklist";

const ORIGIN = "https://www.bptoptracker.com";
const LOGIN_URL = `${ORIGIN}/login`;
/** Used to verify cookie works (genre + date). */
const VERIFY_CHART_PATH = "/top/track/afro-house/";

let cachedCookie: string | null = null;
/** Last login failure reason (for API error message). */
let lastLoginError: string | null = null;

/** Get all Set-Cookie header values and merge into one Cookie header string. */
function getCookieHeaderFromResponse(res: Response): string | null {
  const getSetCookie = (res.headers as Headers & { getSetCookie?(): string[] }).getSetCookie;
  if (typeof getSetCookie === "function") {
    const arr = getSetCookie.call(res.headers);
    if (arr?.length) return arr.map((c) => c.split(";")[0].trim()).join("; ");
  }
  const single = res.headers.get("set-cookie");
  if (single) return single.split(";").slice(0, 2).join("; ").trim();
  return null;
}

/** Fetches a chart page with the cookie; returns false if response is login/landing. */
async function verifyCookie(cookie: string): Promise<boolean> {
  try {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const date = d.toISOString().slice(0, 10);
    const url = `${ORIGIN}${VERIFY_CHART_PATH}${date}`;
    const res = await fetch(url, {
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const html = await res.text();
    return !looksLikeLoginOrLandingPage(html);
  } catch {
    return false;
  }
}

/**
 * Returns cookie string for authenticated requests.
 * Prefer BPTOPTRACKER_COOKIE; otherwise login with BPTOPTRACKER_EMAIL + BPTOPTRACKER_PASSWORD.
 */
export async function getBptoptrackerCookie(): Promise<string | null> {
  // #region agent log
  const existing = process.env.BPTOPTRACKER_COOKIE;
  const email = process.env.BPTOPTRACKER_EMAIL?.trim();
  const password = process.env.BPTOPTRACKER_PASSWORD;
  fetch("http://127.0.0.1:7245/ingest/7798bf67-c5b4-45c1-bfd1-dc5453bf1c4b", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "bptoptrackerAuth.ts:getBptoptrackerCookie:entry", message: "cookie entry", data: { hasEnvCookie: !!existing?.trim(), hasEmail: !!email, hasPassword: !!password, hasCached: !!cachedCookie }, hypothesisId: "H4", timestamp: Date.now() }) }).catch(() => {});
  // #endregion
  if (existing?.trim()) {
    return existing.trim();
  }
  if (!email || !password) {
    lastLoginError = "BPTOPTRACKER_EMAIL або BPTOPTRACKER_PASSWORD не задані в .env";
    return null;
  }
  if (cachedCookie) {
    return cachedCookie;
  }
  lastLoginError = null;
  try {
    const getRes = await fetch(LOGIN_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const html = await getRes.text();
    const cookieFromGet = getCookieHeaderFromResponse(getRes);
    // CSRF token from the form that contains name="email" (login form), not from search form
    const loginFormBlock = html.match(/<form[^>]*>[\s\S]*?name="email"[\s\S]*?<\/form>/i)?.[0]
      || html.match(/<form[\s\S]*?name="password"[\s\S]*?<\/form>/i)?.[0]
      || html;
    const csrfToken = loginFormBlock.match(/name="_token"\s+value="([^"]+)"/)?.[1]
      ?? loginFormBlock.match(/name="csrf_token"\s+value="([^"]+)"/)?.[1]
      ?? (() => { const all = [...html.matchAll(/name="_token"\s+value="([^"]+)"/g)]; return all[all.length - 1]?.[1]; })();
    // Always POST to login URL (page also has search form with action=/search — must not use that)
    const postUrl = LOGIN_URL;
    const emailField = html.includes('name="email"') ? "email" : html.includes('name="login"') ? "login" : "email";
    // #region agent log
    fetch("http://127.0.0.1:7245/ingest/7798bf67-c5b4-45c1-bfd1-dc5453bf1c4b", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "bptoptrackerAuth.ts:after GET login", message: "login form parse", data: { getStatus: getRes.status, hasToken: !!csrfToken, postUrl: postUrl.slice(0, 60), emailField, htmlLen: html.length }, hypothesisId: "H1", timestamp: Date.now() }) }).catch(() => {});
    // #endregion
    const params: Record<string, string> = {
      [emailField]: email,
      password,
      ...(process.env.BPTOPTRACKER_REMEMBER === "1" ? { remember: "1" } : {}),
    };
    if (csrfToken) params._token = csrfToken;

    const res = await fetch(postUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml",
        Origin: ORIGIN,
        Referer: `${ORIGIN}/login`,
        ...(cookieFromGet ? { Cookie: cookieFromGet } : {}),
      },
      body: new URLSearchParams(params).toString(),
      redirect: "manual",
    });
    let setCookie = getCookieHeaderFromResponse(res) ?? cookieFromGet;
    if (setCookie) cachedCookie = setCookie;
    const location = res.headers.get("location");
    // #region agent log
    fetch("http://127.0.0.1:7245/ingest/7798bf67-c5b4-45c1-bfd1-dc5453bf1c4b", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "bptoptrackerAuth.ts:after POST login", message: "post result", data: { postStatus: res.status, hasSetCookie: !!setCookie, hasLocation: !!location, location: location ? location.slice(0, 80) : null }, hypothesisId: "H2", timestamp: Date.now() }) }).catch(() => {});
    // #endregion
    if (res.status === 419) {
      lastLoginError = "Сайт повернув 419 (CSRF). Перезавантаж сторінку або перевір, що логін/пароль правильні.";
      cachedCookie = null;
      return null;
    }
    if (res.status >= 301 && res.status <= 303 && location) {
      const redirectRes = await fetch(location.startsWith("http") ? location : `${ORIGIN}${location}`, {
        headers: cachedCookie ? { Cookie: cachedCookie } : {},
      });
      const nextCookie = getCookieHeaderFromResponse(redirectRes);
      if (nextCookie) cachedCookie = nextCookie;
    }
    if (cachedCookie) {
      const verified = await verifyCookie(cachedCookie);
      // #region agent log
      fetch("http://127.0.0.1:7245/ingest/7798bf67-c5b4-45c1-bfd1-dc5453bf1c4b", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "bptoptrackerAuth.ts:after verify", message: "verify result", data: { verified, cookieLen: cachedCookie.length }, hypothesisId: "H3", timestamp: Date.now() }) }).catch(() => {});
      // #endregion
      if (!verified) {
        lastLoginError = "Після логіну перевірка не пройшла — сайт повернув сторінку логіну. Спробуй інший браузер або перевір облікові дані.";
        cachedCookie = null;
        return null;
      }
      return cachedCookie;
    }
    lastLoginError = "Після POST не отримано cookie сесії.";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    lastLoginError = `Помилка логіну: ${msg}`;
    if (process.env.NODE_ENV !== "test") {
      console.warn("[bptoptracker] login failed:", msg);
    }
  }
  return null;
}

/** Return last login failure reason (for API error response). */
export function getLastLoginError(): string | null {
  return lastLoginError;
}

export function clearBptoptrackerCookieCache(): void {
  cachedCookie = null;
}
