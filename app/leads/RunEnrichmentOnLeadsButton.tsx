"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonSpinner } from "@/app/components/ButtonSpinner";
import { useToast } from "@/app/components/Toast";
import { playSuccessSound } from "@/lib/successSound";

const DELAY_BETWEEN_BATCHES_MS = 800;

type Props = {
  segment: string | null;
  genre: string | null;
  dateFrom: string | null;
  dateTo: string | null;
};

export function RunEnrichmentOnLeadsButton({ segment, genre, dateFrom, dateTo }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setProgress(null);
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
              (remaining != null && remaining > 0 ? ` · ще ${remaining}…` : "")
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
      {progress && <span className="text-xs text-[var(--text-muted)]">{progress}</span>}
    </div>
  );
}
