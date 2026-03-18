/**
 * RA Leads — promoter groups from Resident Advisor events.
 * Uses same design system as Beatport Leads (KPI cards, segment chips, table).
 */
import Link from "next/link";
import { pool } from "@/lib/db";
import { NavBar } from "@/app/components/NavBar";

export const dynamic = "force-dynamic";

const SEGMENT_LABELS: Record<string, string> = {
  "1_week": "1 тиждень",
  "2_weeks": "2 тижні",
  "3_weeks": "3 тижні",
  "4_weeks": "4 тижні",
  "5_weeks": "5 тижнів",
  "6_weeks": "6 тижнів",
};

const SEGMENT_CHIP_COLORS: Record<string, { activeBg: string; activeText: string }> = {
  "1_week":  { activeBg: "rgba(239,68,68,0.25)",   activeText: "#f87171" },
  "2_weeks": { activeBg: "rgba(250,204,21,0.25)",   activeText: "#fbbf24" },
  "3_weeks": { activeBg: "rgba(34,197,94,0.25)",    activeText: "#4ade80" },
  "4_weeks": { activeBg: "rgba(59,130,246,0.25)",   activeText: "#60a5fa" },
  "5_weeks": { activeBg: "rgba(168,85,247,0.25)",   activeText: "#c084fc" },
  "6_weeks": { activeBg: "rgba(168,162,158,0.25)",  activeText: "#d6d3d1" },
};

type RAPromoterRow = {
  id: number;
  name: string;
  ra_url: string;
  city: string;
  country: string;
  follower_count: number;
  segment: string;
  status: string;
  email: string | null;
  event_count: number;
  nearest_event: string;
  nearest_event_name: string;
};

async function getRALeads(segment?: string) {
  const segmentFilter = segment && SEGMENT_LABELS[segment] ? `AND pp.segment = '${segment}'` : "";
  const result = await pool.query<RAPromoterRow>(`
    SELECT
      p.id,
      p.name,
      p.ra_url,
      COALESCE(p.city, '') as city,
      COALESCE(p.country, '') as country,
      COALESCE(p.follower_count, 0) as follower_count,
      COALESCE(pp.segment, '6_weeks') as segment,
      COALESCE(pp.status, 'New') as status,
      (SELECT c.value FROM ra_promoter_contacts c WHERE c.promoter_id = p.id AND c.type = 'email' AND c.status != 'bounced' ORDER BY c.confidence DESC LIMIT 1) as email,
      (SELECT COUNT(*) FROM ra_events e WHERE e.promoter_id = p.id AND e.event_date >= CURRENT_DATE)::int as event_count,
      (SELECT MIN(e.event_date)::text FROM ra_events e WHERE e.promoter_id = p.id AND e.event_date >= CURRENT_DATE) as nearest_event,
      (SELECT e.name FROM ra_events e WHERE e.promoter_id = p.id AND e.event_date >= CURRENT_DATE ORDER BY e.event_date LIMIT 1) as nearest_event_name
    FROM ra_promoters p
    LEFT JOIN ra_promoter_profiles pp ON p.id = pp.promoter_id
    WHERE 1=1 ${segmentFilter}
    ORDER BY p.follower_count DESC NULLS LAST
    LIMIT 200
  `);
  return result.rows;
}

async function getStats() {
  const [total, withEmail, segments, inWork] = await Promise.all([
    pool.query("SELECT COUNT(*) as c FROM ra_promoters"),
    pool.query("SELECT COUNT(DISTINCT promoter_id) as c FROM ra_promoter_contacts WHERE type = 'email' AND status != 'bounced'"),
    pool.query(`
      SELECT segment, COUNT(*) as c
      FROM ra_promoter_profiles
      GROUP BY segment
      ORDER BY segment
    `),
    pool.query("SELECT COUNT(*) as c FROM ra_promoter_profiles WHERE status IS NOT NULL AND status != 'New'"),
  ]);
  return {
    total: Number(total.rows[0]?.c ?? 0),
    withEmail: Number(withEmail.rows[0]?.c ?? 0),
    inWork: Number(inWork.rows[0]?.c ?? 0),
    segments: segments.rows as Array<{ segment: string; c: string }>,
  };
}

export default async function RALeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string }>;
}) {
  const params = await searchParams;

  let leads: RAPromoterRow[] = [];
  let stats = { total: 0, withEmail: 0, inWork: 0, segments: [] as Array<{ segment: string; c: string }> };
  let error: string | null = null;

  try {
    [leads, stats] = await Promise.all([
      getRALeads(params.segment),
      getStats(),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Помилка завантаження.";
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />

      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-5 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-[var(--text)]">RA Leads — Промо-групи</h1>
        </div>

        {/* KPI cards — same style as Beatport */}
        {!error && (
          <div className="mb-5 grid grid-cols-3 gap-3 sm:grid-cols-6">
            <div className="kpi-card rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
              <div className="text-2xl font-bold tabular-nums text-[var(--text)]">{stats.total.toLocaleString()}</div>
              <div className="mt-0.5 text-xs text-[var(--text-muted)]">Промо-груп</div>
            </div>
            <div className="kpi-card rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 shrink-0 text-[#60a5fa]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                <div className="text-2xl font-bold tabular-nums text-[var(--text)]">{stats.withEmail}</div>
              </div>
              <div className="mt-0.5 text-xs text-[var(--text-muted)]">З email</div>
            </div>
            <div className="kpi-card rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 shrink-0 text-[#fbbf24]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                <div className="text-2xl font-bold tabular-nums text-[var(--text)]">{stats.inWork}</div>
              </div>
              <div className="mt-0.5 text-xs text-[var(--text-muted)]">В роботі</div>
            </div>
            <div className="kpi-card rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
              <div className="text-2xl font-bold tabular-nums text-[var(--text)]">{leads.length}</div>
              <div className="mt-0.5 text-xs text-[var(--text-muted)]">Показано</div>
            </div>
          </div>
        )}

        {/* Segment chips — same style as Beatport */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--text-muted)]">Сегмент:</span>
          <Link
            href="/ra-leads"
            className="rounded-md px-3 py-1 text-sm font-medium transition-colors"
            style={!params.segment ? { backgroundColor: "rgba(255,255,255,0.1)", color: "var(--text)" } : { color: "var(--text-muted)" }}
          >
            всі
          </Link>
          {Object.entries(SEGMENT_LABELS).map(([key, label]) => {
            const isActive = params.segment === key;
            const colors = SEGMENT_CHIP_COLORS[key] ?? { activeBg: "rgba(255,255,255,0.1)", activeText: "#fff" };
            const count = stats.segments.find((s) => s.segment === key)?.c ?? 0;
            return (
              <Link
                key={key}
                href={`/ra-leads?segment=${key}`}
                className="rounded-md px-3 py-1 text-sm font-medium transition-colors"
                style={isActive ? { backgroundColor: colors.activeBg, color: colors.activeText } : { color: "var(--text-muted)" }}
              >
                {label} {Number(count) > 0 && <span className="ml-1 opacity-70">({count})</span>}
              </Link>
            );
          })}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Table — same structure as Beatport LeadsTable */}
        {!error && (
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium">Промо-група</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium">Місто</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium">Followers</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium">Сегмент</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium">Найближчий івент</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium">Email</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium">Статус</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const segColors = SEGMENT_CHIP_COLORS[lead.segment] ?? { activeBg: "rgba(168,162,158,0.25)", activeText: "#d6d3d1" };
                  return (
                    <tr key={lead.id} className="border-b border-[var(--border)] transition-colors hover:bg-[var(--bg-card)]">
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <a
                          href={lead.ra_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-[var(--accent)] hover:underline"
                        >
                          {lead.name}
                        </a>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[var(--text-muted)]">
                        {lead.city}{lead.country ? `, ${lead.country}` : ""}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                        {lead.follower_count > 0 ? lead.follower_count.toLocaleString() : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span
                          className="inline-block rounded-md px-2 py-0.5 text-xs font-medium"
                          style={{ backgroundColor: segColors.activeBg, color: segColors.activeText }}
                        >
                          {SEGMENT_LABELS[lead.segment] ?? lead.segment}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {lead.nearest_event ? (
                          <div>
                            <div className="text-xs tabular-nums">{lead.nearest_event}</div>
                            <div className="max-w-[200px] truncate text-xs text-[var(--text-muted)]">{lead.nearest_event_name}</div>
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {lead.email ? (
                          <span className="text-xs text-green-400">{lead.email}</span>
                        ) : (
                          <span className="text-xs text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {lead.status !== "New" ? (
                          <span
                            className="inline-block rounded-md px-2 py-0.5 text-xs font-medium"
                            style={
                              lead.status === "Attempt 1" ? { backgroundColor: "rgba(59,130,246,0.25)", color: "#60a5fa" } :
                              lead.status === "Attempt 2" ? { backgroundColor: "rgba(168,85,247,0.25)", color: "#c084fc" } :
                              lead.status === "Hot" ? { backgroundColor: "rgba(34,197,94,0.25)", color: "#4ade80" } :
                              lead.status === "Cold" ? { backgroundColor: "rgba(168,162,158,0.25)", color: "#d6d3d1" } :
                              { backgroundColor: "rgba(250,204,21,0.25)", color: "#fbbf24" }
                            }
                          >
                            {lead.status === "Attempt 1" ? "→ 1-й контакт" : lead.status === "Attempt 2" ? "→→ 2-й контакт" : lead.status}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {leads.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-12 text-center text-[var(--text-muted)]">
                      {error ? error : "Немає даних. Дані з&apos;являться автоматично через pipeline."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer count */}
        {!error && leads.length > 0 && (
          <div className="mt-3 text-xs text-[var(--text-muted)]">
            Показано {leads.length} промо-груп
          </div>
        )}
      </main>
    </div>
  );
}
