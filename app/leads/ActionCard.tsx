import { unstable_cache } from "next/cache";
import { getSegmentStats, getSegmentRows } from "@/lib/emailSegments";
import { SendReadyCard } from "@/app/components/SendReadyCard";

// These are heavy COUNT(DISTINCT) queries that change slowly — cache for 5 min.
const cachedStats = unstable_cache(() => getSegmentStats(), ["bp-segment-stats"], { revalidate: 300, tags: ["leads"] });
const cachedGems = unstable_cache(() => getSegmentRows("gems"), ["bp-gems-rows"], { revalidate: 300, tags: ["leads"] });

/**
 * Beatport "Готові до розсилки" card — renders the shared SendReadyCard so it
 * looks identical to SoundCloud/Spotify. Adds the gems (perlyny) secondary
 * download and gem examples.
 */
export async function BeatportActionCard({ withEmails }: { withEmails: number }) {
  const stats = await cachedStats().catch(() => []);
  const gems = stats.find((s) => s.type === "gems")?.count ?? 0;
  const examples = (await cachedGems().catch(() => [])).slice(0, 5);

  return (
    <SendReadyCard
      count={withEmails}
      downloadUrl="/api/segments/email/export?type=all_email"
      downloadLabel="Завантажити всі з email"
      previewUrl="/api/segments/email/export?type=all_email&format=json&limit=200"
      previewColumns={[{ header: "Tier", key: "tier" }, { header: "Роль", key: "role" }, { header: "Сегмент", key: "segment" }]}
      subline={<>з email · <span className="font-semibold text-[#fbbf24]">💎 {gems.toLocaleString("uk-UA")}</span> перлин</>}
      examplesTitle="Приклад із перлин"
      emptyNote="Перлин поки нема, зʼявляться щойно набереться база tier-A з email."
      examples={examples.map((r) => ({ name: r.artist_name || r.artist_beatport_id, email: r.email }))}
      secondaryActions={
        <a href="/api/segments/email/export?type=gems" download
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-[#fbbf24]/50 px-5 py-2.5 text-sm font-semibold text-[#fbbf24] transition-colors hover:bg-[#fbbf24]/10">
          💎 Тільки перлини ({gems.toLocaleString("uk-UA")})
        </a>
      }
    />
  );
}
