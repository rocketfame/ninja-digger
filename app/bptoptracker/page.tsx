import Link from "next/link";
import { query } from "@/lib/db";
import { BptoptrackerFilters } from "./BptoptrackerFilters";

type AggRow = {
  artist_name: string;
  appearances: number;
  best_position: number;
  avg_position: string;
  first_seen: string;
  last_seen: string;
  genres: string[];
  moves_up: number;
  moves_down: number;
  lead_id: string | null;
};

export const dynamic = "force-dynamic";

export default async function BptoptrackerArtistsPage({
  searchParams,
}: {
  searchParams: Promise<{ genre?: string; dateFrom?: string; dateTo?: string }>;
}) {
  const params = await searchParams;
  const genre = params.genre?.trim() || null;
  const dateFrom = params.dateFrom?.trim() || null;
  const dateTo = params.dateTo?.trim() || null;

  let genres: { genre_slug: string }[] = [];
  let rows: AggRow[] = [];

  try {
    genres = await query<{ genre_slug: string }>(
      `SELECT DISTINCT genre_slug FROM bptoptracker_daily ORDER BY genre_slug`
    );
  } catch {
    // table might not exist yet
  }

  try {
    const agg = await query<{
      artist_name: string;
      appearances: string;
      best_position: string;
      avg_position: string;
      first_seen: string;
      last_seen: string;
      genres: string[];
      moves_up: string;
      moves_down: string;
      lead_id: string | null;
    }>(
      `WITH agg AS (
        SELECT
          artist_name,
          COUNT(*)::int AS appearances,
          MIN(position)::int AS best_position,
          AVG(position)::numeric(10,2) AS avg_position,
          MIN(snapshot_date)::text AS first_seen,
          MAX(snapshot_date)::text AS last_seen,
          ARRAY_AGG(DISTINCT genre_slug) AS genres,
          COUNT(*) FILTER (WHERE movement LIKE '↑%')::int AS moves_up,
          COUNT(*) FILTER (WHERE movement LIKE '↓%')::int AS moves_down
        FROM bptoptracker_daily
        WHERE (($1::text IS NULL OR $1 = '') OR genre_slug = $1)
          AND ($2::date IS NULL OR snapshot_date >= $2::date)
          AND ($3::date IS NULL OR snapshot_date <= $3::date)
        GROUP BY artist_name
      )
      SELECT agg.*,
        COALESCE(bl.artist_beatport_id, am.artist_beatport_id) AS lead_id
      FROM agg
      LEFT JOIN artist_metrics am ON LOWER(TRIM(am.artist_name)) = LOWER(TRIM(agg.artist_name))
      LEFT JOIN bptoptracker_artist_links bl ON bl.artist_name = agg.artist_name
      ORDER BY agg.appearances DESC, agg.best_position ASC
      LIMIT 500`,
      [genre || null, dateFrom || null, dateTo || null]
    );
    rows = agg.map((r) => ({
      artist_name: r.artist_name,
      appearances: Number(r.appearances),
      best_position: Number(r.best_position),
      avg_position: r.avg_position,
      first_seen: r.first_seen,
      last_seen: r.last_seen,
      genres: Array.isArray(r.genres) ? r.genres : [],
      moves_up: Number(r.moves_up),
      moves_down: Number(r.moves_down),
      lead_id: r.lead_id,
    }));
  } catch (e) {
    // table might not exist
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white px-4 py-3">
        <nav className="flex items-center gap-4">
          <Link href="/" className="text-stone-600 hover:text-stone-900">Home</Link>
          <span className="text-stone-400">|</span>
          <Link href="/leads" className="text-stone-600 hover:text-stone-900">Leads</Link>
          <span className="text-stone-400">|</span>
          <span className="font-medium">Артисти з BP Top Tracker</span>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <h1 className="mb-4 text-xl font-semibold">Артисти з BP Top Tracker</h1>
        <p className="mb-4 text-sm text-stone-500">
          Агрегація по артистах з ретроспективних чартів. Звʼязок з лідами — авто за іменем або ручне посилання.
        </p>

        <BptoptrackerFilters
          genres={genres.map((g) => g.genre_slug)}
          currentGenre={genre ?? ""}
          currentDateFrom={dateFrom ?? ""}
          currentDateTo={dateTo ?? ""}
        />

        <div className="mt-4 overflow-x-auto rounded border border-stone-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-100">
                <th className="px-3 py-2 font-medium">Артист</th>
                <th className="px-3 py-2 font-medium">Жанри</th>
                <th className="px-3 py-2 font-medium">Входжень</th>
                <th className="px-3 py-2 font-medium">Найкраща поз.</th>
                <th className="px-3 py-2 font-medium">Сер. поз.</th>
                <th className="px-3 py-2 font-medium">Перша дата</th>
                <th className="px-3 py-2 font-medium">Остання дата</th>
                <th className="px-3 py-2 font-medium">Тренд</th>
                <th className="px-3 py-2 font-medium">Лід</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-stone-500">
                    Немає даних. Запусти backfill на сторінці Leads або обери інші фільтри.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.artist_name} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="px-3 py-2 font-medium">{r.artist_name}</td>
                  <td className="px-3 py-2 text-stone-600">{r.genres.slice(0, 3).join(", ")}</td>
                  <td className="px-3 py-2">{r.appearances}</td>
                  <td className="px-3 py-2">#{r.best_position}</td>
                  <td className="px-3 py-2">{r.avg_position}</td>
                  <td className="px-3 py-2">{r.first_seen}</td>
                  <td className="px-3 py-2">{r.last_seen}</td>
                  <td className="px-3 py-2">
                    <span title={`↑${r.moves_up} ↓${r.moves_down}`}>
                      {r.moves_up > r.moves_down ? (
                        <span className="text-emerald-600">↑ {r.moves_up}</span>
                      ) : r.moves_down > r.moves_up ? (
                        <span className="text-red-600">↓ {r.moves_down}</span>
                      ) : (
                        <span className="text-stone-400">—</span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {r.lead_id ? (
                      <Link
                        href={`/artist/bp/${r.lead_id}`}
                        className="text-stone-700 underline hover:no-underline"
                      >
                        Відкрити лід
                      </Link>
                    ) : (
                      <Link
                        href={`/bptoptracker/link?artist=${encodeURIComponent(r.artist_name)}`}
                        className="text-stone-500 hover:text-stone-700"
                      >
                        Привʼязати
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
