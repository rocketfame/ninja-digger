"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonSpinner } from "@/app/components/ButtonSpinner";
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
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [forceReRun, setForceReRun] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    const params = new URLSearchParams();
    if (segment) params.set("segment", segment);
    if (genre) params.set("genre", genre);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (forceReRun) params.set("force", "1");
    const baseUrl = `/api/internal/enrich/leads?${params.toString()}`;

    let totalProcessed = 0;
    let totalLinks = 0;
    let totalContacts = 0;
    let lastRemaining: number | null = null;
    const allArtists: { artist_beatport_id: string; artist_name: string | null }[] = [];
    try {
      for (;;) {
        const res = await fetch(baseUrl, { method: "POST" });
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
          setMessage(
            `Оброблено ${totalProcessed} артистів. Посилань: ${totalLinks}, контактів: ${totalContacts}.` +
              (lastRemaining != null && lastRemaining > 0 ? ` Залишилось без даних: ${lastRemaining}. Продовжуємо…` : "")
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
                : "Немає артистів у поточному фільтрі."
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
  }, [segment, genre, dateFrom, dateTo, forceReRun, router]);

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
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 text-sm font-medium text-[var(--text)] shadow-sm hover:bg-[var(--bg-hover)] disabled:opacity-50"
        >
          {loading && <ButtonSpinner />}
          {loading ? "Виконується…" : "Пошук контактів на цей набір"}
        </button>
      </div>
      {message && <p className="text-sm text-[var(--text-muted)] whitespace-pre-wrap">{message}</p>}
      <p className="text-xs text-[var(--text-muted)]">
        Запускає пошук посилань та контактів для артистів поточного фільтра (сегмент, жанр, дати). За замовчуванням
        пропускаються артисти, у яких уже є дані.
      </p>
    </div>
  );
}
