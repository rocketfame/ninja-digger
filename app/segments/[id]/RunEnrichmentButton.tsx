"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonSpinner } from "@/app/components/ButtonSpinner";
import { playSuccessSound } from "@/lib/successSound";

const DELAY_BETWEEN_BATCHES_MS = 800;
/** ~52s per 2 artists → ~26s per artist. ETA = remaining * 26s. */
const SECONDS_PER_ARTIST_ETA = 26;

export function RunEnrichmentButton({ segmentId }: { segmentId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [forceReRun, setForceReRun] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    let totalProcessed = 0;
    let totalLinks = 0;
    let totalContacts = 0;
    let lastRemaining: number | null = null;
    const allArtists: { artist_beatport_id: string; artist_name: string | null }[] = [];
    try {
      for (;;) {
        const url = `/api/internal/enrich/segment?segmentId=${encodeURIComponent(segmentId)}${forceReRun ? "&force=1" : ""}`;
        const res = await fetch(url, { method: "POST" });
        const data = await res.json();
        if (!data.ok) {
          setMessage(data.error ?? "Помилка");
          break;
        }
        const processed = data.processed ?? 0;
        if (data.artists?.length) allArtists.push(...data.artists);
        totalProcessed += processed;
        totalLinks += data.linksAdded ?? 0;
        totalContacts += data.contactsAdded ?? 0;
        lastRemaining = data.remaining ?? null;
        if (processed > 0) {
          const remainingStr =
            lastRemaining != null && lastRemaining > 0
              ? ` Залишилось: ${lastRemaining}. Продовжуємо…`
              : "";
          const etaMin =
            lastRemaining != null && lastRemaining > 0
              ? Math.ceil((lastRemaining * SECONDS_PER_ARTIST_ETA) / 60)
              : 0;
          const etaStr = etaMin > 0 ? ` (орієнтовно ~${etaMin} хв)` : "";
          setMessage(
            `Оброблено ${totalProcessed} артистів. Посилань: ${totalLinks}, контактів: ${totalContacts}.${remainingStr}${etaStr}`
          );
        }
        if (processed === 0) {
          if (totalProcessed > 0) {
            playSuccessSound();
            const names = allArtists.map((a) => a.artist_name?.trim() || a.artist_beatport_id);
            const listText =
              names.length <= 15
                ? names.join(", ")
                : names.slice(0, 15).join(", ") + ` та ще ${names.length - 15}`;
            setMessage(
              `Готово. Знайдено ${totalProcessed} артистів: ${listText}. Посилань: ${totalLinks}, контактів: ${totalContacts}.`
            );
          } else {
            setMessage(
              lastRemaining === 0
                ? "Усі артисти вже мають дані. Увімкніть «Перезапустити навіть якщо є дані», щоб шукати знову."
                : "Немає артистів у сегменті."
            );
          }
          break;
        }
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
      }
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Помилка запиту");
    } finally {
      setLoading(false);
    }
  }, [segmentId, forceReRun, router]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <input
            type="checkbox"
            checked={forceReRun}
            onChange={(e) => setForceReRun(e.target.checked)}
            disabled={loading}
            className="rounded border-[var(--border)]"
          />
          Перезапустити навіть якщо є дані
        </label>
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          {loading && <ButtonSpinner />}
          {loading ? "Виконується…" : "Запустити пошук контактів пачкою"}
        </button>
      </div>
      {message && <p className="text-sm text-[var(--text-muted)] whitespace-pre-wrap">{message}</p>}
      <p className="text-xs text-[var(--text-muted)]">
        За замовчуванням обробляються лише артисти без жодного посилання чи контакту. Увімкніть «Перезапустити навіть якщо є дані», щоб повторно шукати для вже заповнених.
      </p>
    </div>
  );
}
