import { pool } from "@/lib/db";
import { NavBar } from "@/app/components/NavBar";
import { Music2, Mail, Sparkles, AtSign } from "lucide-react";

export const dynamic = "force-dynamic";

type Lead = {
  ig_username: string; full_name: string | null; email: string | null;
  spotify_url: string | null; soundcloud_url: string | null; source_post: string | null; enriched_at: string | null;
};

async function getData() {
  const one = <T extends Record<string, unknown>>(sql: string) => pool.query<T>(sql).then((r) => r.rows[0]).catch(() => undefined);
  const [stats, rows] = await Promise.all([
    one<{ total: number; emails: number; enriched: number; sources: number; spotify: number }>(
      `SELECT COUNT(*)::int total, COUNT(email)::int emails, COUNT(enriched_at)::int enriched,
              COUNT(DISTINCT source_post)::int sources, COUNT(spotify_url)::int spotify
       FROM spotify_leads`
    ),
    pool.query<Lead>(
      `SELECT ig_username, full_name, email, spotify_url, soundcloud_url, source_post, enriched_at::text
       FROM spotify_leads ORDER BY (email IS NOT NULL) DESC, created_at DESC LIMIT 100`
    ).then((r) => r.rows).catch(() => [] as Lead[]),
  ]);
  return { stats, rows };
}

export default async function SpotifyLeadsPage() {
  const { stats, rows } = await getData();
  const n = (x: number | undefined) => (x ?? 0).toLocaleString("uk-UA");

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Music2 className="h-6 w-6 text-[#1db954]" /> Spotify Leads</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Коментатори промо-креаторів в Instagram — гарячі ліди, що шукають просування.</p>
          </div>
          <a href="/api/segments/spotify/export?withEmail=1" download
            className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]">
            <Mail className="h-4 w-4" /> Експорт email
          </a>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3.5">
            <div className="flex items-center gap-1.5"><AtSign className="h-3.5 w-3.5 text-[var(--text-muted)]" /><span className="text-2xl font-bold tabular-nums">{n(stats?.total)}</span></div>
            <div className="mt-0.5 text-xs text-[var(--text-muted)]">Лідів зібрано</div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3.5">
            <div className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-[#60a5fa]" /><span className="text-2xl font-bold tabular-nums text-[#60a5fa]">{n(stats?.emails)}</span></div>
            <div className="mt-0.5 text-xs text-[var(--text-muted)]">З email</div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3.5">
            <div className="flex items-center gap-1.5"><Music2 className="h-3.5 w-3.5 text-[#1db954]" /><span className="text-2xl font-bold tabular-nums text-[#1db954]">{n(stats?.spotify)}</span></div>
            <div className="mt-0.5 text-xs text-[var(--text-muted)]">Зі Spotify</div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3.5">
            <div className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-[#fbbf24]" /><span className="text-2xl font-bold tabular-nums">{n(stats?.enriched)}</span></div>
            <div className="mt-0.5 text-xs text-[var(--text-muted)]">Збагачено</div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
          <table className="w-full text-left text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              <tr className="border-b border-[var(--border)]">
                <th className="px-4 py-3 font-medium">Instagram</th>
                <th className="px-4 py-3 font-medium">Імʼя</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Профілі</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-[var(--text-muted)]">Поки порожньо. Збір коментаторів триває…</td></tr>
              ) : rows.map((r) => (
                <tr key={r.ig_username} className="border-b border-[var(--border)]/50 hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5">
                    <a href={`https://instagram.com/${r.ig_username}`} target="_blank" rel="noreferrer" className="font-medium text-[var(--text)] hover:text-[var(--accent)]">@{r.ig_username}</a>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--text-muted)]">{r.full_name || "—"}</td>
                  <td className="px-4 py-2.5">{r.email ? <span className="text-[#60a5fa]">{r.email}</span> : <span className="text-[var(--text-muted)]">—</span>}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {r.spotify_url && <a href={r.spotify_url} target="_blank" rel="noreferrer" className="mr-2 text-[#1db954]">Spotify</a>}
                    {r.soundcloud_url && <a href={r.soundcloud_url} target="_blank" rel="noreferrer" className="text-[#ff7700]">SoundCloud</a>}
                    {!r.spotify_url && !r.soundcloud_url && <span className="text-[var(--text-muted)]">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-[var(--text-muted)]">Показано перші 100 (з email — вгорі). Email/Spotify/SoundCloud заповнюються на етапі збагачення.</p>
      </main>
    </div>
  );
}
