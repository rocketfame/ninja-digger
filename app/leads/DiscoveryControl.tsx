"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OracleModal } from "./OracleModal";
import { ButtonSpinner } from "@/app/components/ButtonSpinner";
import { playSuccessSound } from "@/lib/successSound";

type Run = {
  id: string;
  status: string;
  stage: string | null;
  progress: string | null;
  started_at: string;
  finished_at: string | null;
  charts_count: number | null;
  artists_count: number | null;
  leads_count: number | null;
  error_message: string | null;
};

const POLL_INTERVAL_MS = 2500;

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

export function DiscoveryControl() {
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(false);
  const [trigger, setTrigger] = useState(0);
  const [oracleOpen, setOracleOpen] = useState(false);
  const router = useRouter();
  const prevStatusRef = useRef<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/internal/discovery/status");
      const data = await res.json();
      const nextRun = data.run ?? null;
      const nextStatus = nextRun?.status ?? null;
      if (prevStatusRef.current === "running" && nextStatus === "completed") {
        playSuccessSound();
      }
      prevStatusRef.current = nextStatus;
      setRun(nextRun);
    } catch {
      setRun(null);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus, trigger]);

  useEffect(() => {
    if (!loading && run?.status !== "running") return;
    const t = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [loading, run?.status, fetchStatus]);

  const handleRun = async () => {
    if (loading || run?.status === "running") return;
    setLoading(true);
    try {
      const res = await fetch("/api/internal/discovery/run", { method: "POST" });
      const data = await res.json();
      if (data.run) setRun(data.run);
      else setTrigger((x) => x + 1);
    } catch {
      setTrigger((x) => x + 1);
    } finally {
      setLoading(false);
    }
  };

  const isRunning = run?.status === "running" || loading;
  const lastRun = run?.finished_at ? run.started_at : null;
  const statusLabel =
    run?.status === "running"
      ? "Running"
      : run?.status === "completed"
        ? "Completed"
        : run?.status === "error"
          ? "Error"
          : "Idle";

  const statusBadge = {
    Idle: (
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-hover)] px-2 py-0.5 text-xs font-medium text-[var(--text-muted)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" /> Очікує
      </span>
    ),
    Running: (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-300">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" /> Виконується… (до 10 хв)
      </span>
    ),
    Completed: (
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)]/20 px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" /> Завершено
      </span>
    ),
    Error: (
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--danger)]/20 px-2 py-0.5 text-xs font-medium text-red-400">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--danger)]" /> Помилка
      </span>
    ),
  };

  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleRun}
            disabled={isRunning}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRunning && <ButtonSpinner />}
            {isRunning ? "Виконується… (до 10 хв)" : "Запустити Discovery"}
          </button>
          <button
            type="button"
            onClick={() => setOracleOpen(true)}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 text-sm font-medium text-[var(--text)] transition hover:bg-[var(--bg-hover)]"
          >
            Режим Oracle
          </button>
          <OracleModal
            open={oracleOpen}
            onClose={() => setOracleOpen(false)}
            onSaveSegment={() => router.refresh()}
          />
          {statusBadge[statusLabel as keyof typeof statusBadge]}
          {lastRun && (
            <span className="text-xs text-[var(--text-muted)]">
              Останній запуск: {formatTime(lastRun)}
            </span>
          )}
        </div>
        {(run?.charts_count != null || run?.artists_count != null || run?.leads_count != null) && (
          <div className="flex flex-wrap gap-4 text-xs text-[var(--text-muted)]">
            {run.charts_count != null && (
              <span>{run.charts_count} чартів</span>
            )}
            {run.artists_count != null && (
              <span>{run.artists_count} артистів</span>
            )}
            {run.leads_count != null && (
              <span>{run.leads_count} лідів</span>
            )}
          </div>
        )}
      </div>
      {run?.status === "running" && run.progress && (
        <p className="mt-2 text-sm text-[var(--text-muted)]">{run.progress}</p>
      )}
      {run?.status === "completed" && (
        <p className="mt-2 text-sm text-[var(--accent)]">
          ✔ Discovery завершено
          {run.artists_count != null && ` · ${run.artists_count} артистів`}
          {run.leads_count != null && ` · ${run.leads_count} лідів`}
        </p>
      )}
      {run?.status === "error" && run.error_message && (
        <p className="mt-2 text-sm text-red-400">{run.error_message}</p>
      )}
    </section>
  );
}
