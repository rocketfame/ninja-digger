"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export function BptoptrackerFilters({
  genres,
  currentGenre,
  currentDateFrom,
  currentDateTo,
}: {
  genres: string[];
  currentGenre: string;
  currentDateFrom: string;
  currentDateTo: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const apply = useCallback(
    (updates: { genre?: string; dateFrom?: string; dateTo?: string }) => {
      const p = new URLSearchParams(searchParams.toString());
      if (updates.genre !== undefined) (updates.genre ? p.set("genre", updates.genre) : p.delete("genre"));
      if (updates.dateFrom !== undefined) (updates.dateFrom ? p.set("dateFrom", updates.dateFrom) : p.delete("dateFrom"));
      if (updates.dateTo !== undefined) (updates.dateTo ? p.set("dateTo", updates.dateTo) : p.delete("dateTo"));
      router.push(`/bptoptracker?${p.toString()}`);
    },
    [router, searchParams]
  );

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3">
      <div>
        <label className="block text-xs text-[var(--text-muted)]">Жанр</label>
        <select
          value={currentGenre}
          onChange={(e) => apply({ genre: e.target.value })}
          className="mt-0.5 rounded border border-[var(--border)] bg-[var(--bg-hover)] px-2 py-1.5 text-sm text-[var(--text)]"
        >
          <option value="">Усі</option>
          {genres.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs text-[var(--text-muted)]">З дати</label>
        <input
          type="date"
          value={currentDateFrom}
          onChange={(e) => apply({ dateFrom: e.target.value })}
          className="mt-0.5 rounded border border-[var(--border)] bg-[var(--bg-hover)] px-2 py-1.5 text-sm text-[var(--text)]"
        />
      </div>
      <div>
        <label className="block text-xs text-[var(--text-muted)]">По дату</label>
        <input
          type="date"
          value={currentDateTo}
          onChange={(e) => apply({ dateTo: e.target.value })}
          className="mt-0.5 rounded border border-[var(--border)] bg-[var(--bg-hover)] px-2 py-1.5 text-sm text-[var(--text)]"
        />
      </div>
    </div>
  );
}
