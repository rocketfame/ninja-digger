import { pool } from "@/lib/db";
import { NavBar } from "@/app/components/NavBar";
import { STATUS_UA } from "@/lib/statusLabels";
import { Send, MailOpen, Trophy, TriangleAlert, Reply, Gem } from "lucide-react";
import { SiSoundcloud, SiBeatport, SiSpotify } from "react-icons/si";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

type StatusRow = { status: string; count: number };
type DayStat = { date: string; count: number };
type TouchRow = { template_id: string; total: number; last7d: number };

async function getData() {
  const q = (sql: string) => pool.query<{ c: number }>(sql).then((r) => Number(r.rows[0]?.c ?? 0)).catch(() => 0);
  const rows = <T,>(sql: string): Promise<T[]> => pool.query(sql).then((r) => r.rows as T[]).catch(() => [] as T[]);

  const [
    bpToday, bpTotal, bpEmail, bpBounced, bpReplied, bpWon, bpStatuses, bpTouches, bpDaily,
    scSentTotal, scSentToday, scDelivered, scOpened, scGold, scReplied, scBounced, scTouches,
    spSentTotal, spSentToday, spDelivered, spOpened, spGold, spDiamond, spReplied, spBounced, spTouches,
  ] = await Promise.all([
    q("SELECT COUNT(*)::int c FROM outreach_events WHERE template_id LIKE 'email_touch_%' AND sent_at >= CURRENT_DATE"),
    q("SELECT COUNT(*)::int c FROM outreach_events WHERE template_id LIKE 'email_touch_%'"),
    q("SELECT COUNT(DISTINCT artist_beatport_id)::int c FROM artist_contacts WHERE type='email' AND (status IS NULL OR status='ok')"),
    q("SELECT COUNT(*)::int c FROM artist_contacts WHERE status='bounced'"),
    q("SELECT COUNT(*)::int c FROM lead_profiles WHERE status IN ('Responded','In Progress','Won')"),
    q("SELECT COUNT(*)::int c FROM lead_profiles WHERE status='Won'"),
    rows<StatusRow>("SELECT status, COUNT(*)::int count FROM lead_profiles GROUP BY status ORDER BY count DESC"),
    rows<TouchRow>(`SELECT template_id, COUNT(*)::int total, COUNT(*) FILTER (WHERE sent_at >= CURRENT_DATE-7)::int last7d FROM outreach_events WHERE template_id LIKE 'email_touch_%' GROUP BY 1 ORDER BY 1`),
    rows<DayStat>("SELECT sent_at::date::text date, COUNT(*)::int count FROM outreach_events WHERE template_id LIKE 'email_touch_%' AND sent_at >= CURRENT_DATE-14 GROUP BY 1 ORDER BY 1 DESC"),
    q("SELECT COUNT(*)::int c FROM outreach_events WHERE template_id LIKE 'sc_touch_%'"),
    q("SELECT COUNT(*)::int c FROM outreach_events WHERE template_id LIKE 'sc_touch_%' AND sent_at >= CURRENT_DATE"),
    q("SELECT COUNT(*)::int c FROM sc_artists WHERE delivered_at IS NOT NULL"),
    q("SELECT COUNT(*)::int c FROM sc_artists WHERE opens > 0"),
    q("SELECT COUNT(*)::int c FROM sc_artists WHERE track_count>=1 AND email IS NOT NULL AND COALESCE(email_status,'') NOT IN ('bounced','unsub') AND (opens>0 OR lead_status='Responded' OR delivered_at IS NOT NULL)"),
    q("SELECT COUNT(*)::int c FROM sc_artists WHERE lead_status='Responded'"),
    q("SELECT COUNT(*)::int c FROM sc_artists WHERE lead_status='Bounced'"),
    rows<TouchRow>(`SELECT template_id, COUNT(*)::int total, COUNT(*) FILTER (WHERE sent_at >= CURRENT_DATE-7)::int last7d FROM outreach_events WHERE template_id LIKE 'sc_touch_%' GROUP BY 1 ORDER BY 1`),
    q("SELECT COUNT(*)::int c FROM outreach_events WHERE template_id LIKE 'sp_touch_%'"),
    q("SELECT COUNT(*)::int c FROM outreach_events WHERE template_id LIKE 'sp_touch_%' AND sent_at >= CURRENT_DATE"),
    q("SELECT COUNT(*)::int c FROM spotify_leads WHERE delivered_at IS NOT NULL"),
    q("SELECT COUNT(*)::int c FROM spotify_leads WHERE opens > 0"),
    q("SELECT COUNT(*)::int c FROM spotify_leads WHERE email IS NOT NULL AND COALESCE(email_status,'') NOT IN ('bounced','unsub') AND (opens>0 OR lead_status='Responded' OR delivered_at IS NOT NULL)"),
    q("SELECT COUNT(*)::int c FROM spotify_leads WHERE email IS NOT NULL AND COALESCE(email_status,'') NOT IN ('bounced','unsub') AND (opens>0 OR clicks>0 OR lead_status='Responded')"),
    q("SELECT COUNT(*)::int c FROM spotify_leads WHERE lead_status='Responded'"),
    q("SELECT COUNT(*)::int c FROM spotify_leads WHERE lead_status='Bounced'"),
    rows<TouchRow>(`SELECT template_id, COUNT(*)::int total, COUNT(*) FILTER (WHERE sent_at >= CURRENT_DATE-7)::int last7d FROM outreach_events WHERE template_id LIKE 'sp_touch_%' GROUP BY 1 ORDER BY 1`),
  ]);

  return {
    bp: { today: bpToday, total: bpTotal, email: bpEmail, bounced: bpBounced, replied: bpReplied, won: bpWon, statuses: bpStatuses, touches: bpTouches, daily: bpDaily },
    sc: { sentTotal: scSentTotal, sentToday: scSentToday, delivered: scDelivered, opened: scOpened, gold: scGold, replied: scReplied, bounced: scBounced, touches: scTouches },
    sp: { sentTotal: spSentTotal, sentToday: spSentToday, delivered: spDelivered, opened: spOpened, gold: spGold, diamond: spDiamond, replied: spReplied, bounced: spBounced, touches: spTouches },
  };
}

const STATUS_COLOR: Record<string, string> = { "New": "#6b7280", "Attempt 1": "#60a5fa", "Attempt 2": "#c084fc", "No Response": "#fbbf24", "Cold": "#9ca3af", "Contacted": "#60a5fa", "Responded": "#4ade80", "In Progress": "#34d399", "Won": "#22c55e", "Bounced": "#f87171", "Not Interested": "#f87171", "Blacklist": "#ef4444" };

function Stat({ icon, label, value, color }: { icon: ReactNode; label: string; value: number; color?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className="mb-1 flex items-center gap-1.5 text-[var(--text-muted)]">{icon}<span className="text-xs">{label}</span></div>
      <div className="text-2xl font-bold tabular-nums" style={color ? { color } : undefined}>{value.toLocaleString("uk-UA")}</div>
    </div>
  );
}

export default async function AnalyticsPage() {
  const d = await getData();
  const openRate = d.sc.delivered > 0 ? Math.round((d.sc.opened / d.sc.delivered) * 100) : 0;
  const spOpenRate = d.sp.delivered > 0 ? Math.round((d.sp.opened / d.sp.delivered) * 100) : 0;

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />
      <main className="mx-auto max-w-5xl px-5 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">Аналітика</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Розсилка й конверсії по каналах.</p>
        </div>

        {/* Spotify */}
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <SiSpotify className="h-5 w-5" style={{ color: "#1db954" }} />
            <h2 className="text-lg font-semibold">Spotify</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat icon={<Send className="h-3.5 w-3.5" />} label="Надіслано" value={d.sp.sentTotal} color="#1db954" />
            <Stat icon={<Send className="h-3.5 w-3.5" />} label="Сьогодні" value={d.sp.sentToday} />
            <Stat icon={<MailOpen className="h-3.5 w-3.5" />} label="Відкрили" value={d.sp.opened} color="#60a5fa" />
            <Stat icon={<Reply className="h-3.5 w-3.5" />} label="Відповіли" value={d.sp.replied} color="#4ade80" />
            <Stat icon={<Trophy className="h-3.5 w-3.5" />} label="Золото" value={d.sp.gold} color="#fbbf24" />
            <Stat icon={<Gem className="h-3.5 w-3.5" />} label="Діаманти" value={d.sp.diamond} color="#38bdf8" />
          </div>
          <div className="mt-2 text-xs text-[var(--text-muted)]">Open-rate: <span className="font-semibold text-[var(--text)]">{spOpenRate}%</span> (відкрили {d.sp.opened} з {d.sp.delivered} доставлених) · дотики: {d.sp.touches.map((t) => `${t.template_id.slice(-1)}:${t.total}`).join(" · ") || "—"}</div>
        </section>

        {/* SoundCloud */}
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <SiSoundcloud className="h-5 w-5" style={{ color: "#ff5500" }} />
            <h2 className="text-lg font-semibold">SoundCloud</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat icon={<Send className="h-3.5 w-3.5" />} label="Надіслано" value={d.sc.sentTotal} color="var(--accent)" />
            <Stat icon={<Send className="h-3.5 w-3.5" />} label="Сьогодні" value={d.sc.sentToday} />
            <Stat icon={<MailOpen className="h-3.5 w-3.5" />} label="Відкрили" value={d.sc.opened} color="#60a5fa" />
            <Stat icon={<Reply className="h-3.5 w-3.5" />} label="Відповіли" value={d.sc.replied} color="#4ade80" />
            <Stat icon={<Trophy className="h-3.5 w-3.5" />} label="Золото" value={d.sc.gold} color="#fbbf24" />
            <Stat icon={<TriangleAlert className="h-3.5 w-3.5" />} label="Bounce" value={d.sc.bounced} color="#f87171" />
          </div>
          <div className="mt-2 text-xs text-[var(--text-muted)]">Open-rate: <span className="font-semibold text-[var(--text)]">{openRate}%</span> (відкрили {d.sc.opened} з {d.sc.delivered} доставлених) · дотики: {d.sc.touches.map((t) => `${t.template_id.slice(-1)}:${t.total}`).join(" · ") || "—"}</div>
        </section>

        {/* Beatport */}
        <section>
          <div className="mb-3 flex items-center gap-2">
            <SiBeatport className="h-5 w-5" style={{ color: "#a3ff12" }} />
            <h2 className="text-lg font-semibold">Beatport</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat icon={<Send className="h-3.5 w-3.5" />} label="Надіслано" value={d.bp.total} color="var(--accent)" />
            <Stat icon={<Send className="h-3.5 w-3.5" />} label="Сьогодні" value={d.bp.today} />
            <Stat icon={<MailOpen className="h-3.5 w-3.5" />} label="З email" value={d.bp.email} color="#60a5fa" />
            <Stat icon={<Reply className="h-3.5 w-3.5" />} label="Відповіли" value={d.bp.replied} color="#4ade80" />
            <Stat icon={<Trophy className="h-3.5 w-3.5" />} label="Won" value={d.bp.won} color="#22c55e" />
            <Stat icon={<TriangleAlert className="h-3.5 w-3.5" />} label="Bounce" value={d.bp.bounced} color="#f87171" />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Дотики</div>
              <div className="space-y-2">
                {[1, 2, 3].map((n) => {
                  const t = d.bp.touches.find((x) => x.template_id === `email_touch_${n}`);
                  return (
                    <div key={n} className="flex items-center justify-between text-sm">
                      <span>Дотик {n}</span>
                      <span className="tabular-nums font-medium">{t?.total ?? 0} <span className="text-xs text-[var(--text-muted)]">(+{t?.last7d ?? 0} за 7д)</span></span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Статуси лідів</div>
              <div className="space-y-1">
                {d.bp.statuses.map((s) => (
                  <div key={s.status} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLOR[s.status] ?? "#6b7280" }} /><span>{STATUS_UA[s.status] ?? s.status}</span></div>
                    <span className="tabular-nums font-medium">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Відправка по днях (14 днів)</div>
            {d.bp.daily.length > 0 ? (
              <div className="space-y-1.5">
                {d.bp.daily.map((day) => (
                  <div key={day.date} className="flex items-center gap-3">
                    <div className="w-16 text-xs tabular-nums text-[var(--text-muted)]">{day.date.slice(5)}</div>
                    <div className="h-4 flex-1 overflow-hidden rounded-sm bg-[var(--bg-page)]">
                      <div className="h-full rounded-sm bg-[var(--accent)]" style={{ width: `${Math.min(100, (day.count / Math.max(...d.bp.daily.map((x) => x.count), 1)) * 100)}%`, opacity: 0.85 }} />
                    </div>
                    <div className="w-8 text-right text-xs font-bold tabular-nums">{day.count}</div>
                  </div>
                ))}
              </div>
            ) : <div className="text-sm text-[var(--text-muted)]">Немає даних</div>}
          </div>
        </section>
      </main>
    </div>
  );
}
