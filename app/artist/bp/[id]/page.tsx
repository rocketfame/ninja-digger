import Link from "next/link";
import { query } from "@/lib/db";
import { notFound } from "next/navigation";
import { ArtistLeadCard } from "./ArtistLeadCard";

type ArtistV2 = {
  artist_beatport_id: string;
  artist_name: string | null;
  artist_slug: string | null;
  first_seen: string | null;
  last_seen: string | null;
  total_days_in_charts: number | null;
  total_chart_entries: number | null;
  avg_position: string | null;
  best_position: number | null;
  genres: string[] | null;
  segment: string | null;
  score: string | null;
  signals: Record<string, unknown> | null;
};

export const dynamic = "force-dynamic";

export default async function ArtistBeatportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!id) notFound();

  let artist: ArtistV2 | null = null;
  let profile: { status: string; notes: string | null } | null = null;
  let links: { type: string; url: string }[] = [];
  let contacts: { type: string; value: string }[] = [];
  try {
    const rows = await query<ArtistV2>(
      `SELECT am.artist_beatport_id, am.artist_name,
              (SELECT ce.artist_slug FROM chart_entries ce WHERE ce.artist_beatport_id = am.artist_beatport_id AND ce.artist_slug IS NOT NULL AND ce.artist_slug <> '' ORDER BY ce.snapshot_date DESC LIMIT 1) AS artist_slug,
              am.first_seen::text, am.last_seen::text,
              am.total_days_in_charts, am.total_chart_entries, am.avg_position::text, am.best_position,
              am.genres, ls.segment, ls.score::text, ls.signals
       FROM artist_metrics am
       LEFT JOIN lead_scores ls ON ls.artist_beatport_id = am.artist_beatport_id
       WHERE am.artist_beatport_id = $1`,
      [id]
    );
    artist = rows[0] ?? null;
    if (artist) {
      const profRows = await query<{ status: string; notes: string | null }>(
        `SELECT status, notes FROM lead_profiles WHERE artist_beatport_id = $1`,
        [id]
      );
      profile = profRows[0] ?? null;
      links = await query<{ type: string; url: string }>(
        `SELECT type, url FROM artist_links WHERE artist_beatport_id = $1 ORDER BY type`,
        [id]
      );
      contacts = await query<{ type: string; value: string }>(
        `SELECT type, value FROM artist_contacts WHERE artist_beatport_id = $1`,
        [id]
      );
    }
  } catch {
    artist = null;
  }

  if (!artist) notFound();

  const beatportUrl =
    `https://www.beatport.com/artist/${(artist.artist_slug || "artist").replace(/^\/+|\/+$/g, "")}/${artist.artist_beatport_id}`;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white px-4 py-3">
        <nav className="flex items-center gap-4">
          <Link href="/" className="text-stone-600 hover:text-stone-900">Home</Link>
          <span className="text-stone-400">|</span>
          <Link href="/leads" className="text-stone-600 hover:text-stone-900">Leads</Link>
          <span className="text-stone-400">|</span>
          <span className="font-medium">{artist.artist_name ?? artist.artist_beatport_id}</span>
        </nav>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        <ArtistLeadCard
          artist={artist}
          beatportUrl={beatportUrl}
          initialProfile={profile}
          links={links}
          contacts={contacts}
        />
      </main>
    </div>
  );
}
