import { NavBar } from "@/app/components/NavBar";
import { massStats, type MassRow } from "@/lib/massStats";

export const dynamic = "force-dynamic";

const PLATFORM: Record<string, { label: string; color: string }> = {
  soundcloud: { label: "SoundCloud", color: "#ff5500" },
  spotify: { label: "Spotify", color: "#1db954" },
  youtube: { label: "YouTube", color: "#ff0033" },
};

const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—");
const fmt = (n: number) => n.toLocaleString("uk-UA");
const day = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

function Kpi({ value, label, sub, color }: { value: string; label: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3.5">
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ background: color ?? "var(--text-muted)" }} />
        <span className="text-2xl font-bold tabular-nums" style={color ? { color } : undefined}>{value}</span>
      </div>
      <div className="mt-0.5 text-xs text-[var(--text-muted)]">{label}{sub ? <span className="opacity-70"> · {sub}</span> : null}</div>
    </div>
  );
}

function Row({ r }: { r: MassRow }) {
  const p = PLATFORM[r.platform] ?? { label: r.platform, color: "var(--text-muted)" };
  return (
    <tr className="border-t border-[var(--border)] tabular-nums">
      <td className="px-3 py-2 text-[var(--text-muted)]">{day(r.day)}</td>
      <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: p.color }} />{p.label}</span></td>
      <td className="px-3 py-2 text-right text-[var(--text-muted)]">{r.planned || "—"}</td>
      <td className="px-3 py-2 text-right text-[var(--text-muted)]">{r.budget || "—"}</td>
      <td className="px-3 py-2 text-right font-semibold">{fmt(r.pushed)}</td>
      <td className="px-3 py-2 text-right">{fmt(r.delivered)}</td>
      <td className="px-3 py-2 text-right">{fmt(r.opened)} <span className="text-[var(--text-muted)]">{pct(r.opened, r.delivered)}</span></td>
      <td className="px-3 py-2 text-right">{fmt(r.clicked)} <span className="text-[var(--text-muted)]">{pct(r.clicked, r.delivered)}</span></td>
      <td className="px-3 py-2 text-right text-[var(--text-muted)]">{r.unsub + r.bounced || "—"}</td>
      <td className="px-3 py-2 text-right font-semibold" style={r.ordered ? { color: "#22c55e" } : undefined}>{r.ordered ? `${r.ordered} · $${r.revenue.toFixed(0)}` : "—"}</td>
      <td className="px-3 py-2 text-right text-[var(--text-muted)]">{fmt(r.live)} / {fmt(r.retired)}</td>
    </tr>
  );
}

export default async function MassPage() {
  const s = await massStats(30);
  const t = s.totals;
  const seatsByPlan = s.base.size === null ? null : Math.max(0, s.base.planLimit - s.base.reserve - s.base.size);

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Масовий канал</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">eSputnik · offers.promosound.net · останні 30 днів · один лист на ліда, назавжди</p>
          </div>
          <div className="text-right text-xs text-[var(--text-muted)]">
            База eSputnik: <b className="text-[var(--text)]">{s.base.size === null ? "?" : fmt(s.base.size)}</b> з {fmt(s.base.planLimit)}
            {seatsByPlan !== null ? <> · місць для лідів <b className="text-[var(--text)]">{fmt(seatsByPlan)}</b> (резерв {fmt(s.base.reserve)})</> : null}
            <br />Лідів у базі зараз: <b className="text-[var(--text)]">{fmt(s.base.live)}</b> із вікна {fmt(s.base.window)}
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi value={fmt(t.pushed)} label="Відправлено" sub={t.planned ? `план ${fmt(t.planned)}` : undefined} />
          <Kpi value={pct(t.delivered, t.pushed)} label="Доставлено" sub={fmt(t.delivered)} />
          <Kpi value={pct(t.opened, t.delivered)} label="Відкрили" sub={fmt(t.opened)} color="#60a5fa" />
          <Kpi value={pct(t.clicked, t.delivered)} label="Клікнули" sub={fmt(t.clicked)} color="#fbbf24" />
          <Kpi value={String(t.ordered)} label="Замовили" sub={t.revenue ? `$${t.revenue.toFixed(0)}` : "з реєстру лідів"} color="#22c55e" />
          <Kpi value={String(s.unattributed.orders)} label="Код/UTM без ліда" sub={s.unattributed.revenue ? `$${s.unattributed.revenue.toFixed(0)}` : "не з нашого пушу"} color="#c084fc" />
        </div>

        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-table-header)] text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th className="px-3 py-2">День</th>
                <th className="px-3 py-2">Сегмент</th>
                <th className="px-3 py-2 text-right" title="Скільки просила ручка esputnik_daily_push">План</th>
                <th className="px-3 py-2 text-right" title="Скільки дозволили база й вікно">Бюджет</th>
                <th className="px-3 py-2 text-right">Пуш</th>
                <th className="px-3 py-2 text-right">Достав.</th>
                <th className="px-3 py-2 text-right">Відкрили</th>
                <th className="px-3 py-2 text-right">Кліки</th>
                <th className="px-3 py-2 text-right" title="Відписки + bounce">Негатив</th>
                <th className="px-3 py-2 text-right" title="Замовлення покупців із цього пушу: код MAX, email або UTM">Замовили</th>
                <th className="px-3 py-2 text-right" title="Ще в eSputnik / видалено ротацією">Живі / вид.</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.length === 0 ? (
                <tr><td colSpan={11} className="px-3 py-8 text-center text-[var(--text-muted)]">Пушів ще не було</td></tr>
              ) : s.rows.map((r) => <Row key={`${r.day}-${r.platform}`} r={r} />)}
            </tbody>
          </table>
        </div>

        {s.unattributed.byCode.length > 0 ? (
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            Коди за 30 днів: {s.unattributed.byCode.map((c) => `${c.code} ${c.orders}`).join(" · ")}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Замовлення рахуються трьома шляхами: код MAX*, email покупця в реєстрі лідів, або utm_source=offers на лендінгу. Події з eSputnik і замовлення з Shopify підтягуються щогодини.
        </p>
      </main>
    </div>
  );
}
