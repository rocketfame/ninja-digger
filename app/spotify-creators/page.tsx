import { pool } from "@/lib/db";
import { NavBar } from "@/app/components/NavBar";
import { SiInstagram, SiSpotify } from "react-icons/si";
import { Users, ExternalLink, Film, SlidersHorizontal, Minus, Music } from "lucide-react";
import type { ComponentType } from "react";
import { CreatorActions } from "./CreatorActions";
import { SpotifyTabs } from "@/app/components/SpotifyTabs";

export const dynamic = "force-dynamic";

type Creator = {
  ig_username: string; full_name: string | null; followers: number | null;
  bio: string | null; category: string | null; score: number; status: string;
  discovered_from: string | null; leads_found: number;
  avg_comments: number | null; mechanic_hits: number | null; niche: string | null;
};

const NICHE: Record<string, { label: string; icon: ComponentType<{ className?: string; style?: React.CSSProperties }>; on: boolean; hint: string }> = {
  spotify_promo: { label: "Таргет · Spotify-промо", icon: SiSpotify, on: true, hint: "🎯 НАШ ТАРГЕТ. Просуває музику на Spotify/стрімінгах — його коментатори це артисти, що шукають просування (гарячі ліди)." },
  viral_video: { label: "Вірусне відео", icon: Film, on: false, hint: "Продає вірусні відео/reels/зйомки контенту. Коментатори — контент-креатори, а не музиканти. НЕ таргет." },
  producer_edu: { label: "Продюсер-освіта", icon: SlidersHorizontal, on: false, hint: "Вчить зводити/продюсувати (FL Studio, mixing, mastering). Коментатори — продюсери, не промо-ліди. НЕ таргет." },
  ig_growth: { label: "IG-ріст", icon: SiInstagram, on: false, hint: "Вчить рости в Instagram. Про соцмережі, не про Spotify-стрімінг. НЕ таргет." },
  artist: { label: "Артист", icon: Music, on: false, hint: "Сам виконавець/артист. Це радше ЛІД, ніж джерело лідів. НЕ таргет як сід." },
  other: { label: "інше", icon: Minus, on: false, hint: "Нішу не розпізнано за біо/постами — не потрапив у жоден чіткий тип. Точно не таргет." },
};

async function getData() {
  const rows = <T extends Record<string, unknown>>(sql: string) => pool.query<T>(sql).then((r) => r.rows).catch(() => [] as T[]);
  const [creators, stats] = await Promise.all([
    rows<Creator>(`SELECT ig_username, full_name, followers, bio, category, score, status, discovered_from, leads_found, avg_comments, mechanic_hits, niche
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
            <SiSpotify style={{ color: "#1db954" }} className="h-6 w-6" /> Spotify · Креатори
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Джерела лідів — промо-акаунти в Instagram зі Spotify-механікою коментарів. Схвалюй найкращі, кожен = сотні нових лідів.
          </p>
        </div>

        <SpotifyTabs />

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
            <div className="mb-1 flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]/50 px-4 py-2.5 text-[11px] text-[var(--text-muted)]">
              <span className="font-semibold text-[var(--text)]">Як читати:</span>
              <span>💬 <b className="text-[var(--text)]">сер. коментів/пост</b> — механіка збору лідів (зелений ≥100)</span>
              <span>⚡ <b className="text-[var(--text)]">captions фармлять коментарі</b></span>
              <span><b className="text-[var(--text)]">скор</b> — релевантність як Spotify-промо-джерела (≥60 = топ)</span>
            </div>
            {creators.map((c) => (
              <div key={c.ig_username} className={`flex items-start gap-4 rounded-xl border bg-[var(--bg-card)] px-4 py-3 ${c.niche === "spotify_promo" ? "border-[#1db954]/40 shadow-[inset_3px_0_0_0_#1db954]" : "border-[var(--border)]"}`}>
                <a href={`https://instagram.com/${c.ig_username}`} target="_blank" rel="noreferrer" title="Відкрити канал в Instagram"
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#e1306c]/10 transition-colors hover:bg-[#e1306c]/25">
                  <SiInstagram className="h-4 w-4 text-[#e1306c]" />
                </a>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <a href={`https://instagram.com/${c.ig_username}`} target="_blank" rel="noreferrer" className="font-semibold hover:text-[var(--accent)]">
                      {c.full_name || c.ig_username}
                    </a>
                    <span className="text-xs text-[var(--text-muted)]">@{c.ig_username}</span>
                    {(() => { const nm = NICHE[c.niche ?? "other"] ?? NICHE.other; const Ic = nm.icon; return (
                      <span title={nm.hint} className={`inline-flex cursor-help items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${nm.on ? "bg-[#1db954] text-white shadow-[0_0_0_1px_rgba(29,185,84,0.3)]" : "bg-[var(--bg-hover)] text-[var(--text-muted)]"}`}>
                        <Ic className="h-3 w-3" /> {nm.label}
                        <span className="opacity-60">ⓘ</span>
                      </span>
                    ); })()}
                  </div>
                  <div className="mt-0.5 whitespace-pre-line text-xs leading-snug text-[var(--text-muted)]">
                    {c.bio || <span className="italic">без біо</span>}
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
                <div className="flex-shrink-0 text-center" title="скор релевантності як Spotify-промо-джерела (0–100). ≥60 = топ">
                  <span className={`inline-block rounded-md px-2 py-1 text-xs font-bold tabular-nums ${c.score >= 60 ? "bg-[#1db954]/15 text-[#1db954]" : c.score >= 30 ? "bg-[#fbbf24]/15 text-[#fbbf24]" : "bg-[var(--bg-hover)] text-[var(--text-muted)]"}`}>
                    {c.score}
                  </span>
                  <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">скор</div>
                </div>
                <a href={`https://instagram.com/${c.ig_username}`} target="_blank" rel="noreferrer" title="Відкрити канал в Instagram"
                  className="flex flex-shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--text-muted)] transition-colors hover:border-[#e1306c]/60 hover:text-[#e1306c]">
                  <ExternalLink className="h-3.5 w-3.5" /> <span className="hidden lg:inline">Канал</span>
                </a>
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
