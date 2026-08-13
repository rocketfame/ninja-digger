import Link from "next/link";
import { NavBar } from "@/app/components/NavBar";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

const EMPTY_FUNNEL = {
  touches: [] as { template_id: string; total: number; last7d: number }[],
  contacted: 0,
  replied: 0,
  won: 0,
};

async function getStats() {
  try {
    const [bpEmail, bpWork, sentToday, sentYesterday, sentTotal, bounced, touchStats, contacted, replied, won] = await Promise.all([
      pool.query("SELECT COUNT(DISTINCT artist_beatport_id) as c FROM artist_contacts WHERE type='email' AND confidence >= 0.65 AND (status IS NULL OR status != 'bounced')"),
      pool.query("SELECT COUNT(*) as c FROM lead_profiles WHERE status IS NOT NULL AND status != 'New'"),
      pool.query("SELECT COUNT(*) as c FROM outreach_events WHERE sent_at >= CURRENT_DATE").catch(() => ({ rows: [{ c: 0 }] })),
      pool.query("SELECT COUNT(*) as c FROM outreach_events WHERE sent_at >= CURRENT_DATE - 1 AND sent_at < CURRENT_DATE").catch(() => ({ rows: [{ c: 0 }] })),
      pool.query("SELECT COUNT(*) as c FROM outreach_events").catch(() => ({ rows: [{ c: 0 }] })),
      pool.query("SELECT COUNT(*) as c FROM artist_contacts WHERE status = 'bounced'").catch(() => ({ rows: [{ c: 0 }] })),
      pool.query<{ template_id: string; total: string; last7d: string }>(
        `SELECT template_id, COUNT(*)::text AS total,
                COUNT(*) FILTER (WHERE sent_at >= CURRENT_DATE - 7)::text AS last7d
         FROM outreach_events WHERE channel = 'email' AND template_id LIKE 'email_touch_%'
         GROUP BY template_id ORDER BY template_id`
      ).catch(() => ({ rows: [] as { template_id: string; total: string; last7d: string }[] })),
      pool.query("SELECT COUNT(DISTINCT artist_beatport_id) as c FROM outreach_events").catch(() => ({ rows: [{ c: 0 }] })),
      pool.query("SELECT COUNT(*) as c FROM lead_profiles WHERE status IN ('Responded', 'In Progress', 'Won')").catch(() => ({ rows: [{ c: 0 }] })),
      pool.query("SELECT COUNT(*) as c FROM lead_profiles WHERE status = 'Won'").catch(() => ({ rows: [{ c: 0 }] })),
    ]);
    return {
      bp: { email: Number(bpEmail.rows[0]?.c ?? 0), work: Number(bpWork.rows[0]?.c ?? 0) },
      sent: { today: Number(sentToday.rows[0]?.c ?? 0), yesterday: Number(sentYesterday.rows[0]?.c ?? 0), total: Number(sentTotal.rows[0]?.c ?? 0) },
      bounced: Number(bounced.rows[0]?.c ?? 0),
      funnel: {
        touches: touchStats.rows.map((r) => ({ template_id: r.template_id, total: Number(r.total), last7d: Number(r.last7d) })),
        contacted: Number(contacted.rows[0]?.c ?? 0),
        replied: Number(replied.rows[0]?.c ?? 0),
        won: Number(won.rows[0]?.c ?? 0),
      },
    };
  } catch {
    return { bp: { email: 0, work: 0 }, sent: { today: 0, yesterday: 0, total: 0 }, bounced: 0, funnel: EMPTY_FUNNEL };
  }
}

export default async function Home() {
  const s = await getStats();

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold">Ninja Digger — Dashboard</h1>

        {/* Outreach Stats */}
        <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">Outreach</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <div>
              <div className="text-3xl font-bold tabular-nums text-[var(--accent)]">{s.sent.total}</div>
              <div className="text-xs text-[var(--text-muted)]">Всього відправлено</div>
            </div>
            <div>
              <div className="text-3xl font-bold tabular-nums text-green-400">{s.sent.today}</div>
              <div className="text-xs text-[var(--text-muted)]">Сьогодні</div>
            </div>
            <div>
              <div className="text-3xl font-bold tabular-nums">{s.sent.yesterday}</div>
              <div className="text-xs text-[var(--text-muted)]">Вчора</div>
            </div>
            <div>
              <div className="text-3xl font-bold tabular-nums text-red-400">{s.bounced}</div>
              <div className="text-xs text-[var(--text-muted)]">Bounced</div>
            </div>
            <div>
              <div className="text-3xl font-bold tabular-nums">{s.bp.work}</div>
              <div className="text-xs text-[var(--text-muted)]">В роботі (всього)</div>
            </div>
          </div>
        </div>

        {/* Funnel report */}
        <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">Воронка Beatport</h2>
            <Link href="/analytics" className="text-xs text-[var(--text-muted)] hover:text-[var(--accent)]">Аналітика →</Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-4">
            {[1, 2, 3].map((n) => {
              const t = s.funnel.touches.find((x) => x.template_id === `email_touch_${n}`);
              return (
                <div key={n}>
                  <div className="text-2xl font-bold tabular-nums">{t?.total ?? 0}</div>
                  <div className="text-xs text-[var(--text-muted)]">Touch {n} {t?.last7d ? <span className="text-green-400">(+{t.last7d} за 7д)</span> : null}</div>
                </div>
              );
            })}
            <div>
              <div className="text-2xl font-bold tabular-nums text-[#60a5fa]">{s.funnel.contacted}</div>
              <div className="text-xs text-[var(--text-muted)]">Артистів контактовано</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 border-t border-[var(--border)] pt-4">
            <div>
              <div className="text-2xl font-bold tabular-nums text-green-400">{s.funnel.replied}</div>
              <div className="text-xs text-[var(--text-muted)]">Відповіли</div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums text-green-400">
                {s.funnel.contacted > 0 ? `${((s.funnel.replied / s.funnel.contacted) * 100).toFixed(1)}%` : "—"}
              </div>
              <div className="text-xs text-[var(--text-muted)]">Reply rate</div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums text-[var(--accent)]">{s.funnel.won}</div>
              <div className="text-xs text-[var(--text-muted)]">Won</div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums text-red-400">
                {s.funnel.contacted > 0 ? `${((s.bounced / s.funnel.contacted) * 100).toFixed(1)}%` : "—"}
              </div>
              <div className="text-xs text-[var(--text-muted)]">Bounce rate</div>
            </div>
          </div>
        </div>

        {/* Pipeline cards */}
        <div className="grid gap-4">
          {/* Beatport */}
          <Link href="/leads" className="group rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5 transition-colors hover:border-[var(--accent)]/50">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Beatport Leads</h2>
              <span className="text-xs text-[var(--text-muted)] group-hover:text-[var(--accent)]">→</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-2xl font-bold tabular-nums">{s.bp.email}</div>
                <div className="text-xs text-[var(--text-muted)]">З email</div>
              </div>
              <div>
                <div className="text-2xl font-bold tabular-nums text-[#fbbf24]">{s.bp.work}</div>
                <div className="text-xs text-[var(--text-muted)]">В роботі</div>
              </div>
              <div>
                <div className="text-2xl font-bold tabular-nums text-[#60a5fa]">{s.sent.total}</div>
                <div className="text-xs text-[var(--text-muted)]">Листів</div>
              </div>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}
