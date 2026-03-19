import { pool } from "@/lib/db";
import { NavBar } from "@/app/components/NavBar";

export const dynamic = "force-dynamic";

type DayStat = { date: string; count: number };
type StatusRow = { status: string; count: number };

async function getData() {
  const q = (sql: string) => pool.query(sql).catch(() => ({ rows: [{ c: 0 }] }));
  const qs = (sql: string) => pool.query<StatusRow>(sql).catch(() => ({ rows: [] as StatusRow[] }));
  const qd = (sql: string) => pool.query<DayStat>(sql).catch(() => ({ rows: [] as DayStat[] }));

  const [
    bpSent, bpToday, bpYesterday,
    raSent, raToday, raYesterday,
    bpStatuses, raStatuses,
    bpEmail, raEmail, raTotal, raEvents,
    bounced, raCities, dailyBreakdown,
  ] = await Promise.all([
    q("SELECT COUNT(*)::int as c FROM lead_profiles WHERE status IN ('Attempt 1','Attempt 2','Contacted','No Response','Cold','Hot')"),
    q("SELECT COUNT(*)::int as c FROM lead_profiles WHERE status != 'New' AND updated_at::date = CURRENT_DATE"),
    q("SELECT COUNT(*)::int as c FROM lead_profiles WHERE status != 'New' AND updated_at::date = CURRENT_DATE - 1"),
    q("SELECT COUNT(*)::int as c FROM ra_promoter_profiles WHERE status IN ('Attempt 1','Attempt 2','No Response','Cold','Hot')"),
    q("SELECT COUNT(*)::int as c FROM ra_promoter_profiles WHERE status != 'New' AND updated_at::date = CURRENT_DATE"),
    q("SELECT COUNT(*)::int as c FROM ra_promoter_profiles WHERE status != 'New' AND updated_at::date = CURRENT_DATE - 1"),
    qs("SELECT status, COUNT(*)::int as count FROM lead_profiles GROUP BY status ORDER BY count DESC"),
    qs("SELECT status, COUNT(*)::int as count FROM ra_promoter_profiles GROUP BY status ORDER BY count DESC"),
    q("SELECT COUNT(DISTINCT artist_beatport_id)::int as c FROM artist_contacts WHERE type='email' AND confidence>=0.65 AND (status IS NULL OR status!='bounced')"),
    q("SELECT COUNT(DISTINCT promoter_id)::int as c FROM ra_promoter_contacts WHERE type='email' AND status!='bounced'"),
    q("SELECT COUNT(*)::int as c FROM ra_promoters"),
    q("SELECT COUNT(*)::int as c FROM ra_events WHERE event_date >= CURRENT_DATE"),
    q("SELECT COUNT(*)::int as c FROM artist_contacts WHERE status='bounced'"),
    pool.query("SELECT city, COUNT(*)::int as c FROM ra_promoters WHERE city!='' GROUP BY city ORDER BY c DESC LIMIT 10").catch(() => ({ rows: [] })),
    qd(`SELECT date, SUM(cnt)::int as count FROM (
      SELECT updated_at::date::text as date, COUNT(*) as cnt FROM lead_profiles WHERE status!='New' AND updated_at>=CURRENT_DATE-14 GROUP BY 1
      UNION ALL SELECT updated_at::date::text as date, COUNT(*) as cnt FROM ra_promoter_profiles WHERE status!='New' AND updated_at>=CURRENT_DATE-14 GROUP BY 1
    ) t GROUP BY date ORDER BY date DESC`),
  ]);

  return {
    bp: { sent: Number(bpSent.rows[0]?.c??0), today: Number(bpToday.rows[0]?.c??0), yesterday: Number(bpYesterday.rows[0]?.c??0), email: Number(bpEmail.rows[0]?.c??0), statuses: bpStatuses.rows },
    ra: { sent: Number(raSent.rows[0]?.c??0), today: Number(raToday.rows[0]?.c??0), yesterday: Number(raYesterday.rows[0]?.c??0), email: Number(raEmail.rows[0]?.c??0), total: Number(raTotal.rows[0]?.c??0), events: Number(raEvents.rows[0]?.c??0), statuses: raStatuses.rows, cities: raCities.rows as {city:string;c:number}[] },
    bounced: Number(bounced.rows[0]?.c??0),
    daily: dailyBreakdown.rows,
  };
}

const SC: Record<string,string> = { "New":"#6b7280","Attempt 1":"#60a5fa","Attempt 2":"#c084fc","No Response":"#fbbf24","Cold":"#9ca3af","Hot":"#4ade80","Contacted":"#60a5fa","Bounced":"#f87171" };

export default async function AnalyticsPage() {
  const d = await getData();
  const totalSent = d.bp.sent + d.ra.sent;
  const totalToday = d.bp.today + d.ra.today;
  const totalYesterday = d.bp.yesterday + d.ra.yesterday;

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-6 text-xl font-semibold">Аналітика</h1>

        {/* Summary row */}
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-xs text-[var(--text-muted)] mb-1">Всього відправлено</div>
            <div className="text-3xl font-bold tabular-nums text-[var(--accent)]">{totalSent}</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-xs text-[var(--text-muted)] mb-1">Сьогодні</div>
            <div className="text-3xl font-bold tabular-nums text-green-400">{totalToday}</div>
            <div className="text-[10px] text-[var(--text-muted)]">BP: {d.bp.today} · RA: {d.ra.today}</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-xs text-[var(--text-muted)] mb-1">Вчора</div>
            <div className="text-3xl font-bold tabular-nums">{totalYesterday}</div>
            <div className="text-[10px] text-[var(--text-muted)]">BP: {d.bp.yesterday} · RA: {d.ra.yesterday}</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-xs text-[var(--text-muted)] mb-1">Bounced</div>
            <div className="text-3xl font-bold tabular-nums text-red-400">{d.bounced}</div>
          </div>
        </div>

        {/* Beatport + RA side by side */}
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          {/* Beatport detail */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Beatport</div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div><div className="text-xl font-bold tabular-nums">{d.bp.sent}</div><div className="text-[10px] text-[var(--text-muted)]">Відправлено</div></div>
              <div><div className="text-xl font-bold tabular-nums text-green-400">{d.bp.today}</div><div className="text-[10px] text-[var(--text-muted)]">Сьогодні</div></div>
              <div><div className="text-xl font-bold tabular-nums text-[#60a5fa]">{d.bp.email}</div><div className="text-[10px] text-[var(--text-muted)]">З email</div></div>
            </div>
            <div className="space-y-1">
              {d.bp.statuses.map(s=>(
                <div key={s.status} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2"><div className="h-2 w-2 rounded-full" style={{backgroundColor:SC[s.status]??'#6b7280'}}/><span>{s.status}</span></div>
                  <span className="tabular-nums font-medium">{s.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* RA detail */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">RA Leads</div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div><div className="text-xl font-bold tabular-nums">{d.ra.sent}</div><div className="text-[10px] text-[var(--text-muted)]">Відправлено</div></div>
              <div><div className="text-xl font-bold tabular-nums text-green-400">{d.ra.today}</div><div className="text-[10px] text-[var(--text-muted)]">Сьогодні</div></div>
              <div><div className="text-xl font-bold tabular-nums text-[#60a5fa]">{d.ra.email}</div><div className="text-[10px] text-[var(--text-muted)]">З email</div></div>
            </div>
            <div className="space-y-1 mb-3">
              {d.ra.statuses.map(s=>(
                <div key={s.status} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2"><div className="h-2 w-2 rounded-full" style={{backgroundColor:SC[s.status]??'#6b7280'}}/><span>{s.status}</span></div>
                  <span className="tabular-nums font-medium">{s.count}</span>
                </div>
              ))}
            </div>
            {d.ra.cities.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase text-[var(--text-muted)] mb-1">Топ міст</div>
                {d.ra.cities.map(c=>(<div key={c.city} className="flex justify-between text-xs"><span>{c.city}</span><span className="tabular-nums text-[var(--text-muted)]">{c.c}</span></div>))}
              </div>
            )}
          </div>
        </div>

        {/* Daily chart */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Відправка по днях</div>
          {d.daily.length > 0 ? (
            <div className="space-y-1.5">
              {d.daily.map(day=>(
                <div key={day.date} className="flex items-center gap-3">
                  <div className="w-20 text-xs tabular-nums text-[var(--text-muted)]">{day.date.slice(5)}</div>
                  <div className="flex-1 h-4 rounded-sm overflow-hidden bg-[var(--bg-page)]">
                    <div className="h-full rounded-sm bg-[var(--accent)]" style={{width:`${Math.min(100,(day.count/Math.max(...d.daily.map(x=>x.count),1))*100)}%`,opacity:0.8}}/>
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
