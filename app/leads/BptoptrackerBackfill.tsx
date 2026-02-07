"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonSpinner } from "@/app/components/ButtonSpinner";
import { playSuccessSound } from "@/lib/successSound";
import { BPTOPTRACKER_GENRES } from "@/lib/bptoptrackerGenres";

const ALL_GENRES_VALUE = "__all__";

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
        playSuccessSound();
        const errText = data.errors?.length ? "Помилки: " + data.errors.slice(0, 5).join("; ") + (data.errors.length > 5 ? ` … ще ${data.errors.length - 5}` : "") : "";
        const rangeText = data.genresProcessed
          ? `${data.genresProcessed} жанрів, ${data.datesRequested} днів`
          : `${data.datesRequested} днів`;
        setMessage({
          ok: true,
          text: `Вставлено ${data.totalInserted}, пропущено ${data.totalSkipped} (${rangeText}). ${errText}${data.hint ?? ""}`.trim(),
        });
        router.refresh();
      } else {
        setMessage({ ok: false, text: data.error ?? "Помилка" });
      }
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Помилка запиту" });
    } finally {
      setLoading(false);
    }
  }, [genreSlug, dateFrom, dateTo, router]);

  return (
    <section className="mb-6 rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-stone-700">BP Top Tracker — backfill (ретро 2–3 міс.)</h2>
      <p className="mb-3 text-xs text-stone-500">
        Заповнити базу даних за минулі дні. Задай BPTOPTRACKER_EMAIL та BPTOPTRACKER_PASSWORD у .env. Жанр має збігатися з URL на bptoptracker.com (наприклад tech-house, house, trance, afro-house).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-stone-500">Жанр</label>
          <select
            value={genreSlug}
            onChange={(e) => setGenreSlug(e.target.value)}
            className="mt-0.5 w-56 rounded border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-800"
          >
            <option value={ALL_GENRES_VALUE}>Усі жанри</option>
            {BPTOPTRACKER_GENRES.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
          {genreSlug === ALL_GENRES_VALUE && (
            <p className="mt-1 text-xs text-amber-700">Макс. 60 днів за запуск.</p>
          )}
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
          className="inline-flex items-center justify-center gap-2 rounded bg-stone-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-600 disabled:opacity-50"
        >
          {loading && <ButtonSpinner />}
          {loading
            ? (() => {
                const from = new Date(dateFrom).getTime();
                const to = new Date(dateTo).getTime();
                const days = Number.isFinite(from) && Number.isFinite(to) ? Math.max(1, Math.ceil((to - from) / 86400000) + 1) : 30;
                const genresCount = genreSlug === ALL_GENRES_VALUE ? BPTOPTRACKER_GENRES.length : 1;
                const secPerSlot = genreSlug === ALL_GENRES_VALUE ? 2.5 : 4;
                const min = Math.max(1, Math.ceil((days * genresCount * secPerSlot) / 60));
                return `Виконується… (${min <= 1 ? "до 1 хв" : `~${min} хв`})`;
              })()
            : "Запустити backfill"}
        </button>
        <CleanJunkButton onDone={() => router.refresh()} />
        <DebugOneDayButton genreSlug={genreSlug} dateTo={dateTo} disabled={genreSlug === ALL_GENRES_VALUE} />
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

function DebugOneDayButton({ genreSlug, dateTo, disabled }: { genreSlug: string; dateTo: string; disabled?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(
        `/api/internal/bptoptracker/debug?genre=${encodeURIComponent(genreSlug.trim())}&date=${encodeURIComponent(dateTo.trim())}`
      );
      const data = await res.json();
      setResult(data.error ? { error: data.error } : data);
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Помилка запиту" });
    } finally {
      setLoading(false);
    }
  }, [genreSlug, dateTo]);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={run}
        disabled={loading || disabled}
        className="inline-flex items-center justify-center gap-2 rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-50"
      >
        {loading && <ButtonSpinner className="text-stone-500" />}
        {loading ? "Перевірка… (до 10 с)" : "Перевірити один день"}
      </button>
      {result && (
        <pre className="mt-1 max-h-40 overflow-auto rounded border border-stone-200 bg-stone-50 p-2 text-xs text-stone-700">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

function CleanJunkButton({ onDone }: { onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const runClean = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/internal/bptoptracker/clean", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        playSuccessSound();
        setMsg({ ok: true, text: `Видалено сміттєвих записів: ${data.deleted}` });
        onDone();
      } else {
        setMsg({ ok: false, text: data.error ?? "Помилка" });
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Помилка запиту" });
    } finally {
      setLoading(false);
    }
  }, [onDone]);

  return (
    <>
      <button
        type="button"
        onClick={runClean}
        disabled={loading}
        className="inline-flex items-center justify-center gap-2 rounded border border-amber-400 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
      >
        {loading && <ButtonSpinner className="text-amber-700" />}
        {loading ? "Очищення… (кілька секунд)" : "Очистити сміттєві записи"}
      </button>
      {msg && (
        <p className={`mt-2 text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>
      )}
    </>
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
        playSuccessSound();
        setMsg({
          ok: true,
          text: `Додано ${data.chartEntriesInserted} записів, ${data.artistsMatched} артистів → оновлено ${data.metricsUpdated} метрик, ${data.scoresUpdated} лідів. ${data.errors?.length ? "Помилки: " + data.errors.slice(0, 3).join("; ") : ""}`,
        });
        onDone();
      } else {
        setMsg({ ok: false, text: data.error ?? "Помилка" });
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Помилка запиту" });
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
        className="inline-flex items-center justify-center gap-2 rounded bg-stone-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
      >
        {loading && <ButtonSpinner />}
        {loading ? "Синхронізація… (оптимізовано)" : "Синхронізувати ретро з лідами"}
      </button>
      {msg && (
        <p className={`mt-2 text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>
          {msg.text}
        </p>
      )}
    </>
  );
}
