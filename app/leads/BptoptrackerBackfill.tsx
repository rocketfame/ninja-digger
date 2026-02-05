"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

export function BptoptrackerBackfill() {
  const router = useRouter();
  const [genreSlug, setGenreSlug] = useState("afro-house");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const runBackfill = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/internal/bptoptracker/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          genreSlug: genreSlug.trim(),
          dateFrom: dateFrom.trim(),
          dateTo: dateTo.trim(),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setMessage({
          ok: true,
          text: `Inserted ${data.totalInserted}, skipped ${data.totalSkipped} (${data.datesRequested} days). ${data.errors?.length ? "Errors: " + data.errors.join("; ") : ""}`,
        });
        router.refresh();
      } else {
        setMessage({ ok: false, text: data.error ?? "Failed" });
      }
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setLoading(false);
    }
  }, [genreSlug, dateFrom, dateTo, router]);

  return (
    <section className="mb-6 rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-stone-700">BP Top Tracker — backfill (ретро 2–3 міс.)</h2>
      <p className="mb-3 text-xs text-stone-500">
        Заповнити базу даних за минулі дні. Задай BPTOPTRACKER_EMAIL та BPTOPTRACKER_PASSWORD у .env.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-stone-500">Жанр (slug)</label>
          <input
            type="text"
            value={genreSlug}
            onChange={(e) => setGenreSlug(e.target.value)}
            placeholder="afro-house"
            className="mt-0.5 w-32 rounded border border-stone-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-stone-500">З дати</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="mt-0.5 rounded border border-stone-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-stone-500">По дату</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="mt-0.5 rounded border border-stone-300 px-2 py-1.5 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={runBackfill}
          disabled={loading}
          className="rounded bg-stone-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-600 disabled:opacity-50"
        >
          {loading ? "Backfill…" : "Запустити backfill"}
        </button>
      </div>
      {message && (
        <p className={`mt-2 text-sm ${message.ok ? "text-emerald-700" : "text-red-600"}`}>
          {message.text}
        </p>
      )}

      <div className="mt-4 pt-4 border-t border-stone-200">
        <p className="mb-2 text-xs text-stone-600">
          Після backfill натисни «Синхронізувати ретро з лідами» — артисти, які збігаються за іменем з уже відомими (Beatport) або мають ручну привʼязку, потраплять у таблицю лідів нижче.
        </p>
        <BptoptrackerSyncButton onDone={() => router.refresh()} />
      </div>
    </section>
  );
}

function BptoptrackerSyncButton({ onDone }: { onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const runSync = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/internal/bptoptracker/sync", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setMsg({
          ok: true,
          text: `Додано ${data.chartEntriesInserted} записів, ${data.artistsMatched} артистів → оновлено ${data.metricsUpdated} метрик, ${data.scoresUpdated} лідів. ${data.errors?.length ? "Помилки: " + data.errors.slice(0, 3).join("; ") : ""}`,
        });
        onDone();
      } else {
        setMsg({ ok: false, text: data.error ?? "Failed" });
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setLoading(false);
    }
  }, [onDone]);

  return (
    <>
      <button
        type="button"
        onClick={runSync}
        disabled={loading}
        className="rounded bg-stone-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
      >
        {loading ? "Синхронізація…" : "Синхронізувати ретро з лідами"}
      </button>
      {msg && (
        <p className={`mt-2 text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>
          {msg.text}
        </p>
      )}
    </>
  );
}
