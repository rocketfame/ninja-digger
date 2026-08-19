import Link from "next/link";
import { NavBar } from "@/app/components/NavBar";
import { pool } from "@/lib/db";
import { BarChart3, Send, Trophy, ArrowRight } from "lucide-react";
import { SiBeatport, SiSoundcloud, SiSpotify } from "react-icons/si";

export const dynamic = "force-dynamic";

async function one<T extends Record<string, unknown>>(sql: string): Promise<T | null> {
  return pool.query<T>(sql).then((r) => r.rows[0] ?? null).catch(() => null);
}

export default async function HomePage() {
  const [bp, sc, sp, out] = await Promise.all([
    one<{ total: number; emails: number; gems: number }>(
      `SELECT
         (SELECT COUNT(*)::int FROM lead_scores) total,
         (SELECT COUNT(DISTINCT ac.artist_beatport_id)::int FROM artist_contacts ac
            WHERE ac.type='email' AND (ac.status IS NULL OR ac.status='ok')
              AND LOWER(TRIM(ac.value)) NOT IN (SELECT LOWER(email) FROM email_blacklist)) emails,
         0 gems`
    ),
    one<{ artists: number; emails: number; gold: number }>(
      `SELECT
         COUNT(*) FILTER (WHERE track_count>=1)::int artists,
         COUNT(email) FILTER (WHERE track_count>=1)::int emails,
         COUNT(*) FILTER (WHERE track_count>=1 AND email IS NOT NULL AND COALESCE(email_status,'') NOT IN ('bounced','unsub') AND (opens>0 OR lead_status='Responded' OR delivered_at IS NOT NULL))::int gold
       FROM sc_artists`
    ),
    one<{ total: number; emails: number }>(`SELECT COUNT(*)::int total, COUNT(email)::int emails FROM spotify_leads`),
    one<{ sent_today: number; replied: number }>(
      `SELECT
         (SELECT COUNT(*)::int FROM outreach_events WHERE channel='email' AND (template_id LIKE 'email_touch_%' OR template_id LIKE 'sc_touch_%') AND sent_at >= CURRENT_DATE) sent_today,
         (SELECT COUNT(*)::int FROM outreach_events WHERE outcome='replied' AND sent_at >= CURRENT_DATE - 7) replied`
    ),
  ]);

  const stat = (n: number | undefined | null) => (n ?? 0).toLocaleString("uk-UA");

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />
      <main className="mx-auto max-w-5xl px-5 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">Ninja Digger</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Панель лідогену — Beatport та SoundCloud, розсилка й аналітика.</p>
        </div>

        {/* Main channel tiles */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/leads" className="group rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 transition-all hover:border-[var(--accent)]/50">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/10"><SiBeatport className="h-5 w-5" style={{color:"#a3ff12"}} /></span>
                <span className="text-lg font-semibold">Beatport Leads</span>
              </div>
              <ArrowRight className="h-5 w-5 text-[var(--text-muted)] transition-transform group-hover:translate-x-1" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><div className="text-2xl font-bold tabular-nums">{stat(bp?.total)}</div><div className="text-xs text-[var(--text-muted)]">лідів у базі</div></div>
              <div><div className="text-2xl font-bold tabular-nums text-[#60a5fa]">{stat(bp?.emails)}</div><div className="text-xs text-[var(--text-muted)]">з email</div></div>
            </div>
          </Link>

          <Link href="/sc-leads" className="group rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 transition-all hover:border-[var(--accent)]/50">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/10"><SiSoundcloud className="h-5 w-5" style={{color:"#ff5500"}} /></span>
                <span className="text-lg font-semibold">SoundCloud Leads</span>
              </div>
              <ArrowRight className="h-5 w-5 text-[var(--text-muted)] transition-transform group-hover:translate-x-1" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><div className="text-2xl font-bold tabular-nums">{stat(sc?.artists)}</div><div className="text-xs text-[var(--text-muted)]">артистів</div></div>
              <div><div className="text-2xl font-bold tabular-nums text-[#60a5fa]">{stat(sc?.emails)}</div><div className="text-xs text-[var(--text-muted)]">з email</div></div>
              <div><div className="flex items-center gap-1 text-2xl font-bold tabular-nums text-[#fbbf24]"><Trophy className="h-4 w-4" />{stat(sc?.gold)}</div><div className="text-xs text-[var(--text-muted)]">золото</div></div>
            </div>
          </Link>

          <Link href="/spotify-leads" className="group rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 transition-all hover:border-[#1db954]/50">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1db954]/10"><SiSpotify className="h-5 w-5" style={{color:"#1db954"}} /></span>
                <span className="text-lg font-semibold">Spotify Leads</span>
              </div>
              <ArrowRight className="h-5 w-5 text-[var(--text-muted)] transition-transform group-hover:translate-x-1" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><div className="text-2xl font-bold tabular-nums">{stat(sp?.total)}</div><div className="text-xs text-[var(--text-muted)]">лідів (IG)</div></div>
              <div><div className="text-2xl font-bold tabular-nums text-[#60a5fa]">{stat(sp?.emails)}</div><div className="text-xs text-[var(--text-muted)]">з email</div></div>
            </div>
          </Link>
        </div>

        {/* Outreach + analytics row */}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
            <div className="mb-4 flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#4ade80]/10"><Send className="h-5 w-5 text-[#4ade80]" /></span>
              <span className="text-lg font-semibold">Розсилка</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><div className="text-2xl font-bold tabular-nums text-[#4ade80]">{stat(out?.sent_today)}</div><div className="text-xs text-[var(--text-muted)]">надіслано сьогодні</div></div>
              <div><div className="text-2xl font-bold tabular-nums">{stat(out?.replied)}</div><div className="text-xs text-[var(--text-muted)]">відповіли (7д)</div></div>
            </div>
          </div>

          <Link href="/analytics" className="group flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 transition-all hover:border-[var(--accent)]/50">
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#c084fc]/10"><BarChart3 className="h-5 w-5 text-[#c084fc]" /></span>
              <div>
                <div className="text-lg font-semibold">Аналітика</div>
                <div className="text-xs text-[var(--text-muted)]">воронки, конверсії, канали</div>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-[var(--text-muted)] transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </main>
    </div>
  );
}
