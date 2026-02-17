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
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] bg-[var(--bg-header)] px-4 py-3">
        <nav className="flex items-center gap-4">
          <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--text)]">Головна</Link>
          <span className="text-[var(--text-muted)]">|</span>
          <Link href="/leads" className="text-[var(--text-muted)] hover:text-[var(--text)]">Ліди</Link>
          <span className="text-[var(--text-muted)]">|</span>
          <span className="font-medium">{segment.name}</span>
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-6">
          <div>
            <h1 className="text-xl font-semibold">{segment.name}</h1>
            <p className="text-sm text-[var(--text-muted)]">
              {segment.source_type} · {items.length} записів
              {segment.source_url && (
                <>
                  {" · "}
                  <a
                    href={segment.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--accent)] underline hover:no-underline"
                  >
                    Джерело
                  </a>
                </>
              )}
            </p>
            {segment.notes && (
              <p className="mt-2 text-sm text-[var(--text-muted)]">{segment.notes}</p>
            )}
          </div>

          <section id="enrich" className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <h2 className="mb-3 text-base font-semibold text-[var(--text)]">Пошук контактів (енрічмент)</h2>
            <RunEnrichmentButton segmentId={id} />
          </section>
        </div>

        <div className="rounded border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-table-header)]">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Артист</th>
                <th className="px-3 py-2 font-medium">Трек</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row, i) => (
                <tr key={i} className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)]">
                  <td className="px-3 py-2 text-[var(--text-muted)]">{row.rank ?? "—"}</td>
                  <td className="px-3 py-2">
                    {row.artist_beatport_id ? (
                      <Link
                        href={`/artist/${row.artist_beatport_id.startsWith("bptoptracker:") ? row.artist_beatport_id.replace(/^bptoptracker:/, "") : row.artist_beatport_id}`}
                        className="font-medium text-[var(--accent)] underline hover:no-underline"
                      >
                        {row.artist_name}
                      </Link>
                    ) : row.artist_url ? (
                      <a
                        href={row.artist_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--text)] underline hover:no-underline"
                      >
                        {row.artist_name}
                      </a>
                    ) : (
                      row.artist_name
                    )}
                  </td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">{row.track_name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
