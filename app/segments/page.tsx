import Link from "next/link";
import { NavBar } from "@/app/components/NavBar";
import { SEGMENTS, SERVICE, segmentCounts, segmentRows } from "@/lib/segments";

export const dynamic = "force-dynamic";

const SEG: Record<string, { label: string; color: string; hint: string }> = {
  hot: { label: "Гарячі", color: "#f97316", hint: "клікнули або відповіли" },
  warm: { label: "Теплі", color: "#60a5fa", hint: "відкрили" },
  cold: { label: "Холодні", color: "#9ca3af", hint: "без реакції або проігноровані" },
  converted: { label: "Купили після листа", color: "#22c55e", hint: "" },
  customer: { label: "Вже клієнти", color: "#6b7280", hint: "були в магазині до нас" },
  blacklist: { label: "Чорний список", color: "#ef4444", hint: "bounce, скарга, відписка" },
};
const PLATFORM: Record<string, { label: string; color: string }> = {
  soundcloud: { label: "SoundCloud", color: "#ff5500" }, spotify: { label: "Spotify", color: "#1db954" }, youtube: { label: "YouTube", color: "#ff0033" }, beatport: { label: "Beatport", color: "#a3ff12" },
};
const SOURCES: [string, string][] = [["reex", "Re-Ex"], ["graph", "SC граф"], ["instagram", "Instagram"], ["youtube", "YouTube"], ["beatport", "Beatport→Spotify"]];
const fmt = (n: number) => n.toLocaleString("uk-UA");
const d = (s: string | null) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}` : "—");
const srcLabel = (s: string | null) => !s ? "—" : s.startsWith("reex:") ? `Re-Ex · ${s.slice(5)}` : s === "graph" ? "SC граф" : s === "upload" ? "SC свіжі" : s.startsWith("instagram:") ? "Instagram" : s.startsWith("youtube:") ? "YouTube" : s === "beatport:stale" ? "Beatport → Spotify" : s;

type SP = { seg?: string; p?: string; src?: string; page?: string };

export default async function SegmentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const all = [...SEGMENTS, ...SERVICE] as readonly string[];
  const seg = sp.seg && all.includes(sp.seg) ? sp.seg : undefined;
  const platform = sp.p && PLATFORM[sp.p] ? sp.p : undefined;
  const source = sp.src && SOURCES.some(([k]) => k === sp.src) ? sp.src : undefined;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const LIMIT = 100;

  const [counts, rows] = await Promise.all([segmentCounts(), segmentRows({ segment: seg, platform, source, limit: LIMIT, offset: (page - 1) * LIMIT })]);
  const bySeg: Record<string, number> = {}; const byPlat: Record<string, number> = {};
  for (const c of counts) { bySeg[c.segment] = (bySeg[c.segment] ?? 0) + c.c; if (!seg || c.segment === seg) byPlat[c.platform] = (byPlat[c.platform] ?? 0) + c.c; }
  const working = SEGMENTS.reduce((a, k) => a + (bySeg[k] ?? 0), 0);

  const qs = (over: Partial<SP>) => {
    const o = { seg, p: platform, src: source, ...over } as Record<string, string | undefined>;
    const u = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v) u.set(k, v); const s = u.toString(); return `/segments${s ? `?${s}` : ""}`;
  };
  const csv = `/api/segments/export${qs({}).replace("/segments", "")}`;
  const chip = (active: boolean, color: string) => active
    ? { boxShadow: `inset 0 0 0 2px ${color}`, background: `${color}1a`, borderColor: "transparent" }
    : { borderColor: "var(--border)", background: "var(--bg-card)" };

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">База лідів</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{fmt(working)} лідів, яких ми торкалися і з ким ще можна говорити · зберігається у нас</p>
          </div>
          <a href={csv} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm font-medium hover:bg-[var(--bg-hover)]">⬇ CSV вибірки</a>
        </div>

        <div className="mb-3 grid grid-cols-3 gap-2.5">
          {SEGMENTS.map((k) => (
            <Link key={k} href={qs({ seg: seg === k ? undefined : k, page: undefined })} className="rounded-xl border px-4 py-3.5 transition-all" style={chip(seg === k, SEG[k].color)}>
              <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: SEG[k].color }} /><span className="text-2xl font-bold tabular-nums" style={{ color: SEG[k].color }}>{fmt(bySeg[k] ?? 0)}</span></div>
              <div className="mt-0.5 text-xs text-[var(--text-muted)]">{SEG[k].label} <span className="opacity-60">· {SEG[k].hint}</span></div>
            </Link>
          ))}
        </div>
        <div className="mb-5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
          {SERVICE.map((k) => (
            <Link key={k} href={qs({ seg: seg === k ? undefined : k, page: undefined })} className={seg === k ? "text-[var(--text)] underline" : "hover:text-[var(--text)]"}>
              <span className="inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: SEG[k].color }} /> {SEG[k].label}: <b>{fmt(bySeg[k] ?? 0)}</b>{SEG[k].hint ? ` · ${SEG[k].hint}` : ""}
            </Link>
          ))}
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          {Object.entries(PLATFORM).map(([k, v]) => (
            <Link key={k} href={qs({ p: platform === k ? undefined : k, page: undefined })} className="rounded-lg border px-2.5 py-1" style={chip(platform === k, v.color)}>{v.label} <span className="text-[var(--text-muted)]">{fmt(byPlat[k] ?? 0)}</span></Link>
          ))}
          <span className="mx-2 text-[var(--border)]">|</span>
          {SOURCES.map(([k, l]) => (
            <Link key={k} href={qs({ src: source === k ? undefined : k, page: undefined })} className="rounded-lg border px-2.5 py-1" style={chip(source === k, "#c084fc")}>{l}</Link>
          ))}
        </div>

        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-table-header)] text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
              <tr><th className="px-3 py-2">Лід</th><th className="px-3 py-2">Сегмент</th><th className="px-3 py-2">Платформа</th><th className="px-3 py-2">Джерело</th><th className="px-3 py-2 text-right">Фолов.</th><th className="px-3 py-2">Канал</th><th className="px-3 py-2">Дотик</th><th className="px-3 py-2 text-right">Відкр.</th><th className="px-3 py-2 text-right">Клік.</th><th className="px-3 py-2 text-right">$</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={10} className="px-3 py-8 text-center text-[var(--text-muted)]">Порожньо</td></tr> : rows.map((r) => {
                const s = SEG[r.segment] ?? SEG.cold; const p = PLATFORM[r.platform] ?? { label: r.platform, color: "var(--text-muted)" };
                return (
                  <tr key={r.email} className="border-t border-[var(--border)] tabular-nums">
                    <td className="px-3 py-2"><div className="font-medium">{r.name ?? "—"}</div><div className="text-xs text-[var(--text-muted)]">{r.profile_url ? <a href={r.profile_url} target="_blank" rel="noreferrer" className="hover:underline">{r.email}</a> : r.email}</div></td>
                    <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}{r.replied_open ? <span className="text-xs text-[var(--text-muted)]">· відповів</span> : null}</span></td>
                    <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: p.color }} />{p.label}</span></td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{srcLabel(r.source)}{r.tier ? <span className="ml-1 opacity-60">· {r.tier}</span> : null}</td>
                    <td className="px-3 py-2 text-right">{r.followers != null ? fmt(r.followers) : "—"}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{r.channel === "mass" ? "eSputnik" : "Max"}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{d(r.first_touch)}</td>
                    <td className="px-3 py-2 text-right">{r.opens || "—"}</td>
                    <td className="px-3 py-2 text-right">{r.clicks || "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold" style={r.revenue ? { color: "#22c55e" } : undefined}>{r.revenue ? `$${r.revenue.toFixed(0)}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between text-sm text-[var(--text-muted)]">
          <span>Сторінка {page} · по {LIMIT}</span>
          <span className="flex gap-2">
            {page > 1 ? <Link href={qs({ page: String(page - 1) })} className="rounded-lg border border-[var(--border)] px-3 py-1 hover:bg-[var(--bg-hover)]">← Попередня</Link> : null}
            {rows.length === LIMIT ? <Link href={qs({ page: String(page + 1) })} className="rounded-lg border border-[var(--border)] px-3 py-1 hover:bg-[var(--bg-hover)]">Наступна →</Link> : null}
          </span>
        </div>
      </main>
    </div>
  );
}
