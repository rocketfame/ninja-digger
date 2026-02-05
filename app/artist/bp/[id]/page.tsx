import Link from "next/link";
import { query } from "@/lib/db";
import { notFound } from "next/navigation";

type ArtistV2 = {
  artist_beatport_id: string;
  artist_name: string | null;
  first_seen: string | null;
  last_seen: string | null;
  total_days_in_charts: number | null;
  total_chart_entries: number | null;
  avg_position: string | null;
  best_position: number | null;
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
  try {
    const rows = await query<ArtistV2>(
      `SELECT am.artist_beatport_id, am.artist_name, am.first_seen::text, am.last_seen::text,
              am.total_days_in_charts, am.total_chart_entries, am.avg_position::text, am.best_position,
              ls.segment, ls.score::text, ls.signals
       FROM artist_metrics am
       LEFT JOIN lead_scores ls ON ls.artist_beatport_id = am.artist_beatport_id
       WHERE am.artist_beatport_id = $1`,
      [id]
    );
    artist = rows[0] ?? null;
  } catch {
    artist = null;
  }

  if (!artist) notFound();

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
        <h1 className="mb-4 text-xl font-semibold">{artist.artist_name ?? artist.artist_beatport_id}</h1>
        <p className="mb-2 text-sm text-stone-500">Beatport ID: {artist.artist_beatport_id}</p>

        <dl className="space-y-2 text-sm">
          <div><dt className="font-medium text-stone-500">Segment</dt><dd>{artist.segment ?? "—"}</dd></div>
          <div><dt className="font-medium text-stone-500">Score</dt><dd>{artist.score ?? "—"}</dd></div>
          <div><dt className="font-medium text-stone-500">First seen</dt><dd>{artist.first_seen ?? "—"}</dd></div>
          <div><dt className="font-medium text-stone-500">Last seen</dt><dd>{artist.last_seen ?? "—"}</dd></div>
          <div><dt className="font-medium text-stone-500">Days in charts</dt><dd>{artist.total_days_in_charts ?? "—"}</dd></div>
          <div><dt className="font-medium text-stone-500">Chart entries</dt><dd>{artist.total_chart_entries ?? "—"}</dd></div>
          <div><dt className="font-medium text-stone-500">Avg position</dt><dd>{artist.avg_position ?? "—"}</dd></div>
          <div><dt className="font-medium text-stone-500">Best position</dt><dd>{artist.best_position ?? "—"}</dd></div>
        </dl>

        {artist.signals && Object.keys(artist.signals).length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-medium text-stone-500">Signals</h2>
            <pre className="overflow-auto rounded bg-stone-100 p-3 text-xs">
              {JSON.stringify(artist.signals, null, 2)}
            </pre>
          </section>
        )}
      </main>
    </div>
  );
}
