import Link from "next/link";
import { unstable_cache } from "next/cache";
import { query } from "@/lib/db";
import { getBlocklistValuesForSql } from "@/lib/bptoptrackerBlocklist";
import { NavBar } from "@/app/components/NavBar";
import { formatDateDDMMYYYY } from "@/lib/formatDate";
import { BptoptrackerBackfill } from "./BptoptrackerBackfill";
import { LeadsDateRangeFilter } from "./LeadsDateRangeFilter";
import { RunEnrichmentOnLeadsButton } from "./RunEnrichmentOnLeadsButton";
import { LeadsTable } from "./LeadsTable";

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

const SEGMENT_CHIP_COLORS: Record<string, { activeBg: string; activeText: string }> = {
  NEWCOMER:      { activeBg: "rgba(34,197,94,0.25)",  activeText: "#4ade80" },
  NEW_ENTRY:     { activeBg: "rgba(59,130,246,0.25)",  activeText: "#60a5fa" },
  CONSISTENT:    { activeBg: "rgba(168,162,158,0.25)", activeText: "#d6d3d1" },
  FAST_GROWING:  { activeBg: "rgba(168,85,247,0.25)",  activeText: "#c084fc" },
  DECLINING:     { activeBg: "rgba(239,68,68,0.25)",   activeText: "#f87171" },
  TOP_PERFORMER: { activeBg: "rgba(250,204,21,0.25)",  activeText: "#fbbf24" },
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
  searchParams: Promise<{ segment?: string; page?: string; genre?: string; dateFrom?: string; dateTo?: string; sort?: string; order?: string; withContacts?: string; withEmails?: string; withSocials?: string; inWork?: string }>;
}) {
  const resolved = await searchParams;
  const withContacts = resolved.withContacts === "1";
  const withEmails = resolved.withEmails === "1";
  const withSocials = resolved.withSocials === "1";
  const inWork = resolved.inWork === "1";
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
  let positionHistory: Record<string, { date: string; position: number }[]> = {};
  let leadStatuses: Record<string, string> = {};
  let kpi = { totalLeads: 0, newToday: 0, withContacts: 0, withEmails: 0, withSocials: 0, inWork: 0, avgPosition: 0, dataFrom: "", dataTo: "" };
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

  const toSlug = (ref: string) =>
    `LOWER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(${ref}), '[^a-zA-Z0-9]+', '-', 'g'), '^-|-$', '', 'g'))`;

  const genreConditionSeg = genreParam
    ? ` AND ((am.genres IS NOT NULL AND ($3 = ANY(am.genres) OR EXISTS (SELECT 1 FROM unnest(am.genres) AS g WHERE ${toSlug("g::text")} = ${toSlug("$3::text")}))) OR EXISTS (SELECT 1 FROM chart_entries ce JOIN charts_catalog cc ON cc.id = ce.chart_id WHERE ce.artist_beatport_id = ls.artist_beatport_id AND cc.genre_slug IS NOT NULL AND (cc.genre_slug = $3 OR cc.genre_slug = ${toSlug("$3::text")})))`
    : ` AND $3::text IS NULL`;
  const genreConditionAll =
    ` AND ($2::text IS NULL OR ((am.genres IS NOT NULL AND ($2 = ANY(am.genres) OR EXISTS (SELECT 1 FROM unnest(am.genres) AS g WHERE ${toSlug("g::text")} = ${toSlug("$2::text")}))) OR EXISTS (SELECT 1 FROM chart_entries ce JOIN charts_catalog cc ON cc.id = ce.chart_id WHERE ce.artist_beatport_id = ls.artist_beatport_id AND cc.genre_slug IS NOT NULL AND (cc.genre_slug = $2 OR cc.genre_slug = ${toSlug("$2::text")}))))`;

  const useFirstSeen = segment === "NEWCOMER" || segment === "NEW_ENTRY";
  const dateConditionSeg = useFirstSeen
    ? ` AND (($4::date IS NULL AND $5::date IS NULL) OR (am.first_seen IS NOT NULL AND am.first_seen >= $4::date AND am.first_seen <= $5::date))`
    : ` AND (($4::date IS NULL AND $5::date IS NULL) OR EXISTS (SELECT 1 FROM chart_entries ce_d WHERE ce_d.artist_beatport_id = ls.artist_beatport_id AND ce_d.snapshot_date >= $4::date AND ce_d.snapshot_date <= $5::date))`;
  const dateConditionAll =
    ` AND (($3::date IS NULL AND $4::date IS NULL) OR EXISTS (SELECT 1 FROM chart_entries ce_d WHERE ce_d.artist_beatport_id = ls.artist_beatport_id AND ce_d.snapshot_date >= $3::date AND ce_d.snapshot_date <= $4::date))`;
  const contactsCondition = withEmails
    ? " AND EXISTS (SELECT 1 FROM artist_contacts ac_f WHERE ac_f.artist_beatport_id = ls.artist_beatport_id AND ac_f.type = 'email')"
    : withSocials
    ? " AND EXISTS (SELECT 1 FROM artist_links al_f WHERE al_f.artist_beatport_id = ls.artist_beatport_id)"
    : withContacts
    ? " AND EXISTS (SELECT 1 FROM artist_contacts ac_f WHERE ac_f.artist_beatport_id = ls.artist_beatport_id)"
    : "";
  const inWorkCondition = inWork
    ? " AND EXISTS (SELECT 1 FROM lead_profiles lp_w WHERE lp_w.artist_beatport_id = ls.artist_beatport_id AND lp_w.status IS NOT NULL AND lp_w.status <> 'New')"
    : "";

  const getCachedLeads = unstable_cache(
    async () => {
      if (segment) {
        const params: (string | string[] | null)[] = [segment, blocklist, genreParam ?? null, dateFromParam ?? null, dateToParam ?? null];
        const rows = await query<LeadRowV2 & { _total: number }>(
          `SELECT ls.artist_beatport_id, am.artist_name, ls.segment, ls.score::text,
                  am.total_chart_entries, am.first_seen::text AS first_seen, am.last_seen::text AS last_seen,
                  am.genres AS genres,
                  COUNT(*) OVER()::int AS _total
           FROM lead_scores ls
           LEFT JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
           WHERE ls.segment = $1 AND ${blocklistCondition}${genreConditionSeg}${dateConditionSeg}${contactsCondition}${inWorkCondition}
           ORDER BY ${orderByClause}
           LIMIT ${LEADS_PAGE_SIZE} OFFSET ${offset}`,
          params
        );
        return { rows, totalCount: rows[0]?._total ?? 0 };
      }
      const params: (string | string[] | null)[] = [blocklist, genreParam ?? null, dateFromParam ?? null, dateToParam ?? null];
      const rows = await query<LeadRowV2 & { _total: number }>(
        `SELECT ls.artist_beatport_id, am.artist_name, ls.segment, ls.score::text,
                am.total_chart_entries, am.first_seen::text AS first_seen, am.last_seen::text AS last_seen,
                am.genres AS genres,
                COUNT(*) OVER()::int AS _total
         FROM lead_scores ls
         LEFT JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id
         WHERE ${blocklistCondition.replace(/\$2/g, "$1")}${genreConditionAll}${dateConditionAll}${contactsCondition}${inWorkCondition}
         ORDER BY ${orderByClause}
         LIMIT ${LEADS_PAGE_SIZE} OFFSET ${offset}`,
        params
      );
      return { rows, totalCount: rows[0]?._total ?? 0 };
    },
    ["leads", segment ?? "all", genreParam ?? "", dateFromParam ?? "", dateToParam ?? "", sort, order, String(pageNum), withContacts ? "wc" : withEmails ? "we" : withSocials ? "ws" : inWork ? "iw" : ""],
    { revalidate: LEADS_CACHE_REVALIDATE_SEC, tags: ["leads"] }
  );

  try {
    const [leadsResult, genresResult, kpiRow] = await Promise.all([
      getCachedLeads(),
      query<{ g: string }>(
        `SELECT DISTINCT unnest(genres) AS g FROM artist_metrics WHERE genres IS NOT NULL AND array_length(genres, 1) > 0 ORDER BY g LIMIT 800`
      ),
      query<{
        total_leads: number;
        new_today: number;
        with_contacts: number;
        avg_pos: number | null;
        earliest: string | null;
        latest: string | null;
        with_emails: number;
        with_socials: number;
        in_work: number;
      }>(`SELECT
            (SELECT COUNT(*)::int FROM lead_scores) AS total_leads,
            (SELECT COUNT(DISTINCT ls.artist_beatport_id)::int FROM lead_scores ls JOIN artist_metrics am ON am.artist_beatport_id = ls.artist_beatport_id WHERE am.first_seen = CURRENT_DATE) AS new_today,
            (SELECT COUNT(DISTINCT ac.artist_beatport_id)::int FROM artist_contacts ac JOIN lead_scores ls ON ls.artist_beatport_id = ac.artist_beatport_id) AS with_contacts,
            (SELECT ROUND(AVG(sub.best_pos))::int FROM (SELECT MIN(ce.position) AS best_pos FROM chart_entries ce JOIN lead_scores ls ON ls.artist_beatport_id = ce.artist_beatport_id WHERE ce.snapshot_date >= CURRENT_DATE - 7 GROUP BY ce.artist_beatport_id) sub) AS avg_pos,
            (SELECT MIN(snapshot_date)::text FROM chart_entries) AS earliest,
            (SELECT MAX(snapshot_date)::text FROM chart_entries) AS latest,
            (SELECT COUNT(DISTINCT ac.artist_beatport_id)::int FROM artist_contacts ac JOIN lead_scores ls ON ls.artist_beatport_id = ac.artist_beatport_id WHERE ac.type = 'email') AS with_emails,
            (SELECT COUNT(DISTINCT al.artist_beatport_id)::int FROM artist_links al JOIN lead_scores ls ON ls.artist_beatport_id = al.artist_beatport_id) AS with_socials,
            (SELECT COUNT(*)::int FROM lead_profiles WHERE status IS NOT NULL AND status <> 'New') AS in_work
         `),
    ]);
    const { rows, totalCount: total } = leadsResult;
    leads = rows;
    totalCount = total;
    {
      const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const slugMap = new Map<string, string>();
      for (const { g } of genresResult) {
        const slug = toSlug(g);
        const existing = slugMap.get(slug);
        if (!existing || (existing === existing.toLowerCase() && g !== g.toLowerCase())) {
          slugMap.set(slug, g);
        }
      }
      distinctGenres = [...slugMap.values()].sort((a, b) => a.localeCompare(b));
    }
    const k = kpiRow[0];
    kpi = {
      totalLeads: k?.total_leads ?? 0,
      newToday: k?.new_today ?? 0,
      withContacts: k?.with_contacts ?? 0,
      avgPosition: k?.avg_pos ?? 0,
      dataFrom: k?.earliest ?? "",
      dataTo: k?.latest ?? "",
      withEmails: k?.with_emails ?? 0,
      withSocials: k?.with_socials ?? 0,
      inWork: k?.in_work ?? 0,
    };

    if (leads.length > 0) {
      const artistIds = leads.map((r) => r.artist_beatport_id);
      const [posRows, profileRows] = await Promise.all([
        query<{ artist_beatport_id: string; snapshot_date: string; position: number }>(
          `SELECT artist_beatport_id, snapshot_date::text AS snapshot_date, MIN(position)::int AS position
           FROM chart_entries
           WHERE artist_beatport_id = ANY($1::text[]) AND snapshot_date >= CURRENT_DATE - 90
           GROUP BY artist_beatport_id, snapshot_date
           ORDER BY artist_beatport_id, snapshot_date`,
          [artistIds]
        ),
        query<{ artist_beatport_id: string; status: string }>(
          `SELECT artist_beatport_id, status FROM lead_profiles
           WHERE artist_beatport_id = ANY($1::text[]) AND status IS NOT NULL AND status <> 'New'`,
          [artistIds]
        ),
      ]);
      for (const row of posRows) {
        if (!positionHistory[row.artist_beatport_id]) positionHistory[row.artist_beatport_id] = [];
        positionHistory[row.artist_beatport_id].push({ date: row.snapshot_date, position: row.position });
      }
      for (const row of profileRows) {
        leadStatuses[row.artist_beatport_id] = row.status;
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Помилка завантаження.";
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />

      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-5 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-[var(--text)]">Ліди</h1>
          <BptoptrackerBackfill />
        </div>

        {/* KPI cards */}
        {!error && (
          <div className="mb-5 grid grid-cols-3 gap-3 sm:grid-cols-6">
            <div className="kpi-card rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
              <div className="text-2xl font-bold tabular-nums text-[var(--text)]">{kpi.totalLeads.toLocaleString()}</div>
              <div className="mt-0.5 text-xs text-[var(--text-muted)]">Всього лідів</div>
            </div>
            <div className="kpi-card rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
              <div className="text-2xl font-bold tabular-nums text-[var(--accent)]">{kpi.newToday}</div>
              <div className="mt-0.5 text-xs text-[var(--text-muted)]">Нових сьогодні</div>
            </div>
            <Link
              href={inWork ? "/leads" : "/leads?inWork=1"}
              className={`kpi-card rounded-lg border px-4 py-3 transition-colors ${inWork ? "border-[#fbbf24]/50 bg-[#fbbf24]/10" : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[#fbbf24]/30"}`}
            >
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 shrink-0 text-[#fbbf24]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                <div className="text-2xl font-bold tabular-nums text-[var(--text)]">{kpi.inWork}</div>
              </div>
              <div className="mt-0.5 text-xs text-[var(--text-muted)]">В роботі</div>
            </Link>
            <Link
              href={withEmails ? "/leads" : "/leads?withEmails=1"}
              className={`kpi-card rounded-lg border px-4 py-3 transition-colors ${withEmails ? "border-[#60a5fa]/50 bg-[#60a5fa]/10" : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[#60a5fa]/30"}`}
            >
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 shrink-0 text-[#60a5fa]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                <div className="text-2xl font-bold tabular-nums text-[var(--text)]">{kpi.withEmails}</div>
              </div>
              <div className="mt-0.5 text-xs text-[var(--text-muted)]">З email</div>
            </Link>
            <Link
              href={withSocials ? "/leads" : "/leads?withSocials=1"}
              className={`kpi-card rounded-lg border px-4 py-3 transition-colors ${withSocials ? "border-[#c084fc]/50 bg-[#c084fc]/10" : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[#c084fc]/30"}`}
            >
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 shrink-0 text-[#c084fc]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                <div className="text-2xl font-bold tabular-nums text-[var(--text)]">{kpi.withSocials}</div>
              </div>
              <div className="mt-0.5 text-xs text-[var(--text-muted)]">З соцмережами</div>
            </Link>
            <div className="kpi-card rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
              <div className="text-2xl font-bold tabular-nums text-[var(--text)]">{kpi.avgPosition > 0 ? `#${kpi.avgPosition}` : "—"}</div>
              <div className="mt-0.5 text-xs text-[var(--text-muted)]">Сер. позиція (7д)</div>
            </div>
          </div>
        )}

        {/* Data range hint */}
        {!error && kpi.dataFrom && (
          <div className="mb-4 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <svg className="h-3.5 w-3.5 shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span>Дані: <span className="tabular-nums font-medium text-[var(--text)]">{formatDateDDMMYYYY(kpi.dataFrom)}</span> — <span className="tabular-nums font-medium text-[var(--text)]">{formatDateDDMMYYYY(kpi.dataTo)}</span></span>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-[var(--text-muted)]">Сегмент:</span>
            <Link
              href={buildQuery({ genre: genreParam ?? undefined, dateFrom: dateFromParam ?? undefined, dateTo: dateToParam ?? undefined, sort, order })}
              className={`rounded px-2 py-1 text-sm ${!segment ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]" : "bg-[var(--bg-card)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"}`}
            >
              всі
            </Link>
            {SEGMENTS_V2.map((s) => {
              const colors = SEGMENT_CHIP_COLORS[s];
              const isActive = segment === s;
              return (
                <Link
                  key={s}
                  href={buildQuery({ segment: s, genre: genreParam ?? undefined, dateFrom: dateFromParam ?? undefined, dateTo: dateToParam ?? undefined, sort, order })}
                  className={`rounded px-2 py-1 text-sm font-medium transition-colors ${isActive ? "" : "bg-[var(--bg-card)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"}`}
                  style={isActive && colors ? { backgroundColor: colors.activeBg, color: colors.activeText } : undefined}
                >
                  {SEGMENT_LABELS[s] ?? s}
                </Link>
              );
            })}
          </div>
          <LeadsDateRangeFilter
            segment={segment ?? undefined}
            genre={genreParam ?? undefined}
            dateFrom={dateFromParam ?? undefined}
            dateTo={dateToParam ?? undefined}
            sort={sort}
            order={order}
          />
          {!error && (
            <RunEnrichmentOnLeadsButton
              segment={segment ?? null}
              genre={genreParam ?? null}
              dateFrom={dateFromParam ?? null}
              dateTo={dateToParam ?? null}
            />
          )}
        </div>

        {error && (
          <p className="mb-4 rounded bg-amber-500/20 px-3 py-2 text-sm text-amber-200">
            {error}
          </p>
        )}

        {!error && leads.length === 0 && (
          <p className="text-[var(--text-muted)]">
            {genreParam ? "Немає лідів з обраним жанром." : "Лідів немає."}
          </p>
        )}

        {!error && leads.length > 0 && (
          <LeadsTable
            leads={leads}
            positionHistory={positionHistory}
            leadStatuses={leadStatuses}
            segmentLabels={SEGMENT_LABELS}
            totalCount={totalCount}
            offset={offset}
            pageSize={LEADS_PAGE_SIZE}
            segment={segment}
            genre={genreParam}
            dateFrom={dateFromParam}
            dateTo={dateToParam}
            sort={sort}
            order={order}
            pageNum={pageNum}
            genres={distinctGenres}
          />
        )}
      </main>
    </div>
  );
}
