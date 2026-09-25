import { pool } from "@/lib/db";
import { NavBar } from "@/app/components/NavBar";
import { Disc3, Mail } from "lucide-react";
import { SiSoundcloud, SiInstagram, SiFacebook, SiBandcamp, SiBeatport } from "react-icons/si";
import { GENRE_GROUPS } from "@/lib/labelGenres";
import { labelWhere, LABEL_EMAILS_SQL, type LabelFilters } from "@/lib/labelQuery";
import { labelSourceStats } from "@/lib/labels";

export const dynamic = "force-dynamic";

type Label = {
  id: number; name: string; grade: string | null; genre_groups: string[]; country_code: string | null; country_tier: number | null;
  sc_permalink: string | null; sc_followers: number | null; website: string | null; instagram: string | null; facebook: string | null;
  bandcamp: string | null; beatport_url: string | null; parent_label: string | null; demo_policy: string | null; demo_url: string | null; emails: string | null;
  chart_entries: number; best_position: number | null; discovered_via: string; exclude_reason: string | null;
};

const num = (n: number | null | undefined) => (n ?? 0).toLocaleString("uk-UA");
const VIA: Record<string, string> = {
  charts: "Beatport-чарти", our_base_sc: "Наша SC-база", our_base_yt: "Наш YouTube", our_base_ig: "Наш Instagram", sc_graph: "Граф підписок",
  our_blacklist: "Блеклист: профілі", our_blacklist_domain: "Блеклист: домени", discogs_sublabel: "Discogs: сублейбли",
};
const DEMO: Record<string, string> = { email: "📧 демо на email", form: "📝 форма", closed: "⛔ закрито", unknown: "—" };
const GRADE_COLOR: Record<string, string> = { A: "#22c55e", B: "#eab308", C: "#94a3b8" };

async function getData(f: LabelFilters) {
  const { where, params } = labelWhere(f);
  const labels = await pool.query<Label>(
    `SELECT l.id, l.name, l.grade, l.genre_groups, l.country_code, l.country_tier, l.sc_permalink, l.sc_followers, l.website,
            l.instagram, l.facebook, l.bandcamp, l.beatport_url, l.parent_label, l.demo_policy, l.demo_url, ${LABEL_EMAILS_SQL} emails,
            l.chart_entries, l.best_position, l.discovered_via, l.exclude_reason
       FROM label_db l ${where}
      ORDER BY l.grade NULLS LAST, l.chart_entries DESC, l.sc_followers DESC NULLS LAST LIMIT 300`,
    params
  ).then((r) => r.rows).catch(() => [] as Label[]);
  const count = await pool.query<{ n: number }>(`SELECT COUNT(*)::int n FROM label_db l ${where}`, params).then((r) => r.rows[0]?.n ?? 0).catch(() => 0);
  const totals = await pool.query<{ total: number; resolved: number; queued: number; a: number; b: number; c: number; excluded: number; pending: number; valid: number }>(
    `SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE status='resolved')::int resolved, COUNT(*) FILTER (WHERE status='new')::int queued,
            COUNT(*) FILTER (WHERE grade='A')::int a, COUNT(*) FILTER (WHERE grade='B')::int b, COUNT(*) FILTER (WHERE grade='C')::int c,
            COUNT(*) FILTER (WHERE status='excluded')::int excluded,
            (SELECT COUNT(*) FROM label_db_emails WHERE verdict='pending')::int pending,
            (SELECT COUNT(*) FROM label_db_emails WHERE verdict='valid')::int valid
       FROM label_db`
  ).then((r) => r.rows[0]).catch(() => null);
  const sources = await labelSourceStats().catch(() => []);
  return { labels, count, totals, sources };
}

function Select({ name, value, options, all }: { name: string; value?: string; options: [string, string][]; all: string }) {
  return (
    <select name={name} defaultValue={value ?? ""} className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2.5 py-1.5 text-sm text-[var(--text)]">
      <option value="">{all}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

export default async function LabelsPage({ searchParams }: { searchParams: Promise<LabelFilters> }) {
  const f = await searchParams;
  const { labels, count, totals, sources } = await getData(f);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div className="min-h-screen bg-[var(--bg-page)]">
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-center gap-3">
          <Disc3 className="h-7 w-7 flex-shrink-0" style={{ color: "#38bdf8" }} />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-[var(--text)]">Лейбли</h1>
            <p className="text-sm text-[var(--text-muted)]">Наша база лейблів: Beatport-чарти, наша SC-база і граф підписок. Лише країни тір 1–3, без RU/BY. Кожен email пройшов фільтри і SMTP.</p>
          </div>
        </div>

        {totals && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { v: totals.a, l: "A — перевірений email", c: GRADE_COLOR.A },
              { v: totals.b, l: "B — email, чекає SMTP / catch-all", c: GRADE_COLOR.B },
              { v: totals.c, l: "C — лише форма / соцмережі", c: GRADE_COLOR.C },
              { v: totals.resolved, l: `перевірено · ${num(totals.queued)} у черзі · ${num(totals.excluded)} виключено`, c: "var(--text)" },
            ].map((s) => (
              <div key={s.l} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
                <div className="text-2xl font-bold" style={{ color: s.c }}>{num(s.v)}</div>
                <div className="mt-0.5 text-xs text-[var(--text-muted)]">{s.l}</div>
              </div>
            ))}
          </div>
        )}

        {sources.length > 0 && (
          <div className="mb-6 overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Віддача джерел</div>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-[var(--text-muted)]"><th className="py-1 pr-3 font-medium">джерело</th><th className="pr-3 font-medium">усього</th><th className="pr-3 font-medium">перевірено</th><th className="pr-3 font-medium">з email</th><th className="pr-3 font-medium">A</th><th className="font-medium">виключено</th></tr></thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.via} className="border-t border-[var(--border)] text-[var(--text)]">
                    <td className="py-1.5 pr-3">{VIA[s.via] ?? s.via}</td><td className="pr-3">{num(s.total)}</td><td className="pr-3">{num(s.resolved)}</td>
                    <td className="pr-3">{num(s.with_email)}</td><td className="pr-3" style={{ color: GRADE_COLOR.A }}>{num(s.grade_a)}</td><td>{num(s.excluded)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form className="mb-4 flex flex-wrap items-center gap-2" method="get">
          <Select name="genre" value={f.genre} all="Усі жанри" options={GENRE_GROUPS.map((g) => [g, g])} />
          <Select name="grade" value={f.grade} all="Усі оцінки" options={[["AB", "A + B (з email)"], ["A", "A"], ["B", "B"], ["C", "C"]]} />
          <Select name="tier" value={f.tier} all="Усі країни" options={[["1", "Тір 1"], ["2", "Тір 2"], ["3", "Тір 3"], ["unknown", "Країна невідома"]]} />
          <Select name="demo" value={f.demo} all="Демо: будь-як" options={[["email", "Демо на email"], ["form", "Форма"], ["closed", "Закрито"]]} />
          <Select name="via" value={f.via} all="Усі джерела" options={Object.entries(VIA)} />
          <Select name="kind" value={f.kind} all="Лише лейбли" options={[["agency", "Агенції"], ["other", "Інше (не підтверджено)"], ["all", "Усе"]]} />
          <Select name="status" value={f.status} all="Перевірені" options={[["new", "У черзі"], ["no_match", "Не знайдено профіль"], ["excluded", "Виключені"], ["all", "Усі"]]} />
          <input name="q" defaultValue={f.q ?? ""} placeholder="Пошук" className="w-32 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2.5 py-1.5 text-sm text-[var(--text)] sm:flex-none" />
          <button className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-black">Показати</button>
          <a href={`/api/labels/export${qs ? `?${qs}` : ""}`} download className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-card)]">📥 CSV ({num(count)})</a>
        </form>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
          {labels.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--text-muted)]">Під ці фільтри лейблів поки нема. Конвеєр працює кожні 20 хвилин — база наповнюється сама.</div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {labels.map((l) => (
                <li key={l.id} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="w-6 flex-shrink-0 text-center text-sm font-bold" style={{ color: GRADE_COLOR[l.grade ?? ""] ?? "var(--text-muted)" }}>{l.grade ?? "·"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-[var(--text)]">
                        {l.website ? <a href={l.website} target="_blank" rel="noreferrer" className="hover:text-[var(--accent)] hover:underline">{l.name} ↗</a> : l.name}
                        {l.country_code && <span className="ml-2 text-xs text-[var(--text-muted)]">{l.country_code}{l.country_tier ? ` · T${l.country_tier}` : ""}</span>}
                      </div>
                      <div className="truncate text-xs text-[var(--text-muted)]">
                        {[l.genre_groups.join(", "), l.chart_entries > 0 ? `${num(l.chart_entries)} у чартах, топ #${l.best_position}` : null,
                          l.sc_followers ? `${num(l.sc_followers)} SC` : null, l.parent_label ? `сублейбл ${l.parent_label}` : null, l.demo_policy ? DEMO[l.demo_policy] : null, l.exclude_reason]
                          .filter(Boolean).join(" · ")}
                      </div>
                      {l.emails && <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-[var(--text)]"><Mail className="h-3 w-3 flex-shrink-0" /><span className="truncate">{l.emails}</span></div>}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2.5 pl-9 sm:pl-0">
                    {l.demo_url && <a href={l.demo_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-[var(--accent)]">демо ↗</a>}
                    {l.sc_permalink && <a href={`https://soundcloud.com/${l.sc_permalink}`} target="_blank" rel="noreferrer" title="SoundCloud"><SiSoundcloud className="h-4 w-4" style={{ color: "#ff5500" }} /></a>}
                    {l.instagram && <a href={l.instagram} target="_blank" rel="noreferrer" title="Instagram"><SiInstagram className="h-4 w-4" style={{ color: "#e1306c" }} /></a>}
                    {l.facebook && <a href={l.facebook} target="_blank" rel="noreferrer" title="Facebook"><SiFacebook className="h-4 w-4" style={{ color: "#1877f2" }} /></a>}
                    {l.bandcamp && <a href={l.bandcamp} target="_blank" rel="noreferrer" title="Bandcamp"><SiBandcamp className="h-4 w-4" style={{ color: "#629aa9" }} /></a>}
                    {l.beatport_url && <a href={l.beatport_url} target="_blank" rel="noreferrer" title="Beatport"><SiBeatport className="h-4 w-4" style={{ color: "#a3ff12" }} /></a>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {count > labels.length && <p className="mt-3 text-center text-xs text-[var(--text-muted)]">Показано {labels.length} з {num(count)} — повний список у CSV.</p>}
      </main>
    </div>
  );
}
