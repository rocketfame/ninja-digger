import { pool } from "@/lib/db";
import { NavBar } from "@/app/components/NavBar";
import { Mail, AtSign, Users } from "lucide-react";
import { SiSpotify, SiSoundcloud } from "react-icons/si";
import Link from "next/link";
import type { ReactNode } from "react";
import { SegmentPreview } from "@/app/components/SegmentPreview";
import { SpotifyTabs } from "@/app/components/SpotifyTabs";

export const dynamic = "force-dynamic";

type SP = { withEmail?: string; source?: string };
type Lead = { ig_username: string; full_name: string | null; email: string | null };

async function getData(sp: SP) {
  const one = <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => pool.query<T>(sql, p).then((r) => r.rows[0]).catch(() => undefined);
  const conds: string[] = [];
  const params: string[] = [];
  if (sp.withEmail === "1") conds.push("email IS NOT NULL");
  if (sp.source) { params.push(sp.source); conds.push(`source_post = $${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const [stats, sources, seg, preview] = await Promise.all([
    one<{ total: number; emails: number; spotify: number; soundcloud: number }>(
      `SELECT COUNT(*)::int total, COUNT(email)::int emails, COUNT(spotify_url)::int spotify, COUNT(soundcloud_url)::int soundcloud FROM spotify_leads`
    ),
    pool.query<{ source_post: string; c: number }>(`SELECT source_post, COUNT(*)::int c FROM spotify_leads WHERE source_post IS NOT NULL GROUP BY 1 ORDER BY c DESC LIMIT 8`).then((r) => r.rows).catch(() => []),
    one<{ c: number; e: number }>(`SELECT COUNT(*)::int c, COUNT(email)::int e FROM spotify_leads ${where}`, params),
    pool.query<Lead>(`SELECT ig_username, full_name, email FROM spotify_leads ${where} ORDER BY (email IS NOT NULL) DESC, created_at DESC LIMIT 8`, params).then((r) => r.rows).catch(() => [] as Lead[]),
  ]);
  return { stats, sources, seg, preview };
}

function Card({ icon, label, value, color }: { icon: ReactNode; label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3.5">
      <div className="mb-0.5 flex items-center gap-1.5 text-[var(--text-muted)]">{icon}</div>
      <div className="text-2xl font-bold tabular-nums" style={color ? { color } : undefined}>{value}</div>
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
    </div>
  );
}

export default async function SpotifyLeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const d = await getData(sp);
  const n = (x: number | undefined) => (x ?? 0).toLocaleString("uk-UA");
  const qs = (extra: Partial<SP>) => {
    const m = { ...sp, ...extra };
    const parts = Object.entries(m).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
    return `/spotify-leads${parts.length ? `?${parts.join("&")}` : ""}`;
  };
  const exportUrl = `/api/segments/spotify/export${sp.withEmail === "1" ? "?withEmail=1" : ""}`;

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />
      <main className="mx-auto max-w-5xl px-5 py-10">
        <div className="mb-8">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><SiSpotify style={{ color: "#1db954" }} className="h-6 w-6" /> Spotify Leads</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Коментатори промо-креаторів в Instagram — гарячі ліди, що шукають просування.</p>
        </div>

        <SpotifyTabs />

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            <section>
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-card)] text-xs font-bold text-[var(--text-muted)]">1</span>
                <h2 className="text-sm font-semibold">Зібрано з Instagram</h2>
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <Card icon={<AtSign className="h-3.5 w-3.5" />} label="Лідів" value={n(d.stats?.total)} />
                <Card icon={<Mail className="h-3.5 w-3.5 text-[#60a5fa]" />} label="З email" value={n(d.stats?.emails)} color="#60a5fa" />
                <Card icon={<SiSpotify className="h-3.5 w-3.5" style={{ color: "#1db954" }} />} label="Spotify" value={n(d.stats?.spotify)} color="#1db954" />
                <Card icon={<SiSoundcloud className="h-3.5 w-3.5" style={{ color: "#ff5500" }} />} label="SoundCloud" value={n(d.stats?.soundcloud)} color="#ff5500" />
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-card)] text-xs font-bold text-[var(--text-muted)]">2</span>
                <h2 className="text-sm font-semibold">Контакт</h2>
              </div>
              <Link href={qs({ withEmail: sp.withEmail === "1" ? undefined : "1" })}
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${sp.withEmail === "1" ? "border-transparent" : "border-[var(--border)] hover:border-[var(--text-muted)]"}`}
                style={sp.withEmail === "1" ? { boxShadow: "inset 0 0 0 2px #60a5fa", background: "#60a5fa1a" } : undefined}>
                Лише з email
              </Link>
            </section>

            <section>
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-card)] text-xs font-bold text-[var(--text-muted)]">3</span>
                <h2 className="text-sm font-semibold">Джерела (креатори)</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {d.sources.length === 0 ? <span className="text-xs text-[var(--text-muted)]">Ще нема джерел.</span> :
                  d.sources.map((s) => {
                    const on = sp.source === s.source_post;
                    return (
                      <Link key={s.source_post} href={qs({ source: on ? undefined : s.source_post })}
                        className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-all ${on ? "border-transparent" : "border-[var(--border)] hover:border-[var(--text-muted)]"}`}
                        style={on ? { boxShadow: "inset 0 0 0 2px #1db954", background: "#1db9541a" } : undefined}>
                        <Users className="h-3 w-3" /> {s.source_post?.replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/$/, "") || s.source_post} · {s.c}
                      </Link>
                    );
                  })}
              </div>
              <p className="mt-3 text-[11px] text-[var(--text-muted)]">Email/Spotify/SoundCloud дотягуються на етапі збагачення профілів.</p>
            </section>
          </div>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 text-center">
              <div className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Готові до розсилки</div>
              <div className="my-2 text-5xl font-bold tabular-nums text-[var(--accent)]">{n(d.seg?.e)}</div>
              <div className="text-sm text-[var(--text-muted)]">з email · всього в сегменті <span className="font-semibold text-[var(--text)]">{n(d.seg?.c)}</span></div>
              <a href={`${exportUrl}${exportUrl.includes("?") ? "&" : "?"}withEmail=1`} download
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]">
                <Mail className="h-4 w-4" /> Завантажити {n(d.seg?.e)} з email
              </a>
              <SegmentPreview
                previewUrl={`${exportUrl}${exportUrl.includes("?") ? "&" : "?"}withEmail=1&format=json&limit=200`}
                downloadUrl={`${exportUrl}${exportUrl.includes("?") ? "&" : "?"}withEmail=1`}
                count={d.seg?.e ?? 0}
                accent="#1db954"
                extraColumns={[{ header: "Фоловери", key: "followers", num: true }, { header: "Spotify", key: "spotify", link: true }, { header: "SC", key: "soundcloud", link: true }, { header: "Сайт/лінк", key: "site", link: true }, { header: "Джерело", key: "source" }]}
              />
              {(sp.withEmail || sp.source) && (
                <Link href="/spotify-leads" className="mt-3 inline-block text-xs text-[var(--text-muted)] underline hover:text-[var(--text)]">скинути фільтри</Link>
              )}
              {d.preview.length > 0 && (
                <div className="mt-5 border-t border-[var(--border)] pt-4 text-left">
                  <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Приклад із сегмента</div>
                  <ul className="space-y-1.5 text-xs">
                    {d.preview.map((p) => (
                      <li key={p.ig_username} className="truncate">
                        <a href={`https://instagram.com/${p.ig_username}`} target="_blank" rel="noreferrer" className="font-medium hover:text-[var(--accent)]">{p.full_name || "@" + p.ig_username}</a>
                        {p.email && <span className="text-[var(--text-muted)]"> · {p.email}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
