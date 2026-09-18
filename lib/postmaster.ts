/**
 * Google Postmaster Tools (API v2), read by the cron so the warm-up ladder
 * can gate on what Gmail itself reports (user, 18.09: "нуль ручних кроків").
 *
 * Auth: OAuth 2.0 refresh token of the Google account that owns the domains in
 * Postmaster (Cloud project "Promosound", Desktop client, scope
 * postmaster.traffic.readonly). Env:
 *   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, POSTMASTER_REFRESH_TOKEN
 * Without them `postmasterConfigured()` is false and the ladder gates on our own
 * metrics only (and says so in Telegram).
 *
 * Two reads per domain:
 *   - domainStats:query over the last `daysBack` days: SPAM_RATE,
 *     AUTH_SUCCESS_RATE, DELIVERY_ERROR_RATE, daily — we keep the newest day
 *     that has any value (Google publishes with ~2 days of lag; a day it has
 *     not published is not evidence).
 *   - complianceStatus: the per-requirement COMPLIANT / NEEDS_WORK table and
 *     the deliverability verdict (SPAM_RATE_HIGH, SMTP_ERRORS_HIGH, …).
 */
const API = "https://gmailpostmastertools.googleapis.com/v2";

export type PostmasterDay = {
  date: string;                  // YYYY-MM-DD of the newest published day
  spamRatio: number | null;      // SPAM_RATE, 0..1
  authRatio: number | null;      // AUTH_SUCCESS_RATE for auth_type = dmarc, 0..1
  deliveryErrorRatio: number;    // DELIVERY_ERROR_RATE, 0..1 (0 when unpublished)
  needsWork: string[];           // compliance requirements in NEEDS_WORK
  verdict: string | null;        // deliverabilityStatusVerdict.reason
};

export function postmasterConfigured(): boolean {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.POSTMASTER_REFRESH_TOKEN);
}

let cached: { token: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: process.env.POSTMASTER_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(`Postmaster token: ${j.error ?? res.status} ${j.error_description ?? ""}`.trim());
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Postmaster ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

type YMD = { year: number; month: number; day: number };
type Stat = { date?: YMD; metric?: string; value?: { floatValue?: number; doubleValue?: number; intValue?: string } };
const ymd = (d: Date): YMD => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
const key = (d: YMD) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
const num = (v: Stat["value"]) => (v?.doubleValue ?? v?.floatValue ?? (v?.intValue !== undefined ? Number(v.intValue) : null)) ?? null;

/** Newest published day in the last `daysBack` days, plus the current compliance table. */
export async function latestTrafficStats(domain: string, daysBack = 5, now = new Date()): Promise<PostmasterDay | null> {
  const parent = `domains/${encodeURIComponent(domain)}`;
  const start = new Date(now.getTime() - daysBack * 86_400_000), end = new Date(now.getTime() - 86_400_000);
  const q = await call<{ domainStats?: Stat[] }>(`${parent}/domainStats:query`, {
    metricDefinitions: [
      { name: "spam", baseMetric: { standardMetric: "SPAM_RATE" } },
      // AUTH_SUCCESS_RATE needs an auth_type filter; DMARC is the one Gmail's compliance table judges
      { name: "auth", baseMetric: { standardMetric: "AUTH_SUCCESS_RATE" }, filter: 'auth_type = "dmarc"' },
      { name: "errors", baseMetric: { standardMetric: "DELIVERY_ERROR_RATE" } },
    ],
    timeQuery: { dateRanges: { dateRanges: [{ start: ymd(start), end: ymd(end) }] } },
    aggregationGranularity: "DAILY",
  });
  // each metric on its own newest day: Gmail publishes spam rate only for days
  // with enough volume, auth/errors for any day with traffic
  const latest: Partial<Record<"spam" | "auth" | "errors", { date: string; v: number }>> = {};
  for (const s of q.domainStats ?? []) {
    if (!s.date || !s.metric) continue;
    const v = num(s.value);
    if (v === null) continue;
    const k = s.metric as "spam" | "auth" | "errors", d = key(s.date);
    if (!latest[k] || latest[k]!.date < d) latest[k] = { date: d, v };
  }
  if (!latest.spam && !latest.auth && !latest.errors) return null;
  const date = [latest.spam, latest.auth, latest.errors].filter(Boolean).map((x) => x!.date).sort().pop()!;

  // compliance is "now", not per day — read best-effort so a missing table never hides the metrics
  let needsWork: string[] = [], verdict: string | null = null;
  try {
    const c = await call<{ complianceData?: { rowData?: { requirement?: string; status?: { status?: string } }[]; deliverabilityStatusVerdict?: { reason?: string; state?: { status?: string } } } }>(`${parent}/complianceStatus`);
    needsWork = (c.complianceData?.rowData ?? []).filter((r) => r.status?.status === "NEEDS_WORK").map((r) => r.requirement ?? "?");
    const v = c.complianceData?.deliverabilityStatusVerdict;
    verdict = v?.state?.status === "NEEDS_WORK" ? (v.reason ?? "NEEDS_WORK") : v?.reason ?? null;
  } catch { /* the day's metrics still stand */ }

  return { date, spamRatio: latest.spam?.v ?? null, authRatio: latest.auth?.v ?? null, deliveryErrorRatio: latest.errors?.v ?? 0, needsWork, verdict };
}
