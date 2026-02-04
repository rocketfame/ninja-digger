import Link from "next/link";
import { query } from "@/lib/db";
import { notFound } from "next/navigation";
import { getEnrichment } from "@/enrich/bio";
import { AddNoteForm } from "./AddNoteForm";
import { EnrichmentForm } from "./EnrichmentForm";

type ArtistInfo = {
  artist_id: number;
  artist_name: string;
  segment: string | null;
  score: string | null;
  appearances: number;
  first_seen: string | null;
  last_seen: string | null;
};

type ChartRow = {
  source_slug: string;
  chart_date: string;
  position: number;
  chart_type: string | null;
  genre: string | null;
  track_title: string;
  label_name: string | null;
};

type NoteRow = {
  id: number;
  content: string;
  created_at: string;
};

export const dynamic = "force-dynamic";

export default async function ArtistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const artistId = parseInt(id, 10);
  if (Number.isNaN(artistId)) notFound();

  let artist: ArtistInfo | null = null;
  let chartHistory: ChartRow[] = [];
  let notes: NoteRow[] = [];

  try {
    const artistRows = await query<ArtistInfo>(
      `SELECT a.id AS artist_id, a.name AS artist_name, ls.segment, ls.score::text AS score,
              acs.appearances, acs.first_seen::text AS first_seen, acs.last_seen::text AS last_seen
       FROM artists a
       LEFT JOIN lead_scores ls ON ls.artist_id = a.id
       LEFT JOIN artist_chart_stats acs ON acs.artist_id = a.id
       WHERE a.id = $1`,
      [artistId]
    );
    artist = artistRows[0] ?? null;

    if (artist) {
      chartHistory = await query<ChartRow>(
        `SELECT s.slug AS source_slug, ce.chart_date::text AS chart_date, ce.position,
                ce.chart_type, ce.genre, t.title AS track_title, l.name AS label_name
         FROM chart_entries ce
         JOIN tracks t ON t.id = ce.track_id
         JOIN artists a ON a.id = t.artist_id
         LEFT JOIN labels l ON l.id = t.label_id
         JOIN sources s ON s.id = ce.source_id
         WHERE a.id = $1
         ORDER BY ce.chart_date DESC, ce.position`,
        [artistId]
      );

      notes = await query<NoteRow>(
        `SELECT id, content, created_at::text AS created_at
         FROM artist_notes
         WHERE artist_id = $1
         ORDER BY created_at DESC`,
        [artistId]
      );
    }
  } catch {
    artist = null;
  }

  let enrichment: Awaited<ReturnType<typeof getEnrichment>> = null;
  if (artist) {
    try {
      enrichment = await getEnrichment(artistId);
    } catch {
      enrichment = null;
    }
  }

  try {
    if (!artist) {
    artist = null;
  }

  if (!artist) notFound();

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white px-4 py-3">
        <nav className="flex items-center gap-4">
          <Link href="/" className="text-stone-600 hover:text-stone-900">
            Home
          </Link>
          <span className="text-stone-400">|</span>
          <Link href="/leads" className="text-stone-600 hover:text-stone-900">
            Leads
          </Link>
          <span className="text-stone-400">|</span>
          <span className="font-medium">{artist.artist_name}</span>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-4 text-xl font-semibold">{artist.artist_name}</h1>

        <section className="mb-6 rounded border border-stone-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-stone-500">Summary</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <dt className="text-stone-500">Segment</dt>
            <dd>{artist.segment ?? "—"}</dd>
            <dt className="text-stone-500">Score</dt>
            <dd>{artist.score ?? "—"}</dd>
            <dt className="text-stone-500">Appearances</dt>
            <dd>{artist.appearances ?? 0}</dd>
            <dt className="text-stone-500">First / Last seen</dt>
            <dd>
              {artist.first_seen ?? "—"} / {artist.last_seen ?? "—"}
            </dd>
          </dl>
        </section>

        <section className="mb-6 rounded border border-stone-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-stone-500">Chart history</h2>
          {chartHistory.length === 0 ? (
            <p className="text-sm text-stone-500">No chart entries.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-100">
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Source</th>
                    <th className="px-3 py-2 font-medium">Pos</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Track</th>
                    <th className="px-3 py-2 font-medium">Label</th>
                  </tr>
                </thead>
                <tbody>
                  {chartHistory.map((row, i) => (
                    <tr
                      key={`${row.chart_date}-${row.position}-${i}`}
                      className="border-b border-stone-100"
                    >
                      <td className="px-3 py-2">{row.chart_date}</td>
                      <td className="px-3 py-2">{row.source_slug}</td>
                      <td className="px-3 py-2">{row.position}</td>
                      <td className="px-3 py-2">{row.chart_type ?? "—"}</td>
                      <td className="px-3 py-2">{row.track_title}</td>
                      <td className="px-3 py-2">{row.label_name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded border border-stone-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-stone-500">Notes</h2>
          <AddNoteForm artistId={artistId} />
          <ul className="mt-4 space-y-2">
            {notes.map((n) => (
              <li
                key={n.id}
                className="rounded bg-stone-50 px-3 py-2 text-sm text-stone-800"
              >
                <p className="whitespace-pre-wrap">{n.content}</p>
                <p className="mt-1 text-xs text-stone-400">{n.created_at}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
