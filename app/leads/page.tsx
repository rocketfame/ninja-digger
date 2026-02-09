import Link from "next/link";
import { unstable_cache } from "next/cache";
import { query } from "@/lib/db";
import { getBlocklistValuesForSql } from "@/lib/bptoptrackerBlocklist";
import { formatDateDDMMYYYY } from "@/lib/formatDate";
import { DiscoveryControl } from "./DiscoveryControl";
import { BptoptrackerBackfill } from "./BptoptrackerBackfill";
import { LeadsGenreHeader } from "./LeadsGenreHeader";
import { LeadsDateRangeFilter } from "./LeadsDateRangeFilter";
import { RunEnrichmentOnLeadsButton } from "./RunEnrichmentOnLeadsButton";

const SEGMENTS_V2 = ["NEWCOMER", "NEW_ENTRY", "CONSISTENT", "FAST_GROWING", "DECLINING", "TOP_PERFORMER"] as const;
const LEADS_PAGE_SIZE = 100;
const SORT_FIELDS = ["score", "entries", "first_seen", "last_seen", "artist"] as const;
type SortField = (typeof SORT_FIELDS)[number];
const ORDER_FIELDS = ["asc", "desc"] as const;
type OrderField = (typeof ORDER_FIELDS)[number];

const SEGMENT_LABELS: Record<string, string> = {
  NEWCOMER: "Новачки",
  NEW_ENTRY: "Новий вхід",
  CONSISTENT: "Стабільний",
  FAST_GROWING: "Швидке зростання",
  DECLINING: "Спад",
  TOP_PERFORMER: "Топ-перформер",
};

/** Короткі визначення ключових сегментів (логіка в migrations/028_*). */
const SEGMENT_DESCRIPTIONS: Record<string, string> = {
  NEWCOMER:
    "Парсер вперше побачив артиста в топ-чарті (first_seen у останні 21 день вікна даних). Кількість днів не обмежуємо.",
  NEW_ENTRY:
    "Коротка історія в чарті (2–29 днів), ще не стабільні. Без яскравої динаміки зростання/спаду.",
};

type LeadRowV2 = {
  artist_beatport_id: string;
  artist_name: string | null;
  segment: string;
  score: string;
  total_chart_entries: number;
  first_seen: string | null;
  last_seen: string | null;
  genres: string[] | null;
};

export const dynamic = "force-dynamic";
/** Кеш списку лідів на 45 с — менше навантаження на БД при серфі по сегментах/сторінках. */
const LEADS_CACHE_REVALIDATE_SEC = 45;

function buildQuery(params: { segment?: string | null; genre?: string | null; dateFrom?: string | null; dateTo?: string | null; sort?: string; order?: string; page?: number }) {
  const q = new URLSearchParams();
  if (params.segment) q.set("segment", params.segment);
  if (params.genre) q.set("genre", params.genre);
  if (params.dateFrom) q.set("dateFrom", params.dateFrom);
  if (params.dateTo) q.set("dateTo", params.dateTo);
  if (params.sort) q.set("sort", params.sort);
  if (params.order) q.set("order", params.order);
  if (params.page && params.page > 1) q.set("page", String(params.page));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Валідація YYYY-MM-DD; повертає рядок або null. */
function parseDateParam(value: string | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const s = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string; page?: string; genre?: string; dateFrom?: string; dateTo?: string; sort?: string; order?: string }>;
}) {
  const resolved = await searchParams;
  // #region agent log
  fetch("http://127.0.0.1:7245/ingest/7798bf67-c5b4-45c1-bfd1-dc5453bf1c4b", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      location: "app/leads/page.tsx:entry",
      message: "searchParams resolved",
      data: { rawGenre: resolved.genre, segment: resolved.segment, dateFrom: resolved.dateFrom, dateTo: resolved.dateTo, sort: resolved.sort },
      hypothesisId: "A",
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  const segmentFilter = resolved.segment;
  const segment =
    segmentFilter && SEGMENTS_V2.includes(segmentFilter as (typeof SEGMENTS_V2)[number])
      ? segmentFilter
      : null;
  const genreParam = typeof resolved.genre === "string" ? resolved.genre.trim() : null;
  const dateFromParam = parseDateParam(resolved.dateFrom);
  const dateToParam = parseDateParam(resolved.dateTo);
  const sortParam = resolved.sort?.trim();
  const sort: SortField =
    sortParam && SORT_FIELDS.includes(sortParam as SortField) ? (sortParam as SortField) : "score";
  const orderParam = resolved.order?.trim();
  const order: OrderField =
    orderParam && ORDER_FIELDS.includes(orderParam as OrderField) ? (orderParam as OrderField) : "desc";
  const pageNum = Math.min(200, Math.max(1, parseInt(resolved.page ?? "1", 10) || 1));
  const offset = (pageNum - 1) * LEADS_PAGE_SIZE;

  let leads: (LeadRowV2 & { _total?: number })[] = [];
  let totalCount = 0;
  let error: string | null = null;
  let distinctGenres: string[] = [];
  // #region agent log
  fetch("http://127.0.0.1:7245/ingest/7798bf67-c5b4-45c1-bfd1-dc5453bf1c4b", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      location: "app/leads/page.tsx:beforeBlocklist",
      message: "before getBlocklistValuesForSql",
      data: { segment: segment ?? null, genreParam, dateFromParam, dateToParam },
      hypothesisId: "B",
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  const blocklist = getBlocklistValuesForSql();

  const blocklistCondition = `(array_length($2::text[], 1) IS NULL OR (
    am.artist_name IS NULL OR (
      NOT (LOWER(TRIM(am.artist_name)) = ANY($2::text[]))
      AND NOT (LOWER(TRIM(REGEXP_REPLACE(am.artist_name, '\\s*[→↗⟶➔›].*$', '', 'gi'))) = ANY($2::text[]))
      AND NOT (LOWER(TRIM(am.artist_name)) LIKE 'about us%')
      AND NOT (am.artist_name ~ '^\\d+\\s*\\/\\s*')
    )
  ))`;

  const orderByClause =
    sort === "entries"
      ? `am.total_chart_entries ${order.toUpperCase()} NULLS LAST, am.artist_name ASC NULLS LAST`
      : sort === "first_seen"
        ? `am.first_seen ${order.toUpperCase()} NULLS LAST, am.artist_name ASC NULLS LAST`
        : sort === "last_seen"
          ? `am.last_seen ${order.toUpperCase()} NULLS LAST, am.artist_name ASC NULLS LAST`
          : sort === "artist"
            ? `am.artist_name ${order.toUpperCase()} NULLS LAST, ls.score DESC NULLS LAST`
            : `ls.score ${order.toUpperCase()} NULLS LAST, am.artist_name ASC NULLS LAST`;

  const genreConditionSeg = genreParam
    ? ` AND ((am.genres IS NOT NULL AND ($3 = ANY(am.genres) OR EXISTS (SELECT 1 FROM unnest(am.genres) AS g WHERE LOWER(REPLACE(TRIM(g::text), ' ', '-')) = LOWER(REPLACE(TRIM($3::text), ' ', '-'))))) OR EXISTS (SELECT 1 FROM chart_entries ce JOIN charts_catalog cc ON cc.id = ce.chart_id WHERE ce.artist_beatport_id = ls.artist_beatport_id AND cc.genre_slug IS NOT NULL AND (cc.genre_slug = $3 OR cc.genre_slug = LOWER(REPLACE(TRIM($3::text), ' ', '-')))))`
    : ` AND $3::text IS NULL`;
  const genreConditionAll =
    ` AND ($2::text IS NULL OR ((am.genres IS NOT NULL AND ($2 = ANY(am.genres) OR EXISTS (SELECT 1 FROM unnest(am.genres) AS g WHERE LOWER(REPLACE(TRIM(g::text), ' ', '-')) = LOWER(REPLACE(TRIM($2::text), ' ', '-'))))) OR EXISTS (SELECT 1 FROM chart_entries ce JOIN charts_catalog cc ON cc.id = ce.chart_id WHERE ce.artist_beatport_id = ls.artist_beatport_id AND cc.genre_slug IS NOT NULL AND (cc.genre_slug = $2 OR cc.genre_slug = LOWER(REPLACE(TRIM($2::text), ' ', '-'))))))`;

  const dateConditionSeg =
    " AND (($4::date IS NULL AND $5::date IS NULL) OR EXISTS (SELECT 1 FROM chart_entries ce WHERE ce.artist_beatport_id = ls.artist_beatport_id AND ce.snapshot_date >= $4::date AND ce.snapshot_date <= $5::date))";
  const dateConditionAll =
    " AND (($3::date IS NULL AND $4::date IS NULL) OR EXISTS (SELECT 1 FROM chart_entries ce WHERE ce.artist_beatport_id = ls.artist_beatport_id AND ce.snapshot_date >= $3::date AND ce.snapshot_date <= $4::date))";

  const getCachedLeads = unstable_cache(
    async () => {
      // #region agent log
      const branch = segment ? "segment" : "all";
      const logParams = segment
        ? genreParam ? [segment, blocklist, genreParam] : [segment, blocklist]
        : genreParam ? [blocklist, genreParam] : [blocklist];
      const genreValue = genreParam ? logParams[logParams.length - 1] : null;
      const hasDates = dateFromParam != null || dateToParam != null;
      fetch("http://127.0.0.1:7245/ingest/7798bf67-c5b4-45c1-bfd1-dc5453bf1c4b", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: "app/leads/page.tsx:getCachedLeads",
          message: "query params before execute",
          data: { branch, paramCount: logParams.length, genreValue, genreParam, hasDates, dateFromParam, dateToParam },
          hypothesisId: "B",
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      if (segment) {
        const params: (string | string[] | null)[] = [segment, blocklist, genreParam ?? null, dateFromParam ?? null, dateToParam ?? null];
        // #region agent log
        if (hasDates) {
          fetch("http://127.0.0.1:7245/ingest/7798bf67-c5b4-45c1-bfd1-dc5453bf1c4b", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              location: "app/leads/page.tsx:getCachedLeads:segmentParams",
              message: "segment query params when dates set",
              data: { paramsLength: params.length, paramTypes: params.map((p) => (Array.isArray(p) ? "array" : typeof p)) },
              hypothesisId: "A",
              timestamp: Date.now(),
            }),
          }).catch(() => {});
        }
        // #endregion
        const rows = await query<LeadRowV2 & { _total: number }>(
          `SELECT ls.artist_beatport_id, am.artist_name, ls.segment, ls.score::text,
                  am.total_chart_entries, am.first_seen::text AS first_seen, am.last_seen::text AS last_seen,
                  am.genres AS genres,
                  COUNT(*) OVER()::int AS _total
           FROM lead_scores ls
           LEFT JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
           WHERE ls.segment = $1 AND ${blocklistCondition}${genreConditionSeg}${dateConditionSeg}
           ORDER BY ${orderByClause}
           LIMIT ${LEADS_PAGE_SIZE} OFFSET ${offset}`,
          params
        );
        // #region agent log
        const total = rows[0]?._total ?? 0;
        fetch("http://127.0.0.1:7245/ingest/7798bf67-c5b4-45c1-bfd1-dc5453bf1c4b", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            location: "app/leads/page.tsx:getCachedLeads:segment",
            message: "after segment query",
            data: { rowsLength: rows.length, totalCount: total, genreParam },
            hypothesisId: "D",
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        return { rows, totalCount: total };
      }
      const params: (string | string[] | null)[] = [blocklist, genreParam ?? null, dateFromParam ?? null, dateToParam ?? null];
      const rows = await query<LeadRowV2 & { _total: number }>(
        `SELECT ls.artist_beatport_id, am.artist_name, ls.segment, ls.score::text,
                am.total_chart_entries, am.first_seen::text AS first_seen, am.last_seen::text AS last_seen,
                am.genres AS genres,
                COUNT(*) OVER()::int AS _total
         FROM lead_scores ls
         LEFT JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
         WHERE ${blocklistCondition.replace(/\$2/g, "$1")}${genreConditionAll}${dateConditionAll}
         ORDER BY ${orderByClause}
         LIMIT ${LEADS_PAGE_SIZE} OFFSET ${offset}`,
        params
      );
      // #region agent log
      const totalAll = rows[0]?._total ?? 0;
      fetch("http://127.0.0.1:7245/ingest/7798bf67-c5b4-45c1-bfd1-dc5453bf1c4b", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: "app/leads/page.tsx:getCachedLeads:all",
          message: "after all query",
          data: { rowsLength: rows.length, totalCount: totalAll, genreParam },
          hypothesisId: "D",
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      return { rows, totalCount: totalAll };
    },
    ["leads", segment ?? "all", genreParam ?? "", dateFromParam ?? "", dateToParam ?? "", sort, order, String(pageNum)],
    { revalidate: LEADS_CACHE_REVALIDATE_SEC, tags: ["leads"] }
  );

  try {
    // #region agent log
    fetch("http://127.0.0.1:7245/ingest/7798bf67-c5b4-45c1-bfd1-dc5453bf1c4b", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: "app/leads/page.tsx:beforeGetCachedLeads",
        message: "about to call getCachedLeads",
        data: { segment: segment ?? null, dateFromParam, dateToParam },
        hypothesisId: "D",
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    const [leadsResult, genresResult] = await Promise.all([
      getCachedLeads(),
      query<{ g: string }>(
        `SELECT DISTINCT unnest(genres) AS g FROM artist_metrics WHERE genres IS NOT NULL AND array_length(genres, 1) > 0 ORDER BY g LIMIT 500`
      ),
    ]);
    const { rows, totalCount: total } = leadsResult;
    leads = rows;
    totalCount = total;
    distinctGenres = genresResult.map((r) => r.g);
    // #region agent log
    if (genreParam != null && genreParam !== "") {
      fetch("http://127.0.0.1:7245/ingest/7798bf67-c5b4-45c1-bfd1-dc5453bf1c4b", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: "app/leads/page.tsx:after",
          message: "genre filter result",
          data: {
            genreParam,
            totalCount: total,
            leadsLength: leads.length,
            segment: segment ?? "all",
            distinctGenresCount: distinctGenres.length,
            sampleGenres: distinctGenres.slice(0, 5),
            genreInList: distinctGenres.includes(genreParam),
          },
          hypothesisId: "A",
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    }
    // #endregion
  } catch (e) {
    // #region agent log
    const errMsg = e instanceof Error ? e.message : String(e);
    const errStack = e instanceof Error ? e.stack : undefined;
    fetch("http://127.0.0.1:7245/ingest/7798bf67-c5b4-45c1-bfd1-dc5453bf1c4b", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: "app/leads/page.tsx:catch",
        message: "leads page error",
        data: { errMsg, errStack: errStack?.slice(0, 500), segment: segment ?? null, genreParam, dateFromParam, dateToParam },
        hypothesisId: "B",
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    const msg = e instanceof Error ? e.message : "Не вдалося завантажити ліди.";
    if (msg.includes("DATABASE_URL")) {
      error =
        "Додайте DATABASE_URL у середовище (.env локально або Vercel → Settings → Environment Variables). Потім запустіть discovery, ingest, normalize та score, щоб тут зʼявились ліди.";
    } else {
      error = msg;
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] bg-[var(--bg-header)] px-4 py-3">
        <nav className="flex items-center gap-6">
          <Link href="/" className="text-[var(--accent)] font-semibold tracking-tight hover:text-[var(--accent-hover)]">
            Ninja Digger
          </Link>
          <span className="text-[var(--text-muted)]">|</span>
          <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--text)]">
            Головна
          </Link>
          <span className="font-medium text-[var(--text)]">Ліди</span>
          <Link href="/bptoptracker" className="text-[var(--text-muted)] hover:text-[var(--text)]">
            BP Top Tracker
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-4 text-xl font-semibold text-[var(--text)]">Ліди</h1>

        <DiscoveryControl />
        <BptoptrackerBackfill />

        <div className="mb-4 flex flex-wrap items-center gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-[var(--text-muted)]">Сегмент:</span>
            <Link
              href={buildQuery({ genre: genreParam ?? undefined, dateFrom: dateFromParam ?? undefined, dateTo: dateToParam ?? undefined, sort, order })}
              className={`rounded px-2 py-1 text-sm ${!segment ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]" : "bg-[var(--bg-card)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"}`}
            >
              всі
            </Link>
            {SEGMENTS_V2.map((s) => (
              <Link
                key={s}
                href={buildQuery({ segment: s, genre: genreParam ?? undefined, dateFrom: dateFromParam ?? undefined, dateTo: dateToParam ?? undefined, sort, order })}
                className={`rounded px-2 py-1 text-sm ${segment === s ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]" : "bg-[var(--bg-card)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"}`}
              >
                {SEGMENT_LABELS[s] ?? s}
              </Link>
            ))}
          </div>
          <LeadsDateRangeFilter
            segment={segment ?? undefined}
            genre={genreParam ?? undefined}
            dateFrom={dateFromParam ?? undefined}
            dateTo={dateToParam ?? undefined}
            sort={sort}
            order={order}
          />
          {segment && SEGMENT_DESCRIPTIONS[segment] && (
            <p className="w-full text-sm text-[var(--text-muted)]">
              {SEGMENT_LABELS[segment]}: {SEGMENT_DESCRIPTIONS[segment]}
            </p>
          )}
          {!error && leads.length > 0 && (
            <a
              href={`/api/leads/export${buildQuery({ segment: segment ?? undefined, genre: genreParam ?? undefined, dateFrom: dateFromParam ?? undefined, dateTo: dateToParam ?? undefined, sort, order })}`}
              className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white hover:bg-[var(--accent-hover)]"
            >
              Експорт CSV
            </a>
          )}
          {!error && (
            <div className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3">
              <RunEnrichmentOnLeadsButton
                segment={segment ?? null}
                genre={genreParam ?? null}
                dateFrom={dateFromParam ?? null}
                dateTo={dateToParam ?? null}
              />
            </div>
          )}
        </div>

        {error && (
          <p className="mb-4 rounded bg-amber-500/20 px-3 py-2 text-sm text-amber-200">
            {error}
          </p>
        )}

        {!error && (
          <>
            {leads.length === 0 ? (
              <p className="text-[var(--text-muted)]">
                {genreParam
                  ? "Немає лідів з обраним жанром. Оберіть інший жанр у заголовку колонки «Жанр» або «Усі жанри»."
                  : "Лідів ще немає. Запустіть discovery, ingest, normalize та score."}
              </p>
            ) : (
              <p className="mb-2 text-sm text-[var(--text-muted)]">
                Показано {offset + 1}–{offset + leads.length}
                {totalCount > LEADS_PAGE_SIZE ? ` з ${totalCount}` : ""} лідів
              </p>
            )}
            <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--bg-card)]">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--bg-table-header)]">
                    <th className="px-3 py-2 font-medium text-[var(--text)]">
                      <Link
                        href={buildQuery({ segment, genre: genreParam ?? undefined, dateFrom: dateFromParam ?? undefined, dateTo: dateToParam ?? undefined, sort: "artist", order: sort === "artist" && order === "asc" ? "desc" : "asc", page: 1 })}
                        className="inline-flex items-center gap-1 hover:text-[var(--accent)]"
                      >
                        Артист
                        {sort === "artist" && (order === "asc" ? " ↑" : " ↓")}
                      </Link>
                    </th>
                    <th className="px-3 py-2 font-medium text-[var(--text)]">Сегмент</th>
                    <th className="px-3 py-2 font-medium text-[var(--text)]">
                      <Link
                        href={buildQuery({ segment, genre: genreParam ?? undefined, dateFrom: dateFromParam ?? undefined, dateTo: dateToParam ?? undefined, sort: "entries", order: sort === "entries" && order === "asc" ? "desc" : "asc", page: 1 })}
                        className="inline-flex items-center gap-1 hover:text-[var(--accent)]"
                      >
                        Входжень
                        {sort === "entries" && (order === "asc" ? " ↑" : " ↓")}
                      </Link>
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium text-[var(--text)]">
                      <Link
                        href={buildQuery({ segment, genre: genreParam ?? undefined, dateFrom: dateFromParam ?? undefined, dateTo: dateToParam ?? undefined, sort: "first_seen", order: sort === "first_seen" && order === "desc" ? "asc" : "desc", page: 1 })}
                        className="inline-flex items-center gap-1 hover:text-[var(--accent)]"
                      >
                        Вперше
                        {sort === "first_seen" && (order === "asc" ? " ↑" : " ↓")}
                      </Link>
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium text-[var(--text)]">
                      <Link
                        href={buildQuery({ segment, genre: genreParam ?? undefined, dateFrom: dateFromParam ?? undefined, dateTo: dateToParam ?? undefined, sort: "last_seen", order: sort === "last_seen" && order === "desc" ? "asc" : "desc", page: 1 })}
                        className="inline-flex items-center gap-1 hover:text-[var(--accent)]"
                      >
                        Востаннє
                        {sort === "last_seen" && (order === "asc" ? " ↑" : " ↓")}
                      </Link>
                    </th>
                    <th className="min-w-[8rem] px-3 py-2 font-medium text-[var(--text)]">
                      <LeadsGenreHeader
                        segment={segment ?? undefined}
                        genre={genreParam ?? undefined}
                        dateFrom={dateFromParam ?? undefined}
                        dateTo={dateToParam ?? undefined}
                        sort={sort}
                        order={order}
                        genres={distinctGenres}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {leads.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-[var(--text-muted)]">
                        {genreParam
                          ? "Немає лідів з обраним жанром."
                          : "Лідів ще немає."}
                      </td>
                    </tr>
                  ) : (
                    leads.map((row) => (
                      <tr
                        key={row.artist_beatport_id}
                        className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)]"
                      >
                        <td className="px-3 py-2">
                          <Link
                            href={`/artist/${row.artist_beatport_id.startsWith("bptoptracker:") ? row.artist_beatport_id.replace(/^bptoptracker:/, "") : row.artist_beatport_id}`}
                            className="font-medium text-[var(--accent)] hover:underline"
                          >
                            {(row.artist_name ?? row.artist_beatport_id) || "—"}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-[var(--text)]">{SEGMENT_LABELS[row.segment] ?? row.segment}</td>
                        <td className="px-3 py-2 text-[var(--text)]">{row.total_chart_entries}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-[var(--text-muted)]">{formatDateDDMMYYYY(row.first_seen)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-[var(--text-muted)]">{formatDateDDMMYYYY(row.last_seen)}</td>
                        <td className="min-w-[8rem] px-3 py-2 text-[var(--text-muted)]">
                          {Array.isArray(row.genres) && row.genres.length > 0 ? row.genres.slice(0, 3).join(", ") : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {leads.length > 0 && totalCount > LEADS_PAGE_SIZE && (
              <nav className="mt-4 flex flex-wrap items-center gap-2">
                {pageNum > 1 && (
                  <Link
                    href={`/leads${buildQuery({ segment, genre: genreParam ?? undefined, dateFrom: dateFromParam ?? undefined, dateTo: dateToParam ?? undefined, sort, order, page: pageNum - 1 })}`}
                    className="rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--bg-hover)]"
                  >
                    ← Попередня
                  </Link>
                )}
                <span className="text-sm text-[var(--text-muted)]">
                  Сторінка {pageNum} з {Math.ceil(totalCount / LEADS_PAGE_SIZE) || 1}
                </span>
                {offset + leads.length < totalCount && (
                  <Link
                    href={`/leads${buildQuery({ segment, genre: genreParam ?? undefined, dateFrom: dateFromParam ?? undefined, dateTo: dateToParam ?? undefined, sort, order, page: pageNum + 1 })}`}
                    className="rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--bg-hover)]"
                  >
                    Наступна →
                  </Link>
                )}
              </nav>
            )}
          </>
        )}
      </main>
    </div>
  );
}
