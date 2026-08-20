import { pool } from "@/lib/db";
import { NavBar } from "@/app/components/NavBar";
import { SiInstagram, SiSpotify } from "react-icons/si";
import { Users, Search } from "lucide-react";
import { CreatorActions } from "./CreatorActions";

export const dynamic = "force-dynamic";

type Creator = {
  ig_username: string; full_name: string | null; followers: number | null;
  bio: string | null; category: string | null; score: number; status: string;
  discovered_from: string | null; leads_found: number;
  avg_comments: number | null; mechanic_hits: number | null;
};

async function getData() {
  const rows = <T extends Record<string, unknown>>(sql: string) => pool.query<T>(sql).then((r) => r.rows).catch(() => [] as T[]);
  const [creators, stats] = await Promise.all([
    rows<Creator>(`SELECT ig_username, full_name, followers, bio, category, score, status, discovered_from, leads_found, avg_comments, mechanic_hits
                   FROM spotify_creators ORDER BY (status='candidate') DESC, score DESC, followers DESC NULLS LAST LIMIT 300`),
    pool.query<{ total: number; candidate: number; approved: number; parsed: number }>(
      `SELECT COUNT(*)::int total,
              COUNT(*) FILTER (WHERE status='candidate')::int candidate,
              COUNT(*) FILTER (WHERE status='approved')::int approved,
              COUNT(*) FILTER (WHERE status='parsed')::int parsed
       FROM spotify_creators`).then((r) => r.rows[0]).catch(() => undefined),
  ]);
  return { creators, stats };
}

export default async function SpotifyCreatorsPage() {
  const { creators, stats } = await getData();
  const n = (x: number | null | undefined) => (x ?? 0).toLocaleString("uk-UA");

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />
      <main className="mx-auto max-w-5xl px-5 py-10">
        <div className="mb-8">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Search className="h-6 w-6 text-[#1db954]" /> Пошук креаторів
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Схожі на its21master промо-акаунти в Instagram. Схвалюй найкращі — і кожен стане джерелом сотень нових лідів.
          </p>
        </div>

        <div className="mb-8 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {[
            { label: "Всього знайдено", value: stats?.total, color: undefined },
            { label: "На розгляді", value: stats?.candidate, color: "#fbbf24" },
            { label: "Схвалено", value: stats?.approved, color: "#1db954" },
            { label: "Спарсено", value: stats?.parsed, color: "#60a5fa" },
          ].map((c) => (
            <div key={c.label} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3.5">
              <div className="text-2xl font-bold tabular-nums" style={c.color ? { color: c.color } : undefined}>{n(c.value)}</div>
              <div className="text-xs text-[var(--text-muted)]">{c.label}</div>
            </div>
          ))}
        </div>

        {creators.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] p-10 text-center text-sm text-[var(--text-muted)]">
            Ще нема кандидатів. Запусти дискаверинг від its21master.
          </div>
        ) : (
          <div className="space-y-2">
            {creators.map((c) => (
              <div key={c.ig_username} className="flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#1db954]/10">
                  <SiInstagram className="h-4 w-4 text-[#e1306c]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <a href={`https://instagram.com/${c.ig_username}`} target="_blank" rel="noreferrer" className="truncate font-semibold hover:text-[var(--accent)]">
                      {c.full_name || c.ig_username}
                    </a>
                    <span className="text-xs text-[var(--text-muted)]">@{c.ig_username}</span>
                  </div>
                  <div className="truncate text-xs text-[var(--text-muted)]">
                    {c.bio ? c.bio.replace(/\n/g, " · ").slice(0, 90) : <span className="italic">без біо</span>}
                  </div>
                </div>
                <div className="hidden flex-shrink-0 text-right sm:block" title="середня к-сть коментарів на пост — сигнал механіки збору лідів">
                  {c.avg_comments != null ? (
                    <div className={`flex items-center justify-end gap-1 text-sm font-semibold tabular-nums ${c.avg_comments >= 100 ? "text-[#1db954]" : c.avg_comments >= 40 ? "text-[#fbbf24]" : "text-[var(--text-muted)]"}`}>
                      💬 {n(c.avg_comments)}{c.mechanic_hits ? <span className="text-[10px]">⚡</span> : null}
                    </div>
                  ) : <div className="text-xs text-[var(--text-muted)]">—</div>}
                  <div className="text-[10px] text-[var(--text-muted)]">сер. коментів/пост</div>
                </div>
                <div className="hidden flex-shrink-0 text-right md:block">
                  <div className="flex items-center gap-1 text-sm font-medium tabular-nums"><Users className="h-3 w-3 text-[var(--text-muted)]" />{n(c.followers)}</div>
                  {c.discovered_from && <div className="text-[10px] text-[var(--text-muted)]">від @{c.discovered_from}</div>}
                </div>
                <div className="flex-shrink-0" title="релевантність як джерела">
                  <span className={`rounded-md px-2 py-1 text-xs font-bold tabular-nums ${c.score >= 60 ? "bg-[#1db954]/15 text-[#1db954]" : c.score >= 30 ? "bg-[#fbbf24]/15 text-[#fbbf24]" : "bg-[var(--bg-hover)] text-[var(--text-muted)]"}`}>
                    {c.score}
                  </span>
                </div>
                <div className="flex-shrink-0">
                  <CreatorActions username={c.ig_username} status={c.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
