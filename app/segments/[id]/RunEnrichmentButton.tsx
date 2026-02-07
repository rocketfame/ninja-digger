"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonSpinner } from "@/app/components/ButtonSpinner";
import { playSuccessSound } from "@/lib/successSound";

export function RunEnrichmentButton({ segmentId }: { segmentId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/internal/enrich/segment?segmentId=${encodeURIComponent(segmentId)}`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.ok) {
        playSuccessSound();
        setMessage(`Оброблено ${data.processed ?? 0} артистів. Посилань: ${data.linksAdded ?? 0}, контактів: ${data.contactsAdded ?? 0}.`);
        router.refresh();
      } else {
        setMessage(data.error ?? "Помилка");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Помилка запиту");
    } finally {
      setLoading(false);
    }
  }, [segmentId, router]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50 disabled:opacity-50"
      >
        {loading && <ButtonSpinner />}
        {loading ? "Виконується…" : "Запустити Enrichment"}
      </button>
      {message && <span className="text-sm text-stone-600">{message}</span>}
    </div>
  );
}
