"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonSpinner } from "@/app/components/ButtonSpinner";
import { useToast } from "@/app/components/Toast";
import { playSuccessSound } from "@/lib/successSound";
import { formatDateDDMMYYYY } from "@/lib/formatDate";

export function BptoptrackerBackfill() {
  const router = useRouter();
  const { toast } = useToast();
  const [lastDate, setLastDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/internal/bptoptracker/last-date")
      .then((r) => r.json())
      .then((data) => data?.lastSnapshotDate != null && setLastDate(data.lastSnapshotDate))
      .catch(() => {});
  }, []);

  const nextDay = (dateStr: string) => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  };

  const today = new Date().toISOString().slice(0, 10);
  const backfillFrom = lastDate ? nextDay(lastDate) : today;
  const needsDateUpdate = backfillFrom <= today;

  const runRefresh = useCallback(async () => {
    setLoading(true);
    try {
      // Use refresh-now which checks genre coverage for last 7 days
      const res = await fetch("/api/internal/bptoptracker/refresh-now", {
        method: "POST",
      });
      const data = await res.json();
      if (data.ok) {
        playSuccessSound();
        const bpt = data.bptoptracker;
        let text = "";
        if (bpt) {
          text = `+${bpt.inserted} записів`;
          if (bpt.errors?.length) text += ` · ${bpt.errors.length} помилок`;
        }
        if (data.chartEntriesInserted) text += ` · ${data.chartEntriesInserted} у чарти`;
        if (data.scoresUpdated) text += ` · ${data.scoresUpdated} лідів`;
        if (data.fetchedDates?.length === 0) text = data.message ?? "Дані актуальні";
        toast(text || "Оновлено", "success");
        if (data.lastDateInDb) setLastDate(data.lastDateInDb);
        router.refresh();
      } else {
        toast(data.error ?? "Помилка", "error");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Помилка", "error");
    } finally {
      setLoading(false);
    }
  }, [router, toast]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-[var(--text-muted)]">
        BPTT до {lastDate != null ? formatDateDDMMYYYY(lastDate) : "—"}
      </span>
      <button
        type="button"
        onClick={runRefresh}
        disabled={loading}
        title="Оновити дані з BP Top Tracker (перевірить покриття жанрів за останні 7 днів)"
        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2.5 py-1 text-xs font-medium text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
      >
        {loading && <ButtonSpinner />}
        {loading
          ? "Оновлення…"
          : needsDateUpdate
            ? `Оновити до ${formatDateDDMMYYYY(today)}`
            : "Оновити жанри"}
      </button>
    </div>
  );
}
