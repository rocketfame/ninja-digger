import Link from "next/link";
import { NavBar } from "@/app/components/NavBar";
import { pool } from "@/lib/db";
import { HarvestButton } from "./HarvestButton";

export const dynamic = "force-dynamic";

type Row = {
  soundcloud_id: string; username: string; full_name: string | null; permalink_url: string;
  city: string | null; country_code: string | null; track_count: number; followers_count: number;
  email: string | null; tier: string | null; lead_status: string;
};

async function getData(searchParams: { tier?: string; withEmail?: string }) {
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p).then((r) => r.rows).catch(() => []);
  const num = (sql: string) => pool.query(sql).then((r) => Number(r.rows[0]?.c ?? 0)).catch(() => 0);

  const [total, gems, withEmail, seed] = await Promise.all([
    num("SELECT COUNT(*)::int c FROM sc_artists"),
    num("SELECT COUNT(*)::int c FROM sc_artists WHERE tier='A'"),
    num("SELECT COUNT(*)::int c FROM sc_artists WHERE email IS NOT NULL"),
    pool.query("SELECT permalink, username, followers_count, last_harvested_at FROM sc_seed_accounts WHERE active=true ORDER BY id LIMIT 1").then((r) => r.rows[0]).catch(() => null),
  ]);

  const conds: string[] = [];
  const params: string[] = [];
  if (searchParams.tier && ["A", "B", "C"].includes(searchParams.tier)) { params.push(searchParams.tier); conds.push(`tier=$${params.length}`); }
  if (searchParams.withEmail === "1") conds.push("email IS NOT NULL");
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = (await q(`SELECT soundcloud_id, username, full_name, permalink_url, city, country_code, track_count, followers_count, email, tier, lead_status FROM sc_artists ${where} ORDER BY tier, followers_count DESC LIMIT 200`, params)) as Row[];

  return { total, gems, withEmail, seed, rows };
}

const TIER_STYLE: Record<string, string> = { A: "text-amber-400", B: "text-[#60a5fa]", C: "text-[var(--text-muted)]" };

export default async function ScLeadsPage({ searchParams }: { searchParams: Promise<{ tier?: string; withEmail?: string }> }) {
  const sp = await searchParams;
  const d = await getData(sp);

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">SoundCloud Leads</h1>
          <HarvestButton />
        </div>

        {/* Stats */}
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-2xl font-bold tabular-nums">{d.total.toLocaleString("uk-UA")}</div>
            <div className="text-xs text-[var(--text-muted)]">артистів зібрано</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-2xl font-bold tabular-nums text-amber-400">💎 {d.gems}</div>
            <div className="text-xs text-[var(--text-muted)]">перлини (tier A)</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-2xl font-bold tabular-nums text-[#60a5fa]">{d.withEmail}</div>
            <div className="text-xs text-[var(--text-muted)]">з email у профілі</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="truncate text-sm font-semibold">@{d.seed?.permalink ?? "—"}</div>
            <div className="text-xs text-[var(--text-muted)]">джерело · {d.seed?.followers_count?.toLocaleString("uk-UA") ?? 0} фоловерів</div>
            <div className="text-[10px] text-[var(--text-muted)]">{d.seed?.last_harvested_at ? `оновлено ${String(d.seed.last_harvested_at).slice(0, 16).replace("T", " ")}` : "ще не збирали"}</div>
          </div>
        </div>

        {/* Filters + export */}
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--text-muted)]">Tier:</span>
          {["", "A", "B", "C"].map((t) => (
            <Link key={t || "all"} href={`/sc-leads${t ? `?tier=${t}` : ""}${sp.withEmail === "1" ? `${t ? "&" : "?"}withEmail=1` : ""}`}
              className={`rounded-md border px-3 py-1 ${sp.tier === t || (!sp.tier && !t) ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)]"}`}>
              {t || "всі"}
            </Link>
          ))}
          <Link href={`/sc-leads?${sp.tier ? `tier=${sp.tier}&` : ""}${sp.withEmail === "1" ? "" : "withEmail=1"}`}
            className={`rounded-md border px-3 py-1 ${sp.withEmail === "1" ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)]"}`}>
            📧 тільки з email
          </Link>
          <a href={`/api/segments/soundcloud/export?${sp.tier ? `tier=${sp.tier}&` : ""}${sp.withEmail === "1" ? "withEmail=1" : ""}`} download
            className="ml-auto rounded-md border border-[var(--border)] px-3 py-1 text-[var(--text-muted)] hover:border-[var(--accent)]/60 hover:text-[var(--text)]">
            ⬇ Завантажити CSV
          </a>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-2">Артист</th><th className="px-2 py-2">Tier</th>
                <th className="px-2 py-2">Треки</th><th className="px-2 py-2">Фоловери</th>
                <th className="px-2 py-2">Місто</th><th className="px-4 py-2">Email</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.soundcloud_id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-page)]">
                  <td className="px-4 py-2"><a href={r.permalink_url} target="_blank" rel="noreferrer" className="font-medium hover:text-[var(--accent)]">{r.full_name || r.username}</a></td>
                  <td className={`px-2 py-2 font-bold ${TIER_STYLE[r.tier ?? "C"]}`}>{r.tier}</td>
                  <td className="px-2 py-2 tabular-nums">{r.track_count}</td>
                  <td className="px-2 py-2 tabular-nums">{r.followers_count.toLocaleString("uk-UA")}</td>
                  <td className="px-2 py-2 text-[var(--text-muted)]">{r.city || (r.country_code ?? "—")}</td>
                  <td className="px-4 py-2 text-[var(--text-muted)]">{r.email ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.rows.length === 0 && <div className="p-6 text-center text-sm text-[var(--text-muted)]">Немає даних під цей фільтр. Натисни «Зібрати» вгорі.</div>}
        </div>
      </main>
    </div>
  );
}
