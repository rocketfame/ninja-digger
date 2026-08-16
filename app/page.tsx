import Link from "next/link";
import { NavBar } from "@/app/components/NavBar";
import { pool } from "@/lib/db";
import { getSegmentStats } from "@/lib/emailSegments";
import { STATUS_UA } from "@/lib/statusLabels";
import { WarmDialogCard } from "@/app/components/WarmDialogCard";

export const dynamic = "force-dynamic";

const EMPTY_FUNNEL = {
  touches: [] as { template_id: string; total: number; last7d: number }[],
  contacted: 0,
  replied: 0,
  won: 0,
};

type StatusRow = { status: string; count: number };
type DayRow = { date: string; sent: number; replied: number };

const STATUS_COLORS: Record<string, string> = {
  "New": "#6b7280",
  "Attempt 1": "#60a5fa",
  "Attempt 2": "#c084fc",
  "No Response": "#fbbf24",
  "Cold": "#64748b",
  "Contacted": "#38bdf8",
  "Responded": "#4ade80",
  "In Progress": "#34d399",
  "Won": "#22c55e",
  "Not Interested": "#f87171",
  "Blacklist": "#ef4444",
};

/** SVG donut chart segments from status counts. */
function Donut({ data }: { data: StatusRow[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) return <div className="text-sm text-[var(--text-muted)]">Немає даних</div>;
  const R = 15.915; // circumference = 100
  let offset = 25; // start at 12 o'clock
  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 42 42" className="h-36 w-36 shrink-0">
        <circle cx="21" cy="21" r={R} fill="none" stroke="var(--bg-page)" strokeWidth="6" />
        {data.map((d) => {
          const pct = (d.count / total) * 100;
          const el = (
            <circle
              key={d.status}
              cx="21" cy="21" r={R} fill="none"
              stroke={STATUS_COLORS[d.status] ?? "#6b7280"}
              strokeWidth="6"
              strokeDasharray={`${pct} ${100 - pct}`}
              strokeDashoffset={offset}
            />
          );
          offset -= pct;
          return el;
        })}
        <text x="21" y="20" textAnchor="middle" className="fill-[var(--text)]" style={{ font: "bold 7px sans-serif" }}>{total}</text>
        <text x="21" y="27" textAnchor="middle" className="fill-[var(--text-muted)]" style={{ font: "3.2px sans-serif" }}>лідів у роботі</text>
      </svg>
      <div className="space-y-1">
        {data.map((d) => (
          <div key={d.status} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: STATUS_COLORS[d.status] ?? "#6b7280" }} />
            <span className="text-[var(--text-muted)]">{STATUS_UA[d.status] ?? d.status}</span>
            <span className="tabular-nums font-semibold">{d.count}</span>
            <span className="text-[10px] text-[var(--text-muted)]">({((d.count / total) * 100).toFixed(0)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Horizontal funnel: bar widths proportional to stage size + step conversion. */
function Funnel({ stages }: { stages: { label: string; value: number; color: string }[] }) {
  const max = Math.max(...stages.map((s) => s.value), 1);
  return (
    <div className="space-y-2.5">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const conv = prev && prev > 0 ? ((s.value / prev) * 100).toFixed(0) : null;
        return (
          <div key={s.label} className="flex items-center gap-3">
            <div className="w-24 text-xs text-[var(--text-muted)]">{s.label}</div>
            <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-[var(--bg-page)]">
              <div
                className="flex h-full items-center rounded-md px-2 text-xs font-bold tabular-nums text-black/80"
                style={{ width: `${Math.max((s.value / max) * 100, s.value > 0 ? 8 : 0)}%`, backgroundColor: s.color, minWidth: s.value > 0 ? "2.5rem" : 0 }}
              >
                {s.value}
              </div>
            </div>
            <div className="w-12 text-right text-[10px] tabular-nums text-[var(--text-muted)]">{conv ? `${conv}%` : ""}</div>
          </div>
        );
      })}
    </div>
  );
}

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
    const statusRows = await pool.query<{ status: string; count: string }>(
      "SELECT status, COUNT(*)::text as count FROM lead_profiles WHERE status IS NOT NULL GROUP BY status ORDER BY count DESC"
    ).catch(() => ({ rows: [] as { status: string; count: string }[] }));
    const dailyRows = await pool.query<{ date: string; sent: string; replied: string }>(
      `SELECT d.date::text AS date,
              COALESCE(SUM(CASE WHEN oe.template_id LIKE 'email_touch_%' THEN 1 ELSE 0 END), 0)::text AS sent,
              COALESCE(SUM(CASE WHEN oe.outcome = 'replied' THEN 1 ELSE 0 END), 0)::text AS replied
       FROM (SELECT generate_series(CURRENT_DATE - 13, CURRENT_DATE, '1 day'::interval)::date AS date) d
       LEFT JOIN outreach_events oe ON oe.sent_at::date = d.date AND oe.channel = 'email'
       GROUP BY d.date ORDER BY d.date`
    ).catch(() => ({ rows: [] as { date: string; sent: string; replied: string }[] }));
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
      statuses: statusRows.rows.map((r) => ({ status: r.status, count: Number(r.count) })) as StatusRow[],
      daily: dailyRows.rows.map((r) => ({ date: r.date, sent: Number(r.sent), replied: Number(r.replied) })) as DayRow[],
    };
  } catch {
    return { bp: { email: 0, work: 0 }, sent: { today: 0, yesterday: 0, total: 0 }, bounced: 0, funnel: EMPTY_FUNNEL, statuses: [] as StatusRow[], daily: [] as DayRow[] };
  }
}

const SEGMENT_STYLE: Record<string, { color: string; icon: string; hint: string }> = {
  no_reply: { color: "#60a5fa", icon: "📨", hint: "для повторних розсилок" },
  warm: { color: "#4ade80", icon: "🔥", hint: "відповідали — працюємо" },
  dead: { color: "#f87171", icon: "🚫", hint: "suppression-лист" },
};

async function getBaseStats() {
  const q = (sql: string) => pool.query(sql).then((r) => Number(r.rows[0]?.c ?? 0)).catch(() => 0);
  const VALID_EMAIL = `ac.type='email' AND (ac.status IS NULL OR ac.status='ok')
    AND LOWER(TRIM(ac.value)) NOT IN (SELECT LOWER(email) FROM email_blacklist)`;
  const [totalArtists, activeArtists, withContact, withEmail, gems, roleBooking, rolePersonal, roleMgmt, notContacted, blacklisted, deadContacts, sentEvents, bouncedMailed] = await Promise.all([
    q("SELECT COUNT(*)::int c FROM lead_scores"),
    q("SELECT COUNT(*)::int c FROM artist_metrics WHERE last_seen >= current_date - 14"),
    q("SELECT COUNT(DISTINCT artist_beatport_id)::int c FROM artist_contacts"),
    q(`SELECT COUNT(DISTINCT ac.artist_beatport_id)::int c FROM artist_contacts ac WHERE ${VALID_EMAIL}`),
    q(`SELECT COUNT(DISTINCT ac.artist_beatport_id)::int c FROM artist_contacts ac
       JOIN artist_metrics am ON am.artist_beatport_id = ac.artist_beatport_id
       WHERE ${VALID_EMAIL} AND am.best_position <= 30 AND am.total_days_in_charts >= 3 AND am.last_seen >= current_date - 30`),
    q(`SELECT COUNT(DISTINCT ac.artist_beatport_id)::int c FROM artist_contacts ac WHERE ${VALID_EMAIL} AND ac.email_type='booking'`),
    q(`SELECT COUNT(DISTINCT ac.artist_beatport_id)::int c FROM artist_contacts ac WHERE ${VALID_EMAIL} AND ac.email_type='personal'`),
    q(`SELECT COUNT(DISTINCT ac.artist_beatport_id)::int c FROM artist_contacts ac WHERE ${VALID_EMAIL} AND ac.email_type='management'`),
    q(`SELECT COUNT(DISTINCT ac.artist_beatport_id)::int c FROM artist_contacts ac
       LEFT JOIN lead_profiles lp ON lp.artist_beatport_id = ac.artist_beatport_id
       WHERE ${VALID_EMAIL} AND (lp.status IS NULL OR lp.status='New')`),
    q("SELECT COUNT(*)::int c FROM email_blacklist"),
    q("SELECT COUNT(*)::int c FROM artist_contacts WHERE type='email' AND status IN ('bounced','blocked')"),
    q("SELECT COUNT(*)::int c FROM outreach_events WHERE channel='email' AND template_id LIKE 'email_touch_%'"),
    q(`SELECT COUNT(DISTINCT ac.value)::int c FROM artist_contacts ac
       WHERE ac.type='email' AND ac.status='bounced'
         AND EXISTS (SELECT 1 FROM outreach_events oe WHERE LOWER(oe.contact_value) = LOWER(TRIM(ac.value)))`),
  ]);
  return { totalArtists, activeArtists, withContact, withEmail, gems, roleBooking, rolePersonal, roleMgmt, notContacted, blacklisted, deadContacts, sentEvents, bouncedMailed };
}

export default async function Home() {
  const s = await getStats();
  const emailSegments = await getSegmentStats().catch(() => []);
  const base = await getBaseStats();
  const honestBounceRate = base.sentEvents > 0 ? ((base.bouncedMailed / base.sentEvents) * 100).toFixed(1) : null;

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
              <div className="text-xs text-[var(--text-muted)]">Сьогодні · {new Date().toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", timeZone: "UTC" })}</div>
            </div>
            <div>
              <div className="text-3xl font-bold tabular-nums">{s.sent.yesterday}</div>
              <div className="text-xs text-[var(--text-muted)]">Вчора · {new Date(Date.now() - 86400e3).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", timeZone: "UTC" })}</div>
            </div>
            <div>
              <div className="text-3xl font-bold tabular-nums text-red-400">{s.bounced}</div>
              <div className="text-xs text-[var(--text-muted)]">Вибракувано адрес</div>
              <div className="text-[9px] text-[var(--text-muted)]">bounce + гігієна (мертві домени)</div>
            </div>
            <div>
              <div className="text-3xl font-bold tabular-nums">{s.bp.work}</div>
              <div className="text-xs text-[var(--text-muted)]">В роботі (всього)</div>
            </div>
          </div>
        </div>

        {/* База лідів — головні числа простою мовою */}
        <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">База лідів — хто в нас є</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <div>
              <div className="text-2xl font-bold tabular-nums">{base.totalArtists.toLocaleString("uk-UA")}</div>
              <div className="text-xs text-[var(--text-muted)]">артистів у базі всього</div>
              <div className="text-[10px] text-[var(--text-muted)]">з них зараз у чартах: {base.activeArtists.toLocaleString("uk-UA")}</div>
            </div>
            <div>
              <a href="/api/segments/email/export?type=all_email" download className="group inline-flex items-center gap-1.5">
                <span className="text-2xl font-bold tabular-nums text-[#60a5fa]">{base.withEmail}</span>
                <span className="text-xs text-[var(--text-muted)] group-hover:text-[#60a5fa]">⬇ CSV</span>
              </a>
              <div className="text-xs text-[var(--text-muted)]">з робочим email</div>
              <div className="text-[10px] text-[var(--text-muted)]">
                ще не контактовані: <a href="/api/segments/email/export?type=not_contacted" download className="underline decoration-dotted hover:text-[var(--text)]">{base.notContacted} ⬇</a>
              </div>
            </div>
            <div>
              <a href="/api/segments/email/export?type=gems" download className="group inline-flex items-center gap-1.5">
                <span className="text-2xl font-bold tabular-nums text-amber-400">💎 {base.gems}</span>
                <span className="text-xs text-[var(--text-muted)] group-hover:text-amber-400">⬇ CSV</span>
              </a>
              <div className="text-xs text-[var(--text-muted)]">цінні (топ-30 чарту, активні)</div>
              <div className="text-[10px] text-[var(--text-muted)]">
                <a href="/api/segments/email/export?type=all_email&role=personal" download className="underline decoration-dotted hover:text-[var(--text)]">👤 {base.rolePersonal}</a>
                {" · "}
                <a href="/api/segments/email/export?type=all_email&role=booking" download className="underline decoration-dotted hover:text-[var(--text)]">📅 {base.roleBooking}</a>
                {" · "}
                <a href="/api/segments/email/export?type=all_email&role=management" download className="underline decoration-dotted hover:text-[var(--text)]">💼 {base.roleMgmt}</a>
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums text-red-400">{base.deadContacts + base.blacklisted}</div>
              <div className="text-xs text-[var(--text-muted)]">мертві адреси + чорний список</div>
              <div className="text-[10px] text-[var(--text-muted)]">биті: {base.deadContacts} · blacklist: {base.blacklisted}</div>
            </div>
          </div>
        </div>

        {/* Email segments — compact strip */}
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {emailSegments.map((seg) => {
            const st = SEGMENT_STYLE[seg.type];
            if (seg.type === "warm") {
              return <WarmDialogCard key={seg.type} count={seg.count} lastUpdated={seg.lastUpdated} />;
            }
            return (
              <div key={seg.type} className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
                <div>
                  <div className="text-xs text-[var(--text-muted)]">{st.icon} {seg.label}</div>
                  <div className="text-2xl font-bold tabular-nums leading-tight" style={{ color: st.color }}>
                    {seg.count}
                    {seg.gems != null && <span className="ml-2 text-sm font-semibold text-amber-400">💎 {seg.gems}</span>}
                  </div>
                  {seg.lastUpdated && <div className="text-[9px] text-[var(--text-muted)]">оновлено {seg.lastUpdated.slice(5, 16).replace("T", " ")}</div>}
                </div>
                <a
                  href={`/api/segments/email/export?type=${seg.type}`}
                  title="Завантажити CSV"
                  download
                  className="rounded-md border border-[var(--border)] p-2 text-[var(--text-muted)] transition-colors hover:border-[var(--accent)]/60 hover:text-[var(--text)]"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4" />
                  </svg>
                </a>
              </div>
            );
          })}
        </div>

        {/* Funnel + status donut */}
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">Воронка Beatport</h2>
              <Link href="/analytics" className="text-xs text-[var(--text-muted)] hover:text-[var(--accent)]">Аналітика →</Link>
            </div>
            <Funnel
              stages={[
                { label: "Контактовано", value: s.funnel.contacted, color: "#60a5fa" },
                { label: "Touch 1", value: s.funnel.touches.find((x) => x.template_id === "email_touch_1")?.total ?? 0, color: "#38bdf8" },
                { label: "Touch 2", value: s.funnel.touches.find((x) => x.template_id === "email_touch_2")?.total ?? 0, color: "#c084fc" },
                { label: "Touch 3", value: s.funnel.touches.find((x) => x.template_id === "email_touch_3")?.total ?? 0, color: "#fbbf24" },
                { label: "Відповіли", value: s.funnel.replied, color: "#4ade80" },
                { label: "Won", value: s.funnel.won, color: "#22c55e" },
              ]}
            />
            <div className="mt-4 flex gap-6 border-t border-[var(--border)] pt-3 text-xs text-[var(--text-muted)]">
              <span>Reply rate: <b className="text-green-400">{s.funnel.contacted > 0 ? `${((s.funnel.replied / s.funnel.contacted) * 100).toFixed(1)}%` : "—"}</b></span>
              <span>Bounce rate: <b className="text-red-400">{honestBounceRate ?? "—"}%</b> <span className="text-[10px]">(відбиті з реально надісланих)</span></span>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">Статуси лідів у роботі</h2>
            <Donut data={s.statuses} />
          </div>
        </div>

        {/* Daily activity */}
        <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">Активність за 14 днів</h2>
          {s.daily.length > 0 ? (
            <div className="flex items-end gap-1.5" style={{ height: 120 }}>
              {s.daily.map((d) => {
                const max = Math.max(...s.daily.map((x) => x.sent), 1);
                return (
                  <div key={d.date} className="group relative flex flex-1 flex-col items-center justify-end gap-1 self-stretch">
                    {d.replied > 0 && <div className="text-[10px] font-bold text-green-400">+{d.replied}</div>}
                    <div
                      className="w-full rounded-t-sm bg-[var(--accent)] transition-opacity group-hover:opacity-100"
                      style={{ height: `${Math.max((d.sent / max) * 80, d.sent > 0 ? 6 : 2)}%`, opacity: d.sent > 0 ? 0.85 : 0.15 }}
                      title={`${d.date}: ${d.sent} листів${d.replied ? `, ${d.replied} відповідей` : ""}`}
                    />
                    <div className="text-[9px] tabular-nums text-[var(--text-muted)]">{d.date.slice(8)}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-[var(--text-muted)]">Немає даних</div>
          )}
          <div className="mt-2 flex gap-4 text-[10px] text-[var(--text-muted)]">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-[var(--accent)]" />листи</span>
            <span><span className="mr-1 font-bold text-green-400">+N</span>відповіді</span>
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
