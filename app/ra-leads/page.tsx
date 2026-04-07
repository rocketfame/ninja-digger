/**
 * RA Leads — promoter groups from Resident Advisor events.
 * Filters: city + weeks until event.
 * Same design system as Beatport Leads.
 */
import Link from "next/link";
import { pool } from "@/lib/db";
import { NavBar } from "@/app/components/NavBar";
import { BlacklistForm } from "@/app/components/BlacklistForm";

export const dynamic = "force-dynamic";

const WEEK_LABELS: Record<string, string> = {
  "1": "1 тиждень",
  "2": "2 тижні",
  "3": "3 тижні",
  "4": "4 тижні",
  "5": "5 тижнів",
  "6": "6 тижнів",
};

const WEEK_COLORS: Record<string, { bg: string; text: string }> = {
  "1": { bg: "rgba(239,68,68,0.25)", text: "#f87171" },
  "2": { bg: "rgba(250,204,21,0.25)", text: "#fbbf24" },
  "3": { bg: "rgba(34,197,94,0.25)", text: "#4ade80" },
  "4": { bg: "rgba(59,130,246,0.25)", text: "#60a5fa" },
  "5": { bg: "rgba(168,85,247,0.25)", text: "#c084fc" },
  "6": { bg: "rgba(168,162,158,0.25)", text: "#d6d3d1" },
};

type RAPromoterRow = {
  id: number;
  name: string;
  ra_url: string;
  city: string;
  country: string;
  follower_count: number;
  weeks_until: number;
  status: string;
  email: string | null;
  event_count: number;
  nearest_event: string;
  nearest_event_name: string;
};

async function getRALeads(city?: string, weeks?: string) {
  const conditions: string[] = ["e.event_date >= CURRENT_DATE"];
  const params: (string | number)[] = [];
  let paramIdx = 1;

  if (city) {
    conditions.push(`p.city = $${paramIdx}`);
    params.push(city);
    paramIdx++;
  }
  if (weeks) {
    const w = parseInt(weeks);
    if (w >= 1 && w <= 6) {
      conditions.push(`e.event_date <= CURRENT_DATE + ${w * 7}`);
      conditions.push(`e.event_date > CURRENT_DATE + ${(w - 1) * 7}`);
    }
  }

  const result = await pool.query<RAPromoterRow>(`
    SELECT
      p.id, p.name, p.ra_url,
      COALESCE(p.city, '') as city,
      COALESCE(p.country, '') as country,
      COALESCE(p.follower_count, 0) as follower_count,
      GREATEST(1, LEAST(6, CEIL((MIN(e.event_date) - CURRENT_DATE)::numeric / 7)))::int as weeks_until,
      COALESCE(pp.status, 'New') as status,
      (SELECT c.value FROM ra_promoter_contacts c WHERE c.promoter_id = p.id AND c.type = 'email' AND c.status != 'bounced' ORDER BY c.confidence DESC LIMIT 1) as email,
      COUNT(DISTINCT e.id)::int as event_count,
      MIN(e.event_date)::text as nearest_event,
      (SELECT e3.name FROM ra_events e3 WHERE e3.promoter_id = p.id AND e3.event_date >= CURRENT_DATE ORDER BY e3.event_date LIMIT 1) as nearest_event_name
    FROM ra_promoters p
    JOIN ra_events e ON e.promoter_id = p.id
    LEFT JOIN ra_promoter_profiles pp ON p.id = pp.promoter_id
    WHERE ${conditions.join(" AND ")}
    GROUP BY p.id, p.name, p.ra_url, p.city, p.country, p.follower_count, pp.status
    ORDER BY MIN(e.event_date) ASC
    LIMIT 300
  `, params);
  return result.rows;
}

async function getStats() {
  const [total, withEmail, cities, weekCounts, inWork] = await Promise.all([
    pool.query("SELECT COUNT(*) as c FROM ra_promoters"),
    pool.query("SELECT COUNT(DISTINCT promoter_id) as c FROM ra_promoter_contacts WHERE type = 'email' AND status != 'bounced'"),
    pool.query("SELECT city, COUNT(*) as c FROM ra_promoters WHERE city != '' GROUP BY city ORDER BY c DESC LIMIT 30"),
    pool.query(`
      SELECT w, COUNT(DISTINCT promoter_id) as c FROM (
        SELECT e.promoter_id, GREATEST(1, LEAST(6, CEIL((e.event_date - CURRENT_DATE)::numeric / 7)))::int as w
        FROM ra_events e WHERE e.event_date >= CURRENT_DATE AND e.promoter_id IS NOT NULL
      ) sub
      GROUP BY w HAVING w BETWEEN 1 AND 6
      ORDER BY w
    `),
    pool.query("SELECT COUNT(*) as c FROM ra_promoter_profiles WHERE status IS NOT NULL AND status != 'New'"),
  ]);
  return {
    total: Number(total.rows[0]?.c ?? 0),
    withEmail: Number(withEmail.rows[0]?.c ?? 0),
    inWork: Number(inWork.rows[0]?.c ?? 0),
    cities: cities.rows as Array<{ city: string; c: string }>,
    weekCounts: weekCounts.rows as Array<{ w: number; c: string }>,
  };
}

export default async function RALeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string; weeks?: string }>;
}) {
  const params = await searchParams;
  let leads: RAPromoterRow[] = [];
  let stats = { total: 0, withEmail: 0, inWork: 0, cities: [] as Array<{ city: string; c: string }>, weekCounts: [] as Array<{ w: number; c: string }> };
  let error: string | null = null;

  try {
    [leads, stats] = await Promise.all([getRALeads(params.city, params.weeks), getStats()]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Помилка завантаження.";
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-5 flex items-center justify-between">
          <h1 className="text-xl font-semibold">RA Leads — Промо-групи</h1>
        </div>

        {/* KPI */}
        {!error && (
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="kpi-card rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
              <div className="text-2xl font-bold tabular-nums">{stats.total.toLocaleString()}</div>
              <div className="mt-0.5 text-xs text-[var(--text-muted)]">Промо-груп</div>
            </div>
            <div className="kpi-card rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 text-[#60a5fa]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                <div className="text-2xl font-bold tabular-nums">{stats.withEmail}</div>
              </div>
              <div className="mt-0.5 text-xs text-[var(--text-muted)]">З email</div>
            </div>
            <div className="kpi-card rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 text-[#fbbf24]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                <div className="text-2xl font-bold tabular-nums">{stats.inWork}</div>
              </div>
              <div className="mt-0.5 text-xs text-[var(--text-muted)]">В роботі</div>
            </div>
            <div className="kpi-card rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
              <div className="text-2xl font-bold tabular-nums">{leads.length}</div>
              <div className="mt-0.5 text-xs text-[var(--text-muted)]">Показано</div>
            </div>
          </div>
        )}

        {/* City filter */}
        {!error && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--text-muted)]">Місто:</span>
            <Link href="/ra-leads" className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors" style={!params.city ? { backgroundColor: "rgba(255,255,255,0.12)", color: "#fff" } : { color: "var(--text-muted)" }}>всі</Link>
            {stats.cities.slice(0, 15).map(({ city, c }) => (
              <Link key={city} href={`/ra-leads?city=${encodeURIComponent(city)}${params.weeks ? '&weeks=' + params.weeks : ''}`} className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors" style={params.city === city ? { backgroundColor: "rgba(34,197,94,0.25)", color: "#4ade80" } : { color: "var(--text-muted)" }}>
                {city} <span className="opacity-60">({c})</span>
              </Link>
            ))}
          </div>
        )}

        {/* Weeks filter */}
        {!error && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--text-muted)]">Тижнів до івенту:</span>
            <Link href={`/ra-leads${params.city ? '?city=' + encodeURIComponent(params.city) : ''}`} className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors" style={!params.weeks ? { backgroundColor: "rgba(255,255,255,0.12)", color: "#fff" } : { color: "var(--text-muted)" }}>всі</Link>
            {Object.entries(WEEK_LABELS).map(([w, label]) => {
              const count = stats.weekCounts.find(wc => wc.w === Number(w))?.c ?? 0;
              const colors = WEEK_COLORS[w];
              const isActive = params.weeks === w;
              return (
                <Link key={w} href={`/ra-leads?${params.city ? 'city=' + encodeURIComponent(params.city) + '&' : ''}weeks=${w}`} className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors" style={isActive ? { backgroundColor: colors.bg, color: colors.text } : { color: "var(--text-muted)" }}>
                  {label} {Number(count) > 0 && <span className="opacity-60">({count})</span>}
                </Link>
              );
            })}
          </div>
        )}

        {/* Blacklist */}
        {!error && (
          <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
            <BlacklistForm />
          </div>
        )}

        {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">{error}</div>}

        {/* Table */}
        {!error && (
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium">Промо-група</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium">Місто</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium">Followers</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium">Тижнів</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium">Найближчий івент</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium">Email</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium">Статус</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const wk = Math.max(1, Math.min(6, lead.weeks_until || 6));
                  const wColors = WEEK_COLORS[String(wk)] ?? WEEK_COLORS["6"];
                  return (
                    <tr key={lead.id} className="border-b border-[var(--border)] transition-colors hover:bg-[var(--bg-card)]">
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <a href={lead.ra_url} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--accent)] hover:underline">{lead.name}</a>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[var(--text-muted)]">{lead.city}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{lead.follower_count > 0 ? lead.follower_count.toLocaleString() : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span className="inline-block rounded-md px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: wColors.bg, color: wColors.text }}>
                          {WEEK_LABELS[String(wk)] ?? `${wk} тижн.`}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {lead.nearest_event ? (
                          <div>
                            <div className="text-xs tabular-nums">{lead.nearest_event}</div>
                            <div className="max-w-[200px] truncate text-xs text-[var(--text-muted)]">{lead.nearest_event_name}</div>
                          </div>
                        ) : <span className="text-xs text-[var(--text-muted)]">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {lead.email ? <span className="text-xs text-green-400">{lead.email}</span> : <span className="text-xs text-[var(--text-muted)]">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {lead.status !== "New" && (
                          <span className="inline-block rounded-md px-2 py-0.5 text-xs font-medium"
                            style={lead.status === "Attempt 1" ? { backgroundColor: "rgba(59,130,246,0.25)", color: "#60a5fa" } : lead.status === "Hot" ? { backgroundColor: "rgba(34,197,94,0.25)", color: "#4ade80" } : { backgroundColor: "rgba(168,162,158,0.25)", color: "#d6d3d1" }}>
                            {lead.status === "Attempt 1" ? "→ 1-й контакт" : lead.status}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {leads.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-12 text-center text-[var(--text-muted)]">Немає даних. Парсер працює — дані з&apos;являться автоматично.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {!error && leads.length > 0 && <div className="mt-3 text-xs text-[var(--text-muted)]">Показано {leads.length} промо-груп</div>}
      </main>
    </div>
  );
}
