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
  const existing = process.env.BPTOPTRACKER_COOKIE;
  if (existing?.trim()) {
    return existing.trim();
  }
  const email = process.env.BPTOPTRACKER_EMAIL?.trim();
  const password = process.env.BPTOPTRACKER_PASSWORD;
  if (!email || !password) {
    return null;
  }
  if (cachedCookie) {
    return cachedCookie;
  }
  try {
    const getRes = await fetch(LOGIN_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const html = await getRes.text();
    const cookieFromGet = getRes.headers.get("set-cookie");
    const tokenMatch = html.match(/name="_token"\s+value="([^"]+)"/) || html.match(/name="csrf_token"\s+value="([^"]+)"/);
    const actionMatch = html.match(/<form[^>]+action="([^"]+)"/);
    const postUrl = actionMatch ? (actionMatch[1].startsWith("http") ? actionMatch[1] : `${ORIGIN}${actionMatch[1]}`) : LOGIN_URL;
    const emailField = html.includes('name="email"') ? "email" : html.includes('name="login"') ? "login" : "email";
    const params: Record<string, string> = {
      [emailField]: email,
      password,
      ...(process.env.BPTOPTRACKER_REMEMBER === "1" ? { remember: "1" } : {}),
    };
    if (tokenMatch) params._token = tokenMatch[1];

    const res = await fetch(postUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml",
        Origin: ORIGIN,
        Referer: `${ORIGIN}/login`,
        ...(cookieFromGet ? { Cookie: cookieFromGet.split(";").slice(0, 2).join("; ") } : {}),
      },
      body: new URLSearchParams(params).toString(),
      redirect: "manual",
    });
    const setCookie = res.headers.get("set-cookie") ?? cookieFromGet;
    if (setCookie) {
      cachedCookie = setCookie.split(";").slice(0, 2).join("; ").trim();
    }
    const location = res.headers.get("location");
    if (res.status >= 301 && res.status <= 303 && location) {
      const redirectRes = await fetch(location.startsWith("http") ? location : `${ORIGIN}${location}`, {
        headers: cachedCookie ? { Cookie: cachedCookie } : {},
      });
      const nextCookie = redirectRes.headers.get("set-cookie");
      if (nextCookie) {
        cachedCookie = nextCookie.split(";").slice(0, 2).join("; ").trim();
      }
    }
    if (cachedCookie) {
      const verified = await verifyCookie(cachedCookie);
      if (!verified) {
        cachedCookie = null;
        return null;
      }
      return cachedCookie;
    }
  } catch (e) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("[bptoptracker] login failed:", e instanceof Error ? e.message : e);
    }
  }
  return null;
}

export function clearBptoptrackerCookieCache(): void {
  cachedCookie = null;
}
