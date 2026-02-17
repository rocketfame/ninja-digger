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
  const needsUpdate = backfillFrom <= today;

  const runBackfill = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/internal/bptoptracker/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          genreSlug: "__all__",
          dateFrom: backfillFrom,
          dateTo: today,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        playSuccessSound();
        let text = `+${data.totalInserted} записів`;
        if (data.sync) {
          text += ` · ${data.sync.chartEntriesInserted} у чарти · ${data.sync.scoresUpdated} лідів`;
        }
        if (data.errors?.length) {
          text += ` · ${data.errors.length} помилок`;
        }
        toast(text, "success");
        if (data.lastDateInDb) setLastDate(data.lastDateInDb);
        else setLastDate(today);
        router.refresh();
      } else {
        toast(data.error ?? "Помилка", "error");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Помилка", "error");
    } finally {
      setLoading(false);
    }
  }, [backfillFrom, today, router, toast]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-[var(--text-muted)]">
        BPTT до {lastDate != null ? formatDateDDMMYYYY(lastDate) : "—"}
      </span>
      <button
        type="button"
        onClick={runBackfill}
        disabled={loading || !needsUpdate}
        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2.5 py-1 text-xs font-medium text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
      >
        {loading && <ButtonSpinner />}
        {loading
          ? "Оновлення…"
          : needsUpdate
            ? `Оновити до ${formatDateDDMMYYYY(today)}`
            : "✓ Актуально"}
      </button>
    </div>
  );
}
