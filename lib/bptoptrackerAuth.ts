/**
 * BP Top Tracker: obtain session cookie for authenticated requests.
 * Uses BPTOPTRACKER_EMAIL + BPTOPTRACKER_PASSWORD from env (never hardcode credentials).
 * Or use pre-set BPTOPTRACKER_COOKIE if you have a session.
 */

const ORIGIN = "https://www.bptoptracker.com";
const LOGIN_URL = `${ORIGIN}/login`;

let cachedCookie: string | null = null;

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
    const params: Record<string, string> = {
      email,
      password,
      ...(process.env.BPTOPTRACKER_REMEMBER === "1" ? { remember: "1" } : {}),
    };
    const tokenMatch = html.match(/name="_token"\s+value="([^"]+)"/) || html.match(/name="csrf_token"\s+value="([^"]+)"/);
    if (tokenMatch) params._token = tokenMatch[1];
    const actionMatch = html.match(/<form[^>]+action="([^"]+)"/);
    const postUrl = actionMatch ? (actionMatch[1].startsWith("http") ? actionMatch[1] : `${ORIGIN}${actionMatch[1]}`) : LOGIN_URL;

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
      if (cachedCookie) return cachedCookie;
    }
    const location = res.headers.get("location");
    if (res.status >= 301 && res.status <= 303 && location) {
      const redirectRes = await fetch(location.startsWith("http") ? location : `${ORIGIN}${location}`, {
        headers: cachedCookie ? { Cookie: cachedCookie } : {},
      });
      const nextCookie = redirectRes.headers.get("set-cookie");
      if (nextCookie) {
        cachedCookie = nextCookie.split(";").slice(0, 2).join("; ").trim();
        return cachedCookie ?? null;
      }
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
