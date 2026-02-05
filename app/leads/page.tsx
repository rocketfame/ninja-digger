import Link from "next/link";
import { query } from "@/lib/db";
import { DiscoveryControl } from "./DiscoveryControl";

const SEGMENTS_V2 = ["NEW_ENTRY", "CONSISTENT", "FAST_GROWING", "DECLINING", "TOP_PERFORMER"] as const;

type LeadRowV2 = {
  artist_beatport_id: string;
  artist_name: string | null;
  segment: string;
  score: string;
  total_chart_entries: number;
  first_seen: string | null;
  last_seen: string | null;
};

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string }>;
}) {
  const resolved = await searchParams;
  const segmentFilter = resolved.segment;
  const segment =
    segmentFilter && SEGMENTS_V2.includes(segmentFilter as (typeof SEGMENTS_V2)[number])
      ? segmentFilter
      : null;

  let leads: LeadRowV2[] = [];
  let error: string | null = null;

  try {
    if (segment) {
      leads = await query<LeadRowV2>(
        `SELECT ls.artist_beatport_id, am.artist_name, ls.segment, ls.score::text,
                am.total_chart_entries, am.first_seen::text AS first_seen, am.last_seen::text AS last_seen
         FROM lead_scores ls
         LEFT JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
         WHERE ls.segment = $1
         ORDER BY ls.score DESC NULLS LAST`,
        [segment]
      );
    } else {
      leads = await query<LeadRowV2>(
        `SELECT ls.artist_beatport_id, am.artist_name, ls.segment, ls.score::text,
                am.total_chart_entries, am.first_seen::text AS first_seen, am.last_seen::text AS last_seen
         FROM lead_scores ls
         LEFT JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
         ORDER BY ls.score DESC NULLS LAST`
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load leads.";
    if (msg.includes("DATABASE_URL")) {
      error =
        "Add DATABASE_URL to your environment (.env locally or Vercel → Settings → Environment Variables). Then run discovery, ingest, normalize and score so leads appear here.";
    } else {
      error = msg;
    }
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

        <DiscoveryControl />

        <div className="mb-4 flex flex-wrap items-center gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-stone-500">Segment:</span>
            <Link
              href="/leads"
              className={`rounded px-2 py-1 text-sm ${!segment ? "bg-stone-800 text-white" : "bg-stone-200 text-stone-700 hover:bg-stone-300"}`}
            >
              all
            </Link>
            {SEGMENTS_V2.map((s) => (
              <Link
                key={s}
                href={`/leads?segment=${s}`}
                className={`rounded px-2 py-1 text-sm ${segment === s ? "bg-stone-800 text-white" : "bg-stone-200 text-stone-700 hover:bg-stone-300"}`}
              >
                {s}
              </Link>
            ))}
          </div>
          {!error && leads.length > 0 && (
            <a
              href={`/api/leads/export${segment ? `?segment=${segment}` : ""}`}
              className="rounded bg-stone-700 px-3 py-1.5 text-sm text-white hover:bg-stone-600"
            >
              Export CSV
            </a>
          )}
        </div>

        {error && (
          <p className="mb-4 rounded bg-amber-100 px-3 py-2 text-sm text-amber-900">
            {error}
          </p>
        )}

        {!error && leads.length === 0 && (
          <p className="text-stone-500">No leads yet. Run discovery, ingest, normalize and score (migration 013).</p>
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
                    key={row.artist_beatport_id}
                    className="border-b border-stone-100 hover:bg-stone-50"
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/artist/bp/${row.artist_beatport_id}`}
                        className="font-medium text-stone-900 underline hover:no-underline"
                      >
                        {(row.artist_name ?? row.artist_beatport_id) || "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{row.segment}</td>
                    <td className="px-3 py-2">{row.score}</td>
                    <td className="px-3 py-2">{row.total_chart_entries}</td>
                    <td className="px-3 py-2">{row.first_seen ?? "—"}</td>
                    <td className="px-3 py-2">{row.last_seen ?? "—"}</td>
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
