import { pool } from "@/lib/db";
import { NavBar } from "@/app/components/NavBar";
import { STATUS_UA } from "@/lib/statusLabels";

export const dynamic = "force-dynamic";

type DayStat = { date: string; count: number };
type StatusRow = { status: string; count: number };
type TouchRow = { template_id: string; total: number; last7d: number };

async function getData() {
  const q = (sql: string) => pool.query(sql).catch(() => ({ rows: [{ c: 0 }] }));
  const qs = (sql: string) => pool.query<StatusRow>(sql).catch(() => ({ rows: [] as StatusRow[] }));
  const qd = (sql: string) => pool.query<DayStat>(sql).catch(() => ({ rows: [] as DayStat[] }));

  const [bpToday, bpYesterday, bpTotal, bpStatuses, bpEmail, bounced, replied, won, touches, dailyBreakdown] = await Promise.all([
    q("SELECT COUNT(*)::int as c FROM outreach_events WHERE sent_at >= CURRENT_DATE"),
    q("SELECT COUNT(*)::int as c FROM outreach_events WHERE sent_at >= CURRENT_DATE - 1 AND sent_at < CURRENT_DATE"),
    q("SELECT COUNT(*)::int as c FROM outreach_events"),
    qs("SELECT status, COUNT(*)::int as count FROM lead_profiles GROUP BY status ORDER BY count DESC"),
    q("SELECT COUNT(DISTINCT artist_beatport_id)::int as c FROM artist_contacts WHERE type='email' AND confidence>=0.65 AND (status IS NULL OR status='ok')"),
    q("SELECT COUNT(*)::int as c FROM artist_contacts WHERE status='bounced'"),
    q("SELECT COUNT(*)::int as c FROM lead_profiles WHERE status IN ('Responded','In Progress','Won')"),
    q("SELECT COUNT(*)::int as c FROM lead_profiles WHERE status='Won'"),
    pool.query<TouchRow>(
      `SELECT template_id, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE sent_at >= CURRENT_DATE - 7)::int AS last7d
       FROM outreach_events WHERE channel='email' AND template_id LIKE 'email_touch_%'
       GROUP BY template_id ORDER BY template_id`
    ).catch(() => ({ rows: [] as TouchRow[] })),
    qd(`SELECT sent_at::date::text as date, COUNT(*)::int as count
        FROM outreach_events WHERE sent_at >= CURRENT_DATE - 14
        GROUP BY 1 ORDER BY 1 DESC`),
  ]);

  return {
    today: Number(bpToday.rows[0]?.c ?? 0),
    yesterday: Number(bpYesterday.rows[0]?.c ?? 0),
    total: Number(bpTotal.rows[0]?.c ?? 0),
    statuses: bpStatuses.rows,
    email: Number(bpEmail.rows[0]?.c ?? 0),
    bounced: Number(bounced.rows[0]?.c ?? 0),
    replied: Number(replied.rows[0]?.c ?? 0),
    won: Number(won.rows[0]?.c ?? 0),
    touches: touches.rows,
    daily: dailyBreakdown.rows,
  };
}

const SC: Record<string, string> = { "New": "#6b7280", "Attempt 1": "#60a5fa", "Attempt 2": "#c084fc", "No Response": "#fbbf24", "Cold": "#9ca3af", "Hot": "#4ade80", "Contacted": "#60a5fa", "Responded": "#4ade80", "In Progress": "#4ade80", "Won": "#22c55e", "Bounced": "#f87171", "Blacklist": "#f87171" };

export default async function AnalyticsPage() {
  const d = await getData();

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-6 text-xl font-semibold">Аналітика — Beatport</h1>

        {/* Summary row */}
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-xs text-[var(--text-muted)] mb-1">Всього відправлено</div>
            <div className="text-3xl font-bold tabular-nums text-[var(--accent)]">{d.total}</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-xs text-[var(--text-muted)] mb-1">Сьогодні / Вчора</div>
            <div className="text-3xl font-bold tabular-nums text-green-400">{d.today} <span className="text-lg text-[var(--text-muted)]">/ {d.yesterday}</span></div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-xs text-[var(--text-muted)] mb-1">Відповіли</div>
            <div className="text-3xl font-bold tabular-nums text-green-400">{d.replied}</div>
            <div className="text-[10px] text-[var(--text-muted)]">Won: {d.won}</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-xs text-[var(--text-muted)] mb-1">Відбиті (bounce)</div>
            <div className="text-3xl font-bold tabular-nums text-red-400">{d.bounced}</div>
          </div>
        </div>

        {/* Touches + Statuses */}
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Дотики</div>
            <div className="space-y-2">
              {[1, 2, 3].map((n) => {
                const t = d.touches.find((x) => x.template_id === `email_touch_${n}`);
                return (
                  <div key={n} className="flex items-center justify-between text-sm">
                    <span>Touch {n}</span>
                    <span className="tabular-nums font-medium">{t?.total ?? 0} <span className="text-xs text-[var(--text-muted)]">(+{t?.last7d ?? 0} за 7д)</span></span>
                  </div>
                );
              })}
              <div className="flex items-center justify-between border-t border-[var(--border)] pt-2 text-sm">
                <span>З email (активні)</span>
                <span className="tabular-nums font-medium text-[#60a5fa]">{d.email}</span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Статуси лідів</div>
            <div className="space-y-1">
              {d.statuses.map((s) => (
                <div key={s.status} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2"><div className="h-2 w-2 rounded-full" style={{ backgroundColor: SC[s.status] ?? "#6b7280" }} /><span>{STATUS_UA[s.status] ?? s.status}</span></div>
                  <span className="tabular-nums font-medium">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Daily chart */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Відправка по днях (14 днів)</div>
          {d.daily.length > 0 ? (
            <div className="space-y-1.5">
              {d.daily.map((day) => (
                <div key={day.date} className="flex items-center gap-3">
                  <div className="w-20 text-xs tabular-nums text-[var(--text-muted)]">{day.date.slice(5)}</div>
                  <div className="flex-1 h-4 rounded-sm overflow-hidden bg-[var(--bg-page)]">
                    <div className="h-full rounded-sm bg-[var(--accent)]" style={{ width: `${Math.min(100, (day.count / Math.max(...d.daily.map((x) => x.count), 1)) * 100)}%`, opacity: 0.8 }} />
                  </div>
                  <div className="w-8 text-right text-xs font-bold tabular-nums">{day.count}</div>
                </div>
              ))}
            </div>
          ) : <div className="text-sm text-[var(--text-muted)]">Немає даних</div>}
        </div>
      </main>
    </div>
  );
}
