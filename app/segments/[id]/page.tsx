import Link from "next/link";
import { query } from "@/lib/db";
import { notFound } from "next/navigation";
import { RunEnrichmentButton } from "./RunEnrichmentButton";

type SegmentRow = {
  id: string;
  name: string;
  source_type: string;
  source_url: string | null;
  notes: string | null;
  created_at: string;
};

type SegmentItemRow = {
  artist_name: string;
  artist_url: string | null;
  artist_beatport_id: string | null;
  track_name: string | null;
  rank: number | null;
};

export const dynamic = "force-dynamic";

export default async function SegmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!id) notFound();

  let segment: SegmentRow | null = null;
  let items: SegmentItemRow[] = [];
  try {
    const segRows = await query<SegmentRow>(
      `SELECT id, name, source_type, source_url, notes, created_at::text AS created_at
       FROM segments WHERE id = $1`,
      [id]
    );
    segment = segRows[0] ?? null;
    if (segment) {
      items = await query<SegmentItemRow>(
        `SELECT artist_name, artist_url, artist_beatport_id, track_name, rank
         FROM segment_items WHERE segment_id = $1 ORDER BY rank NULLS LAST, artist_name`,
        [id]
      );
    }
  } catch {
    segment = null;
  }

  if (!segment) notFound();

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white px-4 py-3">
        <nav className="flex items-center gap-4">
          <Link href="/" className="text-stone-600 hover:text-stone-900">Home</Link>
          <span className="text-stone-400">|</span>
          <Link href="/leads" className="text-stone-600 hover:text-stone-900">Leads</Link>
          <span className="text-stone-400">|</span>
          <span className="font-medium">{segment.name}</span>
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{segment.name}</h1>
            <p className="text-sm text-stone-500">
              {segment.source_type} · {items.length} items
              {segment.source_url && (
                <>
                  {" · "}
                  <a
                    href={segment.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-stone-600 underline hover:text-stone-800"
                  >
                    Source
                  </a>
                </>
              )}
            </p>
            {segment.notes && (
              <p className="mt-2 text-sm text-stone-600">{segment.notes}</p>
            )}
          </div>
          <RunEnrichmentButton segmentId={id} />
        </div>

        <div className="rounded border border-stone-200 bg-white overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-100">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Artist</th>
                <th className="px-3 py-2 font-medium">Track</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row, i) => (
                <tr key={i} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="px-3 py-2 text-stone-500">{row.rank ?? "—"}</td>
                  <td className="px-3 py-2">
                    {row.artist_beatport_id ? (
                      <Link
                        href={`/artist/bp/${row.artist_beatport_id}`}
                        className="font-medium text-stone-900 underline hover:no-underline"
                      >
                        {row.artist_name}
                      </Link>
                    ) : row.artist_url ? (
                      <a
                        href={row.artist_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-stone-700 underline hover:no-underline"
                      >
                        {row.artist_name}
                      </a>
                    ) : (
                      row.artist_name
                    )}
                  </td>
                  <td className="px-3 py-2 text-stone-600">{row.track_name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
