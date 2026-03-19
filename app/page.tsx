import Link from "next/link";
import { NavBar } from "@/app/components/NavBar";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getStats() {
  try {
    const [bpEmail, bpWork, raTotal, raEmail, raWork, sentToday, sentYesterday, sentTotal, bounced] = await Promise.all([
      pool.query("SELECT COUNT(DISTINCT artist_beatport_id) as c FROM artist_contacts WHERE type='email' AND confidence >= 0.65 AND (status IS NULL OR status != 'bounced')"),
      pool.query("SELECT COUNT(*) as c FROM lead_profiles WHERE status IS NOT NULL AND status != 'New'"),
      pool.query("SELECT COUNT(*) as c FROM ra_promoters").catch(() => ({ rows: [{ c: 0 }] })),
      pool.query("SELECT COUNT(DISTINCT promoter_id) as c FROM ra_promoter_contacts WHERE type='email' AND status != 'bounced'").catch(() => ({ rows: [{ c: 0 }] })),
      pool.query("SELECT COUNT(*) as c FROM ra_promoter_profiles WHERE status IS NOT NULL AND status != 'New'").catch(() => ({ rows: [{ c: 0 }] })),
      pool.query("SELECT COUNT(*) as c FROM outreach_events WHERE sent_at >= CURRENT_DATE"),
      pool.query("SELECT COUNT(*) as c FROM outreach_events WHERE sent_at >= CURRENT_DATE - 1 AND sent_at < CURRENT_DATE"),
      pool.query("SELECT COUNT(*) as c FROM outreach_events"),
      pool.query("SELECT COUNT(*) as c FROM artist_contacts WHERE status = 'bounced'"),
    ]);
    return {
      bp: { email: Number(bpEmail.rows[0]?.c ?? 0), work: Number(bpWork.rows[0]?.c ?? 0) },
      ra: { total: Number(raTotal.rows[0]?.c ?? 0), email: Number(raEmail.rows[0]?.c ?? 0), work: Number(raWork.rows[0]?.c ?? 0) },
      sent: { today: Number(sentToday.rows[0]?.c ?? 0), yesterday: Number(sentYesterday.rows[0]?.c ?? 0), total: Number(sentTotal.rows[0]?.c ?? 0) },
      bounced: Number(bounced.rows[0]?.c ?? 0),
    };
  } catch {
    return { bp: { email: 0, work: 0 }, ra: { total: 0, email: 0, work: 0 }, sent: { today: 0, yesterday: 0, total: 0 }, bounced: 0 };
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
              <div className="text-3xl font-bold tabular-nums">{s.bp.work + s.ra.work}</div>
              <div className="text-xs text-[var(--text-muted)]">В роботі (всього)</div>
            </div>
          </div>
        </div>

        {/* Pipeline cards */}
        <div className="grid gap-4 sm:grid-cols-2">
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

          {/* RA */}
          <Link href="/ra-leads" className="group rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5 transition-colors hover:border-[var(--accent)]/50">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">RA Leads</h2>
              <span className="text-xs text-[var(--text-muted)] group-hover:text-[var(--accent)]">→</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-2xl font-bold tabular-nums">{s.ra.total.toLocaleString()}</div>
                <div className="text-xs text-[var(--text-muted)]">Промо-груп</div>
              </div>
              <div>
                <div className="text-2xl font-bold tabular-nums text-[#60a5fa]">{s.ra.email}</div>
                <div className="text-xs text-[var(--text-muted)]">З email</div>
              </div>
              <div>
                <div className="text-2xl font-bold tabular-nums text-[#fbbf24]">{s.ra.work}</div>
                <div className="text-xs text-[var(--text-muted)]">В роботі</div>
              </div>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}
