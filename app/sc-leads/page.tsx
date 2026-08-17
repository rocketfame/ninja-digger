import Link from "next/link";
import { NavBar } from "@/app/components/NavBar";
import { pool } from "@/lib/db";
import { SeedControl } from "./SeedControl";
import { SC_ACTIVITY, SC_ACTIVITY_SQL, type ScActivityKey } from "@/lib/scActivity";

export const dynamic = "force-dynamic";

type SP = { tier?: string; withEmail?: string; activity?: string };

async function getData(sp: SP) {
  const num = (sql: string, p: unknown[] = []) => pool.query(sql, p).then((r) => Number(r.rows[0]?.c ?? 0)).catch(() => 0);
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p).then((r) => r.rows).catch(() => []);

  // Build WHERE for the currently selected segment
  const conds: string[] = [];
  const params: string[] = [];
  if (sp.tier && ["A", "B", "C"].includes(sp.tier)) { params.push(sp.tier); conds.push(`tier=$${params.length}`); }
  if (sp.withEmail === "1") conds.push("email IS NOT NULL");
  if (sp.activity && sp.activity in SC_ACTIVITY) conds.push(`${SC_ACTIVITY_SQL}='${sp.activity}'`);
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const [total, seed, activityRows, tierRows, segCount, segEmail, preview] = await Promise.all([
    num("SELECT COUNT(*)::int c FROM sc_artists"),
    pool.query("SELECT permalink, username, followers_count, last_harvested_at FROM sc_seed_accounts WHERE active=true ORDER BY id LIMIT 1").then((r) => r.rows[0]).catch(() => null),
    q(`SELECT ${SC_ACTIVITY_SQL} AS a, COUNT(*)::int c, COUNT(email)::int e FROM sc_artists GROUP BY 1`) as Promise<{ a: string; c: number; e: number }[]>,
    q(`SELECT COALESCE(tier,'C') AS t, COUNT(*)::int c FROM sc_artists GROUP BY 1`) as Promise<{ t: string; c: number }[]>,
    num(`SELECT COUNT(*)::int c FROM sc_artists ${where}`, params),
    num(`SELECT COUNT(*)::int c FROM sc_artists ${where}${where ? " AND" : " WHERE"} email IS NOT NULL`, params),
    q(`SELECT username, full_name, email, tier, followers_count, track_count FROM sc_artists ${where} ORDER BY tier, followers_count DESC LIMIT 6`, params) as Promise<{ username: string; full_name: string | null; email: string | null; tier: string | null; followers_count: number; track_count: number }[]>,
  ]);
  return {
    total, seed, segCount, segEmail, preview,
    actMap: new Map(activityRows.map((r) => [r.a, r])),
    tierMap: new Map(tierRows.map((r) => [r.t, r.c])),
  };
}

export default async function ScLeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const d = await getData(sp);
  const qs = (extra: Partial<SP>) => {
    const merged = { ...sp, ...extra };
    const parts = Object.entries(merged).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
    return `/sc-leads${parts.length ? `?${parts.join("&")}` : ""}`;
  };
  const exportUrl = `/api/segments/soundcloud/export${qs({}).replace("/sc-leads", "")}`;
  const hasFilter = sp.tier || sp.activity || sp.withEmail === "1";

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">SoundCloud Leads</h1>
            <p className="text-sm text-[var(--text-muted)]">
              {d.total.toLocaleString("uk-UA")} артистів{d.seed ? ` · джерело @${d.seed.permalink} (${d.seed.followers_count?.toLocaleString("uk-UA")} фоловерів)` : ""}
            </p>
          </div>
          <SeedControl seed={d.seed?.permalink ?? null} />
        </div>

        {/* Segment builder */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">Збери сегмент</h2>
          <p className="mb-5 text-xs text-[var(--text-muted)]">Обери фільтри — кількість оновиться, потім завантаж CSV для кампанії.</p>

          {/* 1. Activity */}
          <div className="mb-5">
            <div className="mb-2 text-xs font-medium text-[var(--text-muted)]">1. Свіжість активності</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(SC_ACTIVITY) as ScActivityKey[]).map((k) => {
                const s = d.actMap.get(k);
                const on = sp.activity === k;
                return (
                  <Link key={k} href={qs({ activity: on ? undefined : k })}
                    className={`rounded-xl border p-3 text-center transition-colors ${on ? "border-[var(--accent)] bg-[var(--accent)]/15" : "border-[var(--border)] hover:border-[var(--accent)]/50"}`}>
                    <div className="text-lg font-bold tabular-nums">{s?.c ?? 0}</div>
                    <div className="text-[11px] text-[var(--text-muted)]">{SC_ACTIVITY[k].label}</div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* 2. Tier */}
          <div className="mb-5">
            <div className="mb-2 text-xs font-medium text-[var(--text-muted)]">2. Якість (tier)</div>
            <div className="flex flex-wrap gap-2">
              {[["", "всі"], ["A", "💎 A · перлини"], ["B", "B"], ["C", "C"]].map(([t, label]) => {
                const on = (sp.tier ?? "") === t;
                return (
                  <Link key={t || "all"} href={qs({ tier: t || undefined })}
                    className={`rounded-lg border px-4 py-2 text-sm transition-colors ${on ? "border-[var(--accent)] bg-[var(--accent)]/15" : "border-[var(--border)] hover:border-[var(--accent)]/50"}`}>
                    {label}{t && d.tierMap.get(t) != null ? ` · ${d.tierMap.get(t)}` : ""}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* 3. Email */}
          <div className="mb-6">
            <div className="mb-2 text-xs font-medium text-[var(--text-muted)]">3. Контакт</div>
            <Link href={qs({ withEmail: sp.withEmail === "1" ? undefined : "1" })}
              className={`inline-flex rounded-lg border px-4 py-2 text-sm transition-colors ${sp.withEmail === "1" ? "border-[var(--accent)] bg-[var(--accent)]/15" : "border-[var(--border)] hover:border-[var(--accent)]/50"}`}>
              📧 Тільки з email
            </Link>
          </div>

          {/* Result + download */}
          <div className="flex flex-col items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-page)] p-5 sm:flex-row sm:justify-between">
            <div>
              <div className="text-3xl font-bold tabular-nums text-[var(--accent)]">{d.segCount.toLocaleString("uk-UA")}</div>
              <div className="text-xs text-[var(--text-muted)]">
                артистів у сегменті · <span className="text-[#60a5fa]">{d.segEmail}</span> з email
                {hasFilter && <Link href="/sc-leads" className="ml-2 underline hover:text-[var(--text)]">скинути</Link>}
              </div>
            </div>
            <a href={exportUrl} download
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[var(--accent-hover)]">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4" /></svg>
              Завантажити CSV ({d.segCount})
            </a>
          </div>

          {/* Tiny preview */}
          {d.preview.length > 0 && (
            <div className="mt-4 text-xs text-[var(--text-muted)]">
              <span className="mr-2">Приклад:</span>
              {d.preview.map((p, i) => (
                <span key={i}>{p.full_name || p.username}{p.email ? ` (${p.email})` : ""}{i < d.preview.length - 1 ? " · " : ""}</span>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
