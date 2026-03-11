"use client";

import Link from "next/link";
import { useRef, useState, useEffect } from "react";

function toSlug(g: string): string {
  return g.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function prettifyGenre(g: string): string {
  if (g !== g.toLowerCase() || !g.includes("-")) return g;
  return g.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildQuery(params: { segment?: string; genre?: string; dateFrom?: string; dateTo?: string; sort?: string; order?: string; page?: number }) {
  const q = new URLSearchParams();
  if (params.segment) q.set("segment", params.segment);
  if (params.genre) q.set("genre", params.genre);
  if (params.dateFrom) q.set("dateFrom", params.dateFrom);
  if (params.dateTo) q.set("dateTo", params.dateTo);
  if (params.sort && params.sort !== "score") q.set("sort", params.sort);
  if (params.order && params.order !== "desc") q.set("order", params.order);
  if (params.page && params.page > 1) q.set("page", String(params.page));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function LeadsGenreHeader({
  segment,
  genre,
  dateFrom,
  dateTo,
  sort,
  order,
  genres,
}: {
  segment?: string;
  genre?: string;
  dateFrom?: string;
  dateTo?: string;
  sort: string;
  order: string;
  genres: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 font-medium text-[var(--text)] hover:text-[var(--accent)]"
      >
        {genre ? prettifyGenre(genre) : "Жанр"}
        <span className="text-[var(--text-muted)]">{open ? " ▲" : " ▼"}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 max-h-64 min-w-[12rem] overflow-auto rounded border border-[var(--border)] bg-[var(--bg-card)] py-1 shadow-lg">
          <Link
            href={`/leads${buildQuery({ segment, dateFrom, dateTo, sort, order, page: 1 })}`}
            onClick={() => setOpen(false)}
            className={`block px-3 py-1.5 text-sm hover:bg-[var(--bg-hover)] ${!genre ? "bg-[var(--accent)]/20 text-[var(--accent)]" : "text-[var(--text)]"}`}
          >
            Усі жанри
          </Link>
          {genres.map((g) => (
            <Link
              key={g}
              href={`/leads${buildQuery({ segment, genre: toSlug(g), dateFrom, dateTo, sort, order, page: 1 })}`}
              onClick={() => setOpen(false)}
              className={`block px-3 py-1.5 text-sm hover:bg-[var(--bg-hover)] ${genre === toSlug(g) || genre === g ? "bg-[var(--accent)]/20 text-[var(--accent)]" : "text-[var(--text)]"}`}
            >
              {prettifyGenre(g)}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
