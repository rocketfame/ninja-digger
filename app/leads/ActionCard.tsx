import { unstable_cache } from "next/cache";
import { getSegmentStats, getSegmentRows } from "@/lib/emailSegments";
import { SegmentPreview } from "@/app/components/SegmentPreview";

// These are heavy COUNT(DISTINCT) queries that change slowly — cache for 5 min.
const cachedStats = unstable_cache(() => getSegmentStats(), ["bp-segment-stats"], { revalidate: 300, tags: ["leads"] });
const cachedGems = unstable_cache(() => getSegmentRows("gems"), ["bp-gems-rows"], { revalidate: 300, tags: ["leads"] });

/**
 * Big "ready to send" action card for Beatport leads — the same visual language
 * as the SoundCloud page's result panel: headline email count, the quality
 * subset (💎 gems), one-click CSV export, and a few example contacts.
 */
export async function BeatportActionCard({ withEmails }: { withEmails: number }) {
  const stats = await cachedStats().catch(() => []);
  const gems = stats.find((s) => s.type === "gems")?.count ?? 0;
  const examples = (await cachedGems().catch(() => [])).slice(0, 5);

  const btn = "flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-colors";
  return (
    <div className="mb-6 grid gap-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 sm:grid-cols-[1fr_1.2fr]">
      {/* Left: headline */}
      <div className="flex flex-col justify-center text-center sm:border-r sm:border-[var(--border)] sm:pr-5">
        <div className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Готові до розсилки</div>
        <div className="my-1 text-5xl font-bold tabular-nums text-[var(--accent)]">{withEmails.toLocaleString("uk-UA")}</div>
        <div className="text-sm text-[var(--text-muted)]">
          з email · <span className="font-semibold text-[#fbbf24]">💎 {gems.toLocaleString("uk-UA")}</span> перлин
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <a href="/api/segments/email/export?type=all_email" download className={`${btn} bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]`}>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4" /></svg>
            Завантажити всі з email
          </a>
          <a href="/api/segments/email/export?type=gems" download className={`${btn} border border-[#fbbf24]/50 text-[#fbbf24] hover:bg-[#fbbf24]/10`}>
            💎 Тільки перлини ({gems.toLocaleString("uk-UA")})
          </a>
          <SegmentPreview
            previewUrl="/api/segments/email/export?type=all_email&format=json&limit=200"
            downloadUrl="/api/segments/email/export?type=all_email"
            count={withEmails}
            extraColumns={[{ header: "Tier", key: "tier" }, { header: "Роль", key: "role" }, { header: "Сегмент", key: "segment" }]}
          />
        </div>
      </div>

      {/* Right: examples */}
      <div className="text-left">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Приклад із перлин</div>
        {examples.length > 0 ? (
          <ul className="space-y-1.5 text-xs">
            {examples.map((r, i) => (
              <li key={i} className="truncate">
                <span className="font-medium">{r.artist_name || r.artist_beatport_id}</span>
                <span className="text-[var(--text-muted)]"> · {r.email}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">Перлин поки нема, зʼявляться щойно набереться база tier-A з email.</p>
        )}
      </div>
    </div>
  );
}
