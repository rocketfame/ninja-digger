import Link from "next/link";
import { NavBar } from "@/app/components/NavBar";
import { pool } from "@/lib/db";
import { SeedControl } from "./SeedControl";
import { SC_ACTIVITY, SC_ACTIVITY_SQL, type ScActivityKey } from "@/lib/scActivity";

export const dynamic = "force-dynamic";

type Row = {
  soundcloud_id: string; username: string; full_name: string | null; permalink_url: string;
  city: string | null; country_code: string | null; track_count: number; followers_count: number;
  email: string | null; tier: string | null; lead_status: string; activity: string;
};
type SP = { tier?: string; withEmail?: string; activity?: string };

async function getData(sp: SP) {
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p).then((r) => r.rows).catch(() => []);
  const num = (sql: string) => pool.query(sql).then((r) => Number(r.rows[0]?.c ?? 0)).catch(() => 0);

  const [total, gems, withEmail, seed, activityRows] = await Promise.all([
    num("SELECT COUNT(*)::int c FROM sc_artists"),
    num("SELECT COUNT(*)::int c FROM sc_artists WHERE tier='A'"),
    num("SELECT COUNT(*)::int c FROM sc_artists WHERE email IS NOT NULL"),
    pool.query("SELECT permalink, username, followers_count, last_harvested_at FROM sc_seed_accounts WHERE active=true ORDER BY id LIMIT 1").then((r) => r.rows[0]).catch(() => null),
    q(`SELECT ${SC_ACTIVITY_SQL} AS activity, COUNT(*)::int c, COUNT(email)::int e FROM sc_artists GROUP BY 1`) as Promise<{ activity: string; c: number; e: number }[]>,
  ]);
  const actMap = new Map(activityRows.map((r) => [r.activity, r]));

  const conds: string[] = [];
  const params: string[] = [];
  if (sp.tier && ["A", "B", "C"].includes(sp.tier)) { params.push(sp.tier); conds.push(`tier=$${params.length}`); }
  if (sp.withEmail === "1") conds.push("email IS NOT NULL");
  if (sp.activity && sp.activity in SC_ACTIVITY) conds.push(`${SC_ACTIVITY_SQL} = '${sp.activity}'`);
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = (await q(`SELECT soundcloud_id, username, full_name, permalink_url, city, country_code, track_count, followers_count, email, tier, lead_status, ${SC_ACTIVITY_SQL} AS activity FROM sc_artists ${where} ORDER BY tier, followers_count DESC LIMIT 200`, params)) as Row[];

  return { total, gems, withEmail, seed, actMap, rows };
}

const TIER_STYLE: Record<string, string> = { A: "text-amber-400", B: "text-[#60a5fa]", C: "text-[var(--text-muted)]" };
const ACT_EMOJI: Record<string, string> = { hot: "🔥", warm: "⏳", cool: "💤", dormant: "⚰️" };

export default async function ScLeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const d = await getData(sp);
  const qs = (extra: Partial<SP>) => {
    const merged = { ...sp, ...extra };
    const parts = Object.entries(merged).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
    return parts.length ? `?${parts.join("&")}` : "";
  };

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">SoundCloud Leads</h1>
          <SeedControl seed={d.seed?.permalink ?? null} />
        </div>

        {/* Stats */}
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-2xl font-bold tabular-nums">{d.total.toLocaleString("uk-UA")}</div>
            <div className="text-xs text-[var(--text-muted)]">артистів зібрано</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-2xl font-bold tabular-nums text-amber-400">💎 {d.gems}</div>
            <div className="text-xs text-[var(--text-muted)]">перлини (живі, tier A)</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-2xl font-bold tabular-nums text-[#60a5fa]">{d.withEmail}</div>
            <div className="text-xs text-[var(--text-muted)]">з email у профілі</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="truncate text-sm font-semibold">@{d.seed?.permalink ?? "—"}</div>
            <div className="text-xs text-[var(--text-muted)]">джерело · {d.seed?.followers_count?.toLocaleString("uk-UA") ?? 0} фоловерів</div>
          </div>
        </div>

        {/* Activity segments — separate campaigns */}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(Object.keys(SC_ACTIVITY) as ScActivityKey[]).map((k) => {
            const stat = d.actMap.get(k);
            const active = sp.activity === k;
            return (
              <Link key={k} href={`/sc-leads${qs({ activity: active ? undefined : k })}`}
                className={`rounded-lg border p-3 transition-colors ${active ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--accent)]/50"}`}>
                <div className="text-xs text-[var(--text-muted)]">{SC_ACTIVITY[k].label}</div>
                <div className="text-xl font-bold tabular-nums">{stat?.c ?? 0}</div>
                <div className="text-[10px] text-[var(--text-muted)]">📧 {stat?.e ?? 0} з email</div>
              </Link>
            );
          })}
        </div>

        {/* Filters + export */}
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--text-muted)]">Tier:</span>
          {["", "A", "B", "C"].map((t) => (
            <Link key={t || "all"} href={`/sc-leads${qs({ tier: t || undefined })}`}
              className={`rounded-md border px-3 py-1 ${(sp.tier ?? "") === t ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)]"}`}>
              {t || "всі"}
            </Link>
          ))}
          <Link href={`/sc-leads${qs({ withEmail: sp.withEmail === "1" ? undefined : "1" })}`}
            className={`rounded-md border px-3 py-1 ${sp.withEmail === "1" ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)]"}`}>
            📧 тільки з email
          </Link>
          <a href={`/api/segments/soundcloud/export${qs({})}`} download
            className="ml-auto rounded-md border border-[var(--border)] px-3 py-1 text-[var(--text-muted)] hover:border-[var(--accent)]/60 hover:text-[var(--text)]">
            ⬇ Завантажити цей сегмент CSV
          </a>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-2">Артист</th><th className="px-2 py-2">Tier</th><th className="px-2 py-2">Активність</th>
                <th className="px-2 py-2">Треки</th><th className="px-2 py-2">Фоловери</th>
                <th className="px-2 py-2">Місто</th><th className="px-4 py-2">Email</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.soundcloud_id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-page)]">
                  <td className="px-4 py-2"><a href={r.permalink_url} target="_blank" rel="noreferrer" className="font-medium hover:text-[var(--accent)]">{r.full_name || r.username}</a></td>
                  <td className={`px-2 py-2 font-bold ${TIER_STYLE[r.tier ?? "C"]}`}>{r.tier}</td>
                  <td className="px-2 py-2">{ACT_EMOJI[r.activity] ?? ""}</td>
                  <td className="px-2 py-2 tabular-nums">{r.track_count}</td>
                  <td className="px-2 py-2 tabular-nums">{r.followers_count.toLocaleString("uk-UA")}</td>
                  <td className="px-2 py-2 text-[var(--text-muted)]">{r.city || (r.country_code ?? "—")}</td>
                  <td className="px-4 py-2 text-[var(--text-muted)]">{r.email ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.rows.length === 0 && <div className="p-6 text-center text-sm text-[var(--text-muted)]">Немає даних під цей фільтр. Додай сід або натисни «Зібрати».</div>}
        </div>
      </main>
    </div>
  );
}
