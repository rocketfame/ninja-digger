import Link from "next/link";
import { query } from "@/lib/db";
import { getBlocklistValuesForSql } from "@/lib/bptoptrackerBlocklist";
import { formatDateDDMMYYYY } from "@/lib/formatDate";
import { NavBar } from "@/app/components/NavBar";
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

  const blocklist = getBlocklistValuesForSql();
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
      `WITH base AS (
        SELECT artist_name, position, snapshot_date, genre_slug, movement
        FROM bptoptracker_daily
        WHERE (($1::text IS NULL OR $1 = '') OR genre_slug = $1)
          AND ($2::date IS NULL OR snapshot_date >= $2::date)
          AND ($3::date IS NULL OR snapshot_date <= $3::date)
          AND (array_length($4::text[], 1) IS NULL OR (
            NOT (LOWER(TRIM(artist_name)) = ANY($4::text[]))
            AND NOT (LOWER(TRIM(REGEXP_REPLACE(artist_name, '\\s*[→↗⟶➔›].*$', '', 'gi'))) = ANY($4::text[]))
            AND NOT (LOWER(TRIM(artist_name)) LIKE 'about us%')))
      ),
      agg AS (
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
        FROM base
        GROUP BY artist_name
      )
      SELECT agg.*,
        COALESCE(bl.artist_beatport_id, am.artist_beatport_id) AS lead_id
      FROM agg
      LEFT JOIN artist_metrics am ON LOWER(TRIM(am.artist_name)) = LOWER(TRIM(agg.artist_name))
      LEFT JOIN bptoptracker_artist_links bl ON bl.artist_name = agg.artist_name
      ORDER BY agg.appearances DESC, agg.best_position ASC
      LIMIT 500`,
      [genre || null, dateFrom || null, dateTo || null, blocklist]
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
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />

      <main className="mx-auto max-w-6xl px-4 py-6">
        <h1 className="mb-4 text-xl font-semibold text-[var(--text)]">Артисти з BP Top Tracker</h1>
        <p className="mb-4 text-sm text-[var(--text-muted)]">
          Агрегація по артистах з ретроспективних чартів. Звʼязок з лідами — авто за іменем або ручне посилання.
        </p>

        <BptoptrackerFilters
          genres={genres.map((g) => g.genre_slug)}
          currentGenre={genre ?? ""}
          currentDateFrom={dateFrom ?? ""}
          currentDateTo={dateTo ?? ""}
        />

        <div className="mt-4 overflow-x-auto rounded border border-[var(--border)] bg-[var(--bg-card)]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-table-header)]">
                <th className="px-3 py-2 font-medium text-[var(--text)]">Артист</th>
                <th className="px-3 py-2 font-medium text-[var(--text)]">Жанри</th>
                <th className="px-3 py-2 font-medium text-[var(--text)]">Входжень</th>
                <th className="px-3 py-2 font-medium text-[var(--text)]">Найкраща поз.</th>
                <th className="px-3 py-2 font-medium text-[var(--text)]">Сер. поз.</th>
                <th className="px-3 py-2 font-medium text-[var(--text)]">Перша дата</th>
                <th className="px-3 py-2 font-medium text-[var(--text)]">Остання дата</th>
                <th className="px-3 py-2 font-medium text-[var(--text)]">Тренд</th>
                <th className="px-3 py-2 font-medium text-[var(--text)]">Лід</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-[var(--text-muted)]">
                    Немає даних. Запусти backfill на сторінці Leads або обери інші фільтри.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.artist_name} className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)]">
                  <td className="px-3 py-2 font-medium text-[var(--text)]">{r.artist_name}</td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">{r.genres.slice(0, 3).join(", ")}</td>
                  <td className="px-3 py-2 text-[var(--text)]">{r.appearances}</td>
                  <td className="px-3 py-2 text-[var(--text)]">#{r.best_position}</td>
                  <td className="px-3 py-2 text-[var(--text)]">{r.avg_position}</td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">{formatDateDDMMYYYY(r.first_seen)}</td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">{formatDateDDMMYYYY(r.last_seen)}</td>
                  <td className="px-3 py-2">
                    <span title={`↑${r.moves_up} ↓${r.moves_down}`}>
                      {r.moves_up > r.moves_down ? (
                        <span className="text-[var(--accent)]">↑ {r.moves_up}</span>
                      ) : r.moves_down > r.moves_up ? (
                        <span className="text-[var(--danger)]">↓ {r.moves_down}</span>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {r.lead_id ? (
                      <Link
                        href={`/artist/${r.lead_id.startsWith("bptoptracker:") ? r.lead_id.replace(/^bptoptracker:/, "") : r.lead_id}`}
                        className="text-[var(--accent)] hover:underline"
                      >
                        Відкрити лід
                      </Link>
                    ) : (
                      <Link
                        href={`/bptoptracker/link?artist=${encodeURIComponent(r.artist_name)}`}
                        className="text-[var(--text-muted)] hover:text-[var(--text)]"
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
