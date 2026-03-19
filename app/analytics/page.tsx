/**
 * Analytics — outreach statistics dashboard.
 * Shows emails sent by day, pipeline stats, bounce rates.
 */
import { pool } from "@/lib/db";
import { NavBar } from "@/app/components/NavBar";

export const dynamic = "force-dynamic";

type DayStat = { date: string; count: number };
type StatusCount = { status: string; count: number };

async function getAnalytics() {
  const [
    sentByDay,
    sentTotal,
    sentToday,
    sentYesterday,
    sentThisWeek,
    bpStatuses,
    raStatuses,
    bpTotal,
    bpWithEmail,
    raTotal,
    raWithEmail,
    bouncedBp,
    bouncedRa,
    raEvents,
    raCities,
  ] = await Promise.all([
    pool.query<DayStat>(`
      SELECT date, SUM(count)::int as count FROM (
        SELECT updated_at::date::text as date, COUNT(*)::int as count FROM lead_profiles WHERE status != 'New' AND updated_at >= CURRENT_DATE - 14 GROUP BY date
        UNION ALL
        SELECT updated_at::date::text as date, COUNT(*)::int as count FROM ra_promoter_profiles WHERE status != 'New' AND updated_at >= CURRENT_DATE - 14 GROUP BY date
      ) combined GROUP BY date ORDER BY date DESC
    `).catch(() => ({ rows: [] as DayStat[] })),
    pool.query(`SELECT (SELECT COUNT(*)::int FROM lead_profiles WHERE status IN ('Attempt 1','Attempt 2','Contacted','No Response','Cold','Hot')) + (SELECT COUNT(*)::int FROM ra_promoter_profiles WHERE status IN ('Attempt 1','Attempt 2','No Response','Cold','Hot')) as c`).catch(() => ({ rows: [{ c: 0 }] })),
    pool.query(`SELECT (SELECT COUNT(*)::int FROM lead_profiles WHERE status != 'New' AND updated_at >= CURRENT_DATE) + (SELECT COUNT(*)::int FROM ra_promoter_profiles WHERE status != 'New' AND updated_at >= CURRENT_DATE) as c`).catch(() => ({ rows: [{ c: 0 }] })),
    pool.query(`SELECT (SELECT COUNT(*)::int FROM lead_profiles WHERE status != 'New' AND updated_at >= CURRENT_DATE - 1 AND updated_at < CURRENT_DATE) + (SELECT COUNT(*)::int FROM ra_promoter_profiles WHERE status != 'New' AND updated_at >= CURRENT_DATE - 1 AND updated_at < CURRENT_DATE) as c`).catch(() => ({ rows: [{ c: 0 }] })),
    pool.query(`SELECT (SELECT COUNT(*)::int FROM lead_profiles WHERE status != 'New' AND updated_at >= CURRENT_DATE - 7) + (SELECT COUNT(*)::int FROM ra_promoter_profiles WHERE status != 'New' AND updated_at >= CURRENT_DATE - 7) as c`).catch(() => ({ rows: [{ c: 0 }] })),
    pool.query<StatusCount>("SELECT COALESCE(status, 'New') as status, COUNT(*)::int as count FROM lead_profiles GROUP BY status ORDER BY count DESC").catch(() => ({ rows: [] as StatusCount[] })),
    pool.query<StatusCount>("SELECT COALESCE(status, 'New') as status, COUNT(*)::int as count FROM ra_promoter_profiles GROUP BY status ORDER BY count DESC").catch(() => ({ rows: [] as StatusCount[] })),
    pool.query("SELECT COUNT(*)::int as c FROM lead_scores").catch(() => ({ rows: [{ c: 0 }] })),
    pool.query("SELECT COUNT(DISTINCT artist_beatport_id)::int as c FROM artist_contacts WHERE type='email' AND confidence >= 0.65 AND (status IS NULL OR status != 'bounced')").catch(() => ({ rows: [{ c: 0 }] })),
    pool.query("SELECT COUNT(*)::int as c FROM ra_promoters").catch(() => ({ rows: [{ c: 0 }] })),
    pool.query("SELECT COUNT(DISTINCT promoter_id)::int as c FROM ra_promoter_contacts WHERE type='email' AND status != 'bounced'").catch(() => ({ rows: [{ c: 0 }] })),
    pool.query("SELECT COUNT(*)::int as c FROM artist_contacts WHERE status = 'bounced'").catch(() => ({ rows: [{ c: 0 }] })),
    pool.query("SELECT COUNT(*)::int as c FROM ra_promoter_contacts WHERE status = 'bounced'").catch(() => ({ rows: [{ c: 0 }] })),
    pool.query("SELECT COUNT(*)::int as c FROM ra_events WHERE event_date >= CURRENT_DATE").catch(() => ({ rows: [{ c: 0 }] })),
    pool.query("SELECT city, COUNT(*)::int as c FROM ra_promoters WHERE city != '' GROUP BY city ORDER BY c DESC LIMIT 10").catch(() => ({ rows: [] })),
  ]);

  return {
    sentByDay: sentByDay.rows,
    sent: { total: sentTotal.rows[0]?.c ?? 0, today: sentToday.rows[0]?.c ?? 0, yesterday: sentYesterday.rows[0]?.c ?? 0, week: sentThisWeek.rows[0]?.c ?? 0 },
    bp: { total: bpTotal.rows[0]?.c ?? 0, withEmail: bpWithEmail.rows[0]?.c ?? 0, statuses: bpStatuses.rows, bounced: bouncedBp.rows[0]?.c ?? 0 },
    ra: { total: raTotal.rows[0]?.c ?? 0, withEmail: raWithEmail.rows[0]?.c ?? 0, statuses: raStatuses.rows as StatusCount[], bounced: bouncedRa.rows[0]?.c ?? 0, events: raEvents.rows[0]?.c ?? 0, cities: raCities.rows as Array<{ city: string; c: number }> },
  };
}

const STATUS_COLORS: Record<string, string> = {
  "New": "#6b7280",
  "Attempt 1": "#60a5fa",
  "Attempt 2": "#c084fc",
  "No Response": "#fbbf24",
  "Cold": "#9ca3af",
  "Hot": "#4ade80",
  "Contacted": "#60a5fa",
  "Bounced": "#f87171",
};

export default async function AnalyticsPage() {
  const a = await getAnalytics();

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-6 text-xl font-semibold">Аналітика</h1>

        {/* Outreach overview */}
        <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">Відправка email</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <div className="text-3xl font-bold tabular-nums text-[var(--accent)]">{a.sent.total}</div>
              <div className="text-xs text-[var(--text-muted)]">Всього відправлено</div>
            </div>
            <div>
              <div className="text-3xl font-bold tabular-nums text-green-400">{a.sent.today}</div>
              <div className="text-xs text-[var(--text-muted)]">Сьогодні</div>
            </div>
            <div>
              <div className="text-3xl font-bold tabular-nums">{a.sent.yesterday}</div>
              <div className="text-xs text-[var(--text-muted)]">Вчора</div>
            </div>
            <div>
              <div className="text-3xl font-bold tabular-nums">{a.sent.week}</div>
              <div className="text-xs text-[var(--text-muted)]">За тиждень</div>
            </div>
          </div>
        </div>

        {/* Daily breakdown */}
        <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">По днях (14 днів)</h2>
          <div className="space-y-2">
            {a.sentByDay.map((d) => (
              <div key={d.date} className="flex items-center gap-3">
                <div className="w-24 text-xs tabular-nums text-[var(--text-muted)]">{d.date}</div>
                <div className="flex-1">
                  <div className="h-5 rounded-sm bg-[var(--accent)]" style={{ width: `${Math.min(100, (d.count / Math.max(...a.sentByDay.map(x => x.count), 1)) * 100)}%`, opacity: 0.7 }} />
                </div>
                <div className="w-10 text-right text-xs font-medium tabular-nums">{d.count}</div>
              </div>
            ))}
            {a.sentByDay.length === 0 && <div className="text-sm text-[var(--text-muted)]">Немає даних</div>}
          </div>
        </div>

        {/* Pipeline stats */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Beatport */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">Beatport Leads</h2>
            <div className="mb-3 grid grid-cols-3 gap-2">
              <div>
                <div className="text-xl font-bold tabular-nums">{a.bp.total.toLocaleString()}</div>
                <div className="text-[10px] text-[var(--text-muted)]">Всього</div>
              </div>
              <div>
                <div className="text-xl font-bold tabular-nums text-[#60a5fa]">{a.bp.withEmail}</div>
                <div className="text-[10px] text-[var(--text-muted)]">З email</div>
              </div>
              <div>
                <div className="text-xl font-bold tabular-nums text-red-400">{a.bp.bounced}</div>
                <div className="text-[10px] text-[var(--text-muted)]">Bounced</div>
              </div>
            </div>
            <div className="space-y-1.5">
              {a.bp.statuses.map((s) => (
                <div key={s.status} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[s.status] ?? "#6b7280" }} />
                    <span>{s.status}</span>
                  </div>
                  <span className="tabular-nums font-medium">{s.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* RA */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">RA Leads</h2>
            <div className="mb-3 grid grid-cols-3 gap-2">
              <div>
                <div className="text-xl font-bold tabular-nums">{a.ra.total.toLocaleString()}</div>
                <div className="text-[10px] text-[var(--text-muted)]">Промо-груп</div>
              </div>
              <div>
                <div className="text-xl font-bold tabular-nums text-[#60a5fa]">{a.ra.withEmail}</div>
                <div className="text-[10px] text-[var(--text-muted)]">З email</div>
              </div>
              <div>
                <div className="text-xl font-bold tabular-nums">{a.ra.events}</div>
                <div className="text-[10px] text-[var(--text-muted)]">Івентів</div>
              </div>
            </div>
            <div className="space-y-1.5">
              {a.ra.statuses.map((s) => (
                <div key={s.status} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[s.status] ?? "#6b7280" }} />
                    <span>{s.status}</span>
                  </div>
                  <span className="tabular-nums font-medium">{s.count}</span>
                </div>
              ))}
            </div>
            {a.ra.cities.length > 0 && (
              <>
                <div className="mt-4 text-[10px] font-semibold uppercase text-[var(--text-muted)]">Топ міст</div>
                <div className="mt-1 space-y-1">
                  {a.ra.cities.map((c) => (
                    <div key={c.city} className="flex items-center justify-between text-xs">
                      <span>{c.city}</span>
                      <span className="tabular-nums text-[var(--text-muted)]">{c.c}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
