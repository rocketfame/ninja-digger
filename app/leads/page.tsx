import Link from "next/link";
import { query } from "@/lib/db";

const SEGMENTS = ["core", "regular", "fresh", "momentum", "flyers"] as const;

type LeadRow = {
  artist_id: number;
  artist_name: string;
  segment: string;
  score: string;
  appearances: number;
  first_seen: string;
  last_seen: string;
};

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string }>;
}) {
  const { segment: segmentFilter } = await searchParams();
  const segment =
    segmentFilter && SEGMENTS.includes(segmentFilter as (typeof SEGMENTS)[number])
      ? segmentFilter
      : null;

  let leads: LeadRow[] = [];
  let error: string | null = null;

  try {
    if (segment) {
      leads = await query<LeadRow>(
        `SELECT artist_id, artist_name, segment, score::text, appearances, first_seen::text, last_seen::text
         FROM artist_lead_score
         WHERE segment = $1
         ORDER BY score DESC NULLS LAST`,
        [segment]
      );
    } else {
      leads = await query<LeadRow>(
        `SELECT artist_id, artist_name, segment, score::text, appearances, first_seen::text, last_seen::text
         FROM artist_lead_score
         ORDER BY score DESC NULLS LAST`
      );
    }
  } catch (e) {
    error =
      e instanceof Error ? e.message : "Failed to load leads. Run migrations 007–008.";
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white px-4 py-3">
        <nav className="flex items-center gap-4">
          <Link href="/" className="text-stone-600 hover:text-stone-900">
            Home
          </Link>
          <span className="text-stone-400">|</span>
          <span className="font-medium">Leads</span>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-4 text-xl font-semibold">Leads</h1>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-stone-500">Segment:</span>
          <Link
            href="/leads"
            className={`rounded px-2 py-1 text-sm ${!segment ? "bg-stone-800 text-white" : "bg-stone-200 text-stone-700 hover:bg-stone-300"}`}
          >
            all
          </Link>
          {SEGMENTS.map((s) => (
            <Link
              key={s}
              href={`/leads?segment=${s}`}
              className={`rounded px-2 py-1 text-sm ${segment === s ? "bg-stone-800 text-white" : "bg-stone-200 text-stone-700 hover:bg-stone-300"}`}
            >
              {s}
            </Link>
          ))}
        </div>

        {error && (
          <p className="mb-4 rounded bg-amber-100 px-3 py-2 text-sm text-amber-900">
            {error}
          </p>
        )}

        {!error && leads.length === 0 && (
          <p className="text-stone-500">No leads yet. Run ingestion and migrations.</p>
        )}

        {!error && leads.length > 0 && (
          <div className="overflow-x-auto rounded border border-stone-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-100">
                  <th className="px-3 py-2 font-medium">Artist</th>
                  <th className="px-3 py-2 font-medium">Segment</th>
                  <th className="px-3 py-2 font-medium">Score</th>
                  <th className="px-3 py-2 font-medium">Appearances</th>
                  <th className="px-3 py-2 font-medium">First seen</th>
                  <th className="px-3 py-2 font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((row) => (
                  <tr
                    key={row.artist_id}
                    className="border-b border-stone-100 hover:bg-stone-50"
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/artist/${row.artist_id}`}
                        className="font-medium text-stone-900 underline hover:no-underline"
                      >
                        {row.artist_name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{row.segment}</td>
                    <td className="px-3 py-2">{row.score}</td>
                    <td className="px-3 py-2">{row.appearances}</td>
                    <td className="px-3 py-2">{row.first_seen}</td>
                    <td className="px-3 py-2">{row.last_seen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
