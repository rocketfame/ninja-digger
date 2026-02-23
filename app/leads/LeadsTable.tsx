"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { LeadPositionCell } from "./LeadPositionCell";
import { LeadsGenreHeader } from "./LeadsGenreHeader";
import { formatDateDDMMYYYY } from "@/lib/formatDate";

type Lead = {
  artist_beatport_id: string;
  artist_name: string | null;
  segment: string;
  score: string;
  total_chart_entries: number;
  first_seen: string | null;
  last_seen: string | null;
  genres: string[] | null;
};

const SEGMENT_COLORS: Record<string, { bg: string; text: string }> = {
  NEWCOMER:      { bg: "rgba(34,197,94,0.15)",  text: "#4ade80" },
  NEW_ENTRY:     { bg: "rgba(59,130,246,0.15)",  text: "#60a5fa" },
  CONSISTENT:    { bg: "rgba(168,162,158,0.15)", text: "#a8a29e" },
  FAST_GROWING:  { bg: "rgba(168,85,247,0.15)",  text: "#c084fc" },
  DECLINING:     { bg: "rgba(239,68,68,0.15)",   text: "#f87171" },
  TOP_PERFORMER: { bg: "rgba(250,204,21,0.15)",  text: "#fbbf24" },
};

const STATUS_ICONS: Record<string, { icon: string; color: string }> = {
  "Attempt 1":   { icon: "→",  color: "#60a5fa" },
  "Attempt 2":   { icon: "→→", color: "#818cf8" },
  "Contacted":   { icon: "✓",  color: "#a78bfa" },
  "Responded":   { icon: "←",  color: "#34d399" },
  "In Progress": { icon: "⇄",  color: "#fbbf24" },
  "Won":         { icon: "★",  color: "#22c55e" },
  "No Response": { icon: "✕",  color: "#f97316" },
  "Blacklist":   { icon: "⊘",  color: "#ef4444" },
  "Lost":        { icon: "—",  color: "#6b7280" },
};

type Props = {
  leads: Lead[];
  positionHistory: Record<string, { date: string; position: number }[]>;
  leadStatuses: Record<string, string>;
  flaggedArtistIds?: string[];
  segmentLabels: Record<string, string>;
  totalCount: number;
  offset: number;
  pageSize: number;
  segment: string | null;
  genre: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  sort: string;
  order: string;
  pageNum: number;
  genres: string[];
};

function buildQuery(params: {
  segment?: string | null;
  genre?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  sort?: string;
  order?: string;
  page?: number;
}) {
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

export function LeadsTable({
  leads,
  positionHistory,
  leadStatuses,
  segmentLabels,
  totalCount,
  offset,
  pageSize,
  segment,
  genre,
  dateFrom,
  dateTo,
  sort,
  order,
  pageNum,
  genres,
}: Props) {
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const handleGlobalKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    if (e.key === "Escape" && document.activeElement === searchRef.current) {
      setSearch("");
      searchRef.current?.blur();
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleGlobalKey);
    return () => document.removeEventListener("keydown", handleGlobalKey);
  }, [handleGlobalKey]);

  const filtered = useMemo(() => {
    if (!search.trim()) return leads;
    const q = search.toLowerCase().trim();
    return leads.filter(
      (r) =>
        (r.artist_name ?? r.artist_beatport_id).toLowerCase().includes(q) ||
        (r.genres ?? []).some((g) => g.toLowerCase().includes(q))
    );
  }, [leads, search]);

  const sortLink = (field: string, defaultOrder: string = "desc") => {
    const toggleOrder =
      sort === field
        ? order === "asc"
          ? "desc"
          : "asc"
        : defaultOrder;
    return buildQuery({
      segment,
      genre,
      dateFrom,
      dateTo,
      sort: field,
      order: toggleOrder,
      page: 1,
    });
  };

  const sortArrow = (field: string) =>
    sort === field ? (order === "asc" ? " ↑" : " ↓") : "";

  return (
    <>
      {/* Search + count row */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Пошук артиста…"
            className="h-8 w-60 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] pl-9 pr-8 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
          {!search && (
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-[var(--border)] bg-[var(--bg-page)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--text-muted)]">/</kbd>
          )}
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              ✕
            </button>
          )}
        </div>
        <span className="text-sm text-[var(--text-muted)]">
          {search.trim()
            ? `${filtered.length} з ${leads.length}`
            : `Показано ${offset + 1}–${offset + leads.length}${totalCount > pageSize ? ` з ${totalCount}` : ""} лідів`}
        </span>
      </div>

      {/* Table with sticky header */}
      <div
        className="leads-table-wrap overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg-card)]"
        style={{ maxHeight: "calc(100vh - 260px)" }}
      >
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-[var(--border)] bg-[var(--bg-table-header)] shadow-[0_1px_3px_rgba(0,0,0,0.4)]">
              <th className="px-3 py-2.5 font-medium text-[var(--text)]">
                <Link
                  href={sortLink("artist", "asc")}
                  className="inline-flex items-center gap-1 hover:text-[var(--accent)]"
                >
                  Артист{sortArrow("artist")}
                </Link>
              </th>
              <th className="px-3 py-2.5 font-medium text-[var(--text)]">Сегмент</th>
              <th className="px-3 py-2.5 font-medium text-[var(--text)]">
                <Link
                  href={sortLink("entries")}
                  className="inline-flex items-center gap-1 hover:text-[var(--accent)]"
                >
                  Входжень{sortArrow("entries")}
                </Link>
              </th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium text-[var(--text)]">
                <Link
                  href={sortLink("first_seen")}
                  className="inline-flex items-center gap-1 hover:text-[var(--accent)]"
                >
                  Вперше{sortArrow("first_seen")}
                </Link>
              </th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium text-[var(--text)]">
                <Link
                  href={sortLink("last_seen")}
                  className="inline-flex items-center gap-1 hover:text-[var(--accent)]"
                >
                  Востаннє{sortArrow("last_seen")}
                </Link>
              </th>
              <th className="min-w-[8rem] px-3 py-2.5 font-medium text-[var(--text)]">
                <LeadsGenreHeader
                  segment={segment ?? undefined}
                  genre={genre ?? undefined}
                  dateFrom={dateFrom ?? undefined}
                  dateTo={dateTo ?? undefined}
                  sort={sort}
                  order={order}
                  genres={genres}
                />
              </th>
              <th className="w-[90px] px-2 py-2.5 font-medium text-[var(--text)]">Позиція</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-[var(--text-muted)]">
                  {search.trim() ? "Артистів не знайдено." : "Лідів немає."}
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr
                  key={row.artist_beatport_id}
                  className="group transition-colors duration-100 hover:bg-[var(--bg-hover)]"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <Link
                        href={`/artist/${row.artist_beatport_id.startsWith("bptoptracker:") ? row.artist_beatport_id.replace(/^bptoptracker:/, "") : row.artist_beatport_id}`}
                        className="font-medium text-[var(--accent)] hover:underline"
                      >
                        {(row.artist_name ?? row.artist_beatport_id) || "—"}
                      </Link>
                      {leadStatuses[row.artist_beatport_id] && (() => {
                        const s = STATUS_ICONS[leadStatuses[row.artist_beatport_id]];
                        return s ? (
                          <span
                            className="inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none"
                            style={{ backgroundColor: s.color + "20", color: s.color }}
                            title={leadStatuses[row.artist_beatport_id]}
                          >
                            {s.icon}
                          </span>
                        ) : null;
                      })()}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{
                        backgroundColor: SEGMENT_COLORS[row.segment]?.bg ?? "rgba(168,162,158,0.15)",
                        color: SEGMENT_COLORS[row.segment]?.text ?? "#a8a29e",
                      }}
                    >
                      {segmentLabels[row.segment] ?? row.segment}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-[var(--text)]">
                    {row.total_chart_entries}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[var(--text-muted)]">
                    {formatDateDDMMYYYY(row.first_seen)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[var(--text-muted)]">
                    {formatDateDDMMYYYY(row.last_seen)}
                  </td>
                  <td className="min-w-[8rem] px-3 py-2 text-[var(--text-muted)]">
                    {Array.isArray(row.genres) && row.genres.length > 0
                      ? row.genres.slice(0, 3).join(", ")
                      : "—"}
                  </td>
                  <LeadPositionCell
                    points={positionHistory[row.artist_beatport_id] ?? []}
                    firstSeen={row.first_seen}
                    artistName={row.artist_name}
                    artistBeatportId={row.artist_beatport_id}
                  />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination — hidden when searching */}
      {!search.trim() && leads.length > 0 && totalCount > pageSize && (
        <nav className="mt-4 flex flex-wrap items-center gap-2">
          {pageNum > 1 && (
            <Link
              href={`/leads${buildQuery({ segment, genre, dateFrom, dateTo, sort, order, page: pageNum - 1 })}`}
              className="rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--bg-hover)]"
            >
              ← Попередня
            </Link>
          )}
          <span className="text-sm text-[var(--text-muted)]">
            Сторінка {pageNum} з {Math.ceil(totalCount / pageSize) || 1}
          </span>
          {offset + leads.length < totalCount && (
            <Link
              href={`/leads${buildQuery({ segment, genre, dateFrom, dateTo, sort, order, page: pageNum + 1 })}`}
              className="rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--bg-hover)]"
            >
              Наступна →
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
