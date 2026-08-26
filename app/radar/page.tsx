import { pool } from "@/lib/db";
import { NavBar } from "@/app/components/NavBar";
import { Flame, Mail } from "lucide-react";
import { SiReddit, SiYoutube, SiInstagram, SiSpotify } from "react-icons/si";
import Link from "next/link";
import type { ComponentType } from "react";

export const dynamic = "force-dynamic";

type Row = { source: string; total: number; emails: number; hot: number };
type Lead = {
  source: string; handle: string; name: string | null; email: string | null;
  spotify_url: string | null; intent_signal: string | null; source_url: string | null;
  heat_score: number; followers: number | null;
};

const SOURCES: { key: string; label: string; icon: ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string; href?: string; note?: string }[] = [
  { key: "instagram", label: "Instagram", icon: SiInstagram, color: "#e1306c", href: "/spotify-leads", note: "IG-коментатори (на сторінці Spotify)" },
  { key: "reddit", label: "Reddit", icon: SiReddit, color: "#ff4500", note: "самопромо-саби, свіжі релізи" },
  { key: "youtube", label: "YouTube", icon: SiYoutube, color: "#ff0000", note: "booking-емейли з описів каналів" },
  { key: "playlisting", label: "Playlisting", icon: SiSpotify, color: "#1db954", note: "SubmitHub/Groover — платять за промо" },
];

const num = (n: number | null | undefined) => (n ?? 0).toLocaleString("uk-UA");

async function getData(source?: string) {
  const rows = await pool
    .query<Row>(`SELECT source, COUNT(*)::int total, COUNT(email)::int emails, COUNT(*) FILTER (WHERE heat_score >= 70)::int hot FROM radar_leads GROUP BY source`)
    .then((r) => r.rows).catch(() => [] as Row[]);
  const ig = await pool
    .query<{ total: number; emails: number }>(`SELECT COUNT(*)::int total, COUNT(email)::int emails FROM spotify_leads`)
    .then((r) => r.rows[0]).catch(() => ({ total: 0, emails: 0 }));
  const where = source && source !== "all" ? `WHERE source = $1` : "";
  const params = source && source !== "all" ? [source] : [];
  const hot = await pool
    .query<Lead>(
      `SELECT source, handle, name, email, spotify_url, intent_signal, source_url, heat_score, followers
       FROM radar_leads ${where} ORDER BY heat_score DESC, COALESCE(email_found_at, created_at) DESC LIMIT 60`,
      params
    )
    .then((r) => r.rows).catch(() => [] as Lead[]);
  return { rows, ig, hot };
}

export default async function RadarPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const { source } = await searchParams;
  const active = source ?? "all";
  const { rows, ig, hot } = await getData(active);
  const byKey = (k: string) => rows.find((r) => r.source === k);

  return (
    <div className="min-h-screen bg-[var(--bg-page)]">
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-center gap-3">
          <Flame className="h-7 w-7" style={{ color: "#ff4d00" }} />
          <div>
            <h1 className="text-2xl font-bold text-[var(--text)]">Radar — гарячі ліди</h1>
            <p className="text-sm text-[var(--text-muted)]">Артисти з активною промо-інтенцією, зібрані з різних джерел і відсортовані за «теплом».</p>
          </div>
        </div>

        {/* Source cards */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {SOURCES.map((s) => {
            const st = s.key === "instagram" ? { total: ig.total, emails: ig.emails, hot: 0 } : byKey(s.key) ?? { total: 0, emails: 0, hot: 0 };
            const Icon = s.icon;
            const card = (
              <div className="h-full rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 transition-colors hover:border-[var(--text-muted)]/40">
                <div className="mb-2 flex items-center gap-2">
                  <Icon className="h-5 w-5" style={{ color: s.color }} />
                  <span className="font-semibold text-[var(--text)]">{s.label}</span>
                </div>
                <div className="text-2xl font-bold text-[var(--text)]">{num(st.total)}</div>
                <div className="mt-1 text-xs text-[var(--text-muted)]">
                  📧 {num(st.emails)}{s.key !== "instagram" ? ` · 🔥 ${num(st.hot)}` : ""}
                </div>
                <div className="mt-2 text-[11px] leading-tight text-[var(--text-muted)]/80">{s.note}</div>
                {!s.href && st.emails > 0 && (
                  <a
                    href={`/api/segments/radar/export?source=${s.key}&format=csv`}
                    download
                    className="mt-2 inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--bg-page)]"
                  >
                    📥 Сегмент ({num(st.emails)} з email)
                  </a>
                )}
              </div>
            );
            return s.href ? <Link key={s.key} href={s.href}>{card}</Link> : <div key={s.key}>{card}</div>;
          })}
        </div>

        {/* Filter tabs */}
        <div className="mb-4 flex flex-wrap gap-2">
          {[{ k: "all", l: "Всі джерела" }, { k: "reddit", l: "Reddit" }, { k: "youtube", l: "YouTube" }, { k: "playlisting", l: "Playlisting" }].map((t) => (
            <Link
              key={t.k}
              href={t.k === "all" ? "/radar" : `/radar?source=${t.k}`}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                active === t.k ? "bg-[var(--accent)] text-black" : "border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {t.l}
            </Link>
          ))}
        </div>

        {/* Hot list */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
          {hot.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--text-muted)]">
              Поки порожньо. Reddit/YouTube вмикаються ключами (REDDIT_CLIENT_ID/SECRET, YOUTUBE_API_KEY),
              Playlisting — браузерним інжестом. Щойно джерело активне — гарячі ліди зʼявляться тут.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {hot.map((l, i) => {
                const src = SOURCES.find((s) => s.key === l.source);
                const Icon = src?.icon ?? Flame;
                return (
                  <li key={`${l.source}-${l.handle}-${i}`} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex w-12 flex-shrink-0 items-center gap-1">
                      <Flame className="h-4 w-4" style={{ color: l.heat_score >= 70 ? "#ff4d00" : "var(--text-muted)" }} />
                      <span className="text-sm font-bold text-[var(--text)]">{l.heat_score}</span>
                    </div>
                    <Icon className="h-4 w-4 flex-shrink-0" style={{ color: src?.color ?? "var(--text-muted)" }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-[var(--text)]">{l.name || l.handle}</div>
                      <div className="truncate text-xs text-[var(--text-muted)]">{l.intent_signal}</div>
                    </div>
                    {l.email && (
                      <span className="hidden items-center gap-1 text-xs text-[var(--text-muted)] sm:flex">
                        <Mail className="h-3.5 w-3.5" /> {l.email}
                      </span>
                    )}
                    {l.spotify_url && (
                      <a href={l.spotify_url} target="_blank" rel="noreferrer" title="Spotify">
                        <SiSpotify className="h-4 w-4 flex-shrink-0" style={{ color: "#1db954" }} />
                      </a>
                    )}
                    {l.source_url && (
                      <a href={l.source_url} target="_blank" rel="noreferrer" className="text-xs text-[var(--accent)]">↗</a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
