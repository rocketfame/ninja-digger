/**
 * RA Leads — promoter groups from Resident Advisor events.
 * Segments by weeks until event (1-6 weeks).
 */
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

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
  const segmentFilter = segment ? `AND pp.segment = '${segment}'` : "";
  const result = await pool.query<RAPromoterRow>(`
    SELECT
      p.id,
      p.name,
      p.ra_url,
      p.city,
      p.country,
      p.follower_count,
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
  const [total, withEmail, segments] = await Promise.all([
    pool.query("SELECT COUNT(*) as c FROM ra_promoters"),
    pool.query("SELECT COUNT(DISTINCT promoter_id) as c FROM ra_promoter_contacts WHERE type = 'email' AND status != 'bounced'"),
    pool.query(`
      SELECT segment, COUNT(*) as c
      FROM ra_promoter_profiles
      GROUP BY segment
      ORDER BY segment
    `),
  ]);
  return {
    total: total.rows[0]?.c ?? 0,
    withEmail: withEmail.rows[0]?.c ?? 0,
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
  let stats = { total: 0, withEmail: 0, segments: [] as Array<{ segment: string; c: string }> };

  try {
    [leads, stats] = await Promise.all([
      getRALeads(params.segment),
      getStats(),
    ]);
  } catch {
    // Tables may not exist yet
  }

  const segmentLabels: Record<string, string> = {
    "1_week": "1 тиждень",
    "2_weeks": "2 тижні",
    "3_weeks": "3 тижні",
    "4_weeks": "4 тижні",
    "5_weeks": "5 тижнів",
    "6_weeks": "6 тижнів",
  };

  return (
    <main className="min-h-screen p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">RA Leads — Промо-групи</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Resident Advisor events → промо-групи → enrichment → outreach
          </p>
        </div>
        <div className="flex gap-2">
          <form action="/api/internal/ra/scrape" method="POST">
            <button
              type="submit"
              className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              🔄 Оновити Events
            </button>
          </form>
          <form action="/api/internal/ra/enrich" method="POST">
            <button
              type="submit"
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              🔍 Пошук контактів
            </button>
          </form>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="rounded-lg border border-[var(--border)] p-4">
          <div className="text-2xl font-bold">{stats.total}</div>
          <div className="text-xs text-[var(--text-muted)]">Промо-груп</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] p-4">
          <div className="text-2xl font-bold text-green-500">{stats.withEmail}</div>
          <div className="text-xs text-[var(--text-muted)]">З email</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] p-4">
          <div className="text-2xl font-bold">{leads.length}</div>
          <div className="text-xs text-[var(--text-muted)]">Показано</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] p-4">
          <div className="text-2xl font-bold">{stats.segments.length}</div>
          <div className="text-xs text-[var(--text-muted)]">Сегментів</div>
        </div>
      </div>

      {/* Segment filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <a
          href="/ra-leads"
          className={`px-3 py-1 rounded text-sm ${!params.segment ? "bg-green-600 text-white" : "bg-[var(--bg-card)] text-[var(--text)]"}`}
        >
          всі
        </a>
        {Object.entries(segmentLabels).map(([key, label]) => {
          const count = stats.segments.find((s) => s.segment === key)?.c ?? 0;
          return (
            <a
              key={key}
              href={`/ra-leads?segment=${key}`}
              className={`px-3 py-1 rounded text-sm ${params.segment === key ? "bg-green-600 text-white" : "bg-[var(--bg-card)] text-[var(--text)]"}`}
            >
              {label} ({count})
            </a>
          );
        })}
      </div>

      {/* Leads table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border)]">
              <th className="p-2">Промо-група</th>
              <th className="p-2">Місто</th>
              <th className="p-2">Followers</th>
              <th className="p-2">Сегмент</th>
              <th className="p-2">Найближчий івент</th>
              <th className="p-2">Email</th>
              <th className="p-2">Статус</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id} className="border-b border-[var(--border)] hover:bg-[var(--bg-card)]">
                <td className="p-2">
                  <a href={lead.ra_url} target="_blank" className="text-blue-400 hover:underline">
                    {lead.name}
                  </a>
                </td>
                <td className="p-2">{lead.city}, {lead.country}</td>
                <td className="p-2">{lead.follower_count?.toLocaleString() ?? "—"}</td>
                <td className="p-2">
                  <span className="px-2 py-0.5 rounded text-xs bg-green-900/50 text-green-400">
                    {segmentLabels[lead.segment] ?? lead.segment}
                  </span>
                </td>
                <td className="p-2">
                  <div className="text-xs">{lead.nearest_event ?? "—"}</div>
                  <div className="text-xs text-[var(--text-muted)]">{lead.nearest_event_name ?? ""}</div>
                </td>
                <td className="p-2">
                  {lead.email ? (
                    <span className="text-xs text-green-400">{lead.email}</span>
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">—</span>
                  )}
                </td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    lead.status === "New" ? "bg-yellow-900/50 text-yellow-400" :
                    lead.status === "Attempt 1" ? "bg-blue-900/50 text-blue-400" :
                    lead.status === "Hot" ? "bg-green-900/50 text-green-400" :
                    "bg-gray-800/50 text-gray-400"
                  }`}>
                    {lead.status}
                  </span>
                </td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-[var(--text-muted)]">
                  Немає даних. Натисніть &quot;Оновити Events&quot; щоб завантажити.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
