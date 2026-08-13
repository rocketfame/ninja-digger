"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonSpinner } from "@/app/components/ButtonSpinner";
import { useToast } from "@/app/components/Toast";
import { playSuccessSound } from "@/lib/successSound";

const DELAY_BETWEEN_BATCHES_MS = 800;
/** ~3 artists per batch, a batch takes ~60-90s. */
const ARTISTS_PER_MINUTE = 2.5;

type Props = {
  segment: string | null;
  genre: string | null;
  dateFrom: string | null;
  dateTo: string | null;
};

function formatEta(remaining: number): string {
  const minutes = Math.ceil(remaining / ARTISTS_PER_MINUTE);
  if (minutes < 60) return `~${minutes} хв`;
  return `~${Math.round(minutes / 60)} год`;
}

export function RunEnrichmentOnLeadsButton({ segment, genre, dateFrom, dateTo }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const stopRef = useRef(false);

  const run = useCallback(async () => {
    setLoading(true);
    stopRef.current = false;
    const params = new URLSearchParams();
    if (segment) params.set("segment", segment);
    if (genre) params.set("genre", genre);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    const baseUrl = `/api/internal/enrich/leads?${params.toString()}`;

    let totalProcessed = 0;
    let totalLinks = 0;
    let totalContacts = 0;
    try {
      // Preflight: instant queue size so the user sees scale before the first slow batch
      setProgress("Рахую чергу…");
      const pre = await fetch(`${baseUrl}&countOnly=1`, { method: "POST" }).then((r) => r.json()).catch(() => null);
      const queueSize = pre?.remaining ?? null;
      if (queueSize === 0) {
        toast("Усі артисти під цим фільтром уже оброблені.", "info");
        setProgress(null);
        setLoading(false);
        return;
      }
      if (queueSize != null) {
        setProgress(`У черзі ${queueSize} артистів (${formatEta(queueSize)}) · батч 1 — до 2 хв…`);
        if (queueSize > 50) {
          toast(`Знайдено ${queueSize} незбагачених артистів — це ${formatEta(queueSize)}. Великі обсяги крон обробляє сам щогодини; кнопку можна зупинити будь-коли.`, "info");
        }
      }

      for (;;) {
        const res = await fetch(baseUrl, { method: "POST" });
        const data = await res.json();
        if (!data.ok) {
          toast(data.error ?? "Помилка", "error");
          break;
        }
        const processed = data.processed ?? 0;
        totalProcessed += processed;
        totalLinks += data.linksAdded ?? 0;
        totalContacts += data.contactsAdded ?? 0;
        const remaining = data.remaining ?? null;
        if (processed > 0) {
          setProgress(
            `${totalProcessed} артистів · ${totalLinks} посилань · ${totalContacts} контактів` +
              (remaining != null && remaining > 0 ? ` · ще ${remaining} (${formatEta(remaining)})` : "")
          );
        }
        if (processed === 0) {
          if (totalProcessed > 0) {
            playSuccessSound();
            toast(`Готово: ${totalProcessed} артистів · ${totalLinks} посилань · ${totalContacts} контактів`, "success");
          } else {
            toast(remaining === 0 ? "Усі артисти оброблені." : "Немає артистів для обробки.", "info");
          }
          setProgress(null);
          break;
        }
        if (stopRef.current) {
          toast(`Зупинено: ${totalProcessed} артистів · ${totalContacts} контактів. Решту добере крон.`, "info");
          setProgress(null);
          break;
        }
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
      }
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Помилка", "error");
    } finally {
      setLoading(false);
    }
  }, [segment, genre, dateFrom, dateTo, router, toast]);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[var(--accent-hover)] disabled:opacity-50"
      >
        {loading ? (
          <ButtonSpinner />
        ) : (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        )}
        {loading ? "Пошук…" : "Пошук контактів"}
      </button>
      {loading && (
        <button
          type="button"
          onClick={() => { stopRef.current = true; setProgress((p) => (p ? `${p} · зупиняю після батчу…` : "Зупиняю…")); }}
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          Стоп
        </button>
      )}
      {progress && <span className="text-xs text-[var(--text-muted)]">{progress}</span>}
    </div>
  );
}
