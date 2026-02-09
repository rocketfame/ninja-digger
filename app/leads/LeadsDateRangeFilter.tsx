"use client";

import Link from "next/link";
import { useRef, useState, useEffect } from "react";

function toYYYYMMDD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildQuery(params: {
  segment?: string;
  genre?: string;
  dateFrom?: string;
  dateTo?: string;
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

const PRESETS: { key: string; label: string; getRange: () => { from: string; to: string } }[] = [
  { key: "all", label: "Усі дати", getRange: () => ({ from: "", to: "" }) },
  {
    key: "7d",
    label: "Останні 7 днів",
    getRange: () => {
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - 6);
      return { from: toYYYYMMDD(from), to: toYYYYMMDD(to) };
    },
  },
  {
    key: "30d",
    label: "Останні 30 днів",
    getRange: () => {
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - 29);
      return { from: toYYYYMMDD(from), to: toYYYYMMDD(to) };
    },
  },
  {
    key: "90d",
    label: "Останні 90 днів",
    getRange: () => {
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - 89);
      return { from: toYYYYMMDD(from), to: toYYYYMMDD(to) };
    },
  },
  {
    key: "12m",
    label: "Останні 12 міс",
    getRange: () => {
      const to = new Date();
      const from = new Date(to);
      from.setMonth(from.getMonth() - 11);
      return { from: toYYYYMMDD(from), to: toYYYYMMDD(to) };
    },
  },
];

export function LeadsDateRangeFilter({
  segment,
  genre,
  dateFrom,
  dateTo,
  sort,
  order,
}: {
  segment?: string;
  genre?: string;
  dateFrom?: string;
  dateTo?: string;
  sort: string;
  order: string;
}) {
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(dateFrom ?? "");
  const [customTo, setCustomTo] = useState(dateTo ?? "");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  useEffect(() => {
    setCustomFrom(dateFrom ?? "");
    setCustomTo(dateTo ?? "");
  }, [dateFrom, dateTo]);

  const hasRange = Boolean(dateFrom && dateTo);
  const activePreset = hasRange
    ? PRESETS.find((p) => p.key !== "all" && p.getRange().from === dateFrom && p.getRange().to === dateTo)
    : null;
  const presetKey = activePreset?.key ?? (hasRange ? "custom" : "all");

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-hover)]"
      >
        <span className="text-[var(--text-muted)]">Період:</span>
        {presetKey === "all"
          ? "Усі дати"
          : presetKey === "custom"
            ? `${dateFrom ?? "…"} — ${dateTo ?? "…"}`
            : activePreset?.label ?? "Обрати"}
        <span className="text-[var(--text-muted)]">{open ? " ▲" : " ▼"}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded border border-[var(--border)] bg-[var(--bg-card)] p-3 shadow-lg">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Швидкий вибір
          </div>
          <ul className="space-y-0.5">
            {PRESETS.map((p) => {
              const range = p.getRange();
              const href = buildQuery({
                segment,
                genre,
                dateFrom: range.from || undefined,
                dateTo: range.to || undefined,
                sort,
                order,
                page: 1,
              });
              return (
                <li key={p.key}>
                  <Link
                    href={`/leads${href}`}
                    onClick={() => setOpen(false)}
                    className={`block rounded px-2 py-1.5 text-sm hover:bg-[var(--bg-hover)] ${presetKey === p.key ? "bg-[var(--accent)]/20 text-[var(--accent)]" : "text-[var(--text)]"}`}
                  >
                    {p.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 border-t border-[var(--border)] pt-2">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Свій період (від — до)
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="rounded border border-[var(--border)] bg-[var(--bg-page)] px-2 py-1 text-sm text-[var(--text)]"
              />
              <span className="text-[var(--text-muted)]">→</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="rounded border border-[var(--border)] bg-[var(--bg-page)] px-2 py-1 text-sm text-[var(--text)]"
              />
              <Link
                href={`/leads${buildQuery({
                  segment,
                  genre,
                  dateFrom: customFrom || undefined,
                  dateTo: customTo || undefined,
                  sort,
                  order,
                  page: 1,
                })}`}
                onClick={() => setOpen(false)}
                className="rounded bg-[var(--accent)] px-2 py-1 text-sm text-white hover:bg-[var(--accent-hover)]"
              >
                Застосувати
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
