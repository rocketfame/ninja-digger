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
    d.setMonth(d.getMonth() - 4);
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
        let text = `Вставлено ${data.totalInserted}, пропущено ${data.totalSkipped} (${rangeText}).`;
        if (data.sync) {
          text += ` Синхронізація: ${data.sync.chartEntriesInserted} записів у чарти, ${data.sync.metricsUpdated} метрик, ${data.sync.scoresUpdated} лідів.`;
          if (data.sync.errors?.length) text += " " + data.sync.errors.slice(0, 2).join("; ");
        }
        text += ` ${errText}${data.hint ?? ""}`;
        setMessage({ ok: true, text: text.trim() });
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
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">BP Top Tracker — backfill (ретро до 4 міс.)</h2>
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Заповнити базу даних за минулі дні (за замовчуванням 4 міс.). З чартів підтягуються посилання на артистів з ID — після backfill посилання Beatport/BP Top Tracker зʼявляться на картках артистів. Задай BPTOPTRACKER_EMAIL та BPTOPTRACKER_PASSWORD у .env. Жанр має збігатися з URL на bptoptracker.com (наприклад tech-house, house, trance, afro-house).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-[var(--text-muted)]">Жанр</label>
          <select
            value={genreSlug}
            onChange={(e) => setGenreSlug(e.target.value)}
            className="mt-0.5 w-56 rounded border border-[var(--border)] bg-[var(--bg-page)] px-2 py-1.5 text-sm text-[var(--text)]"
          >
            <option value={ALL_GENRES_VALUE}>Усі жанри</option>
            {BPTOPTRACKER_GENRES.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
          {genreSlug === ALL_GENRES_VALUE && (
            <p className="mt-1 text-xs text-amber-400">Макс. 125 днів за запуск (≈4 міс.).</p>
          )}
        </div>
        <div>
          <label className="block text-xs text-[var(--text-muted)]">З дати</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="mt-0.5 rounded border border-[var(--border)] bg-[var(--bg-page)] px-2 py-1.5 text-sm text-[var(--text)]"
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--text-muted)]">По дату</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="mt-0.5 rounded border border-[var(--border)] bg-[var(--bg-page)] px-2 py-1.5 text-sm text-[var(--text)]"
          />
        </div>
        <button
          type="button"
          onClick={runBackfill}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
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
        <p className={`mt-2 text-sm ${message.ok ? "text-[var(--accent)]" : "text-red-400"}`}>
          {message.text}
        </p>
      )}

      <div className="mt-4 pt-4 border-t border-[var(--border)]">
        <p className="mb-2 text-xs text-[var(--text-muted)]">
          Після backfill автоматично запускається синхронізація ретро з лідами — артисти зʼявляться в таблиці лідів нижче. Якщо потрібно пересинхронізувати без нового backfill:
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <BptoptrackerSyncButton onDone={() => router.refresh()} />
          <RefreshSegmentsButton onDone={() => router.refresh()} />
        </div>
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
        className="inline-flex items-center justify-center gap-2 rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
      >
        {loading && <ButtonSpinner className="text-[var(--text-muted)]" />}
        {loading ? "Перевірка… (до 10 с)" : "Перевірити один день"}
      </button>
      {result && (
        <pre className="mt-1 max-h-40 overflow-auto rounded border border-[var(--border)] bg-[var(--bg-page)] p-2 text-xs text-[var(--text-muted)]">
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
        className="inline-flex items-center justify-center gap-2 rounded border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
      >
        {loading && <ButtonSpinner className="text-amber-400" />}
        {loading ? "Очищення… (кілька секунд)" : "Очистити сміттєві записи"}
      </button>
      {msg && (
        <p className={`mt-2 text-sm ${msg.ok ? "text-[var(--accent)]" : "text-red-400"}`}>{msg.text}</p>
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
        className="inline-flex items-center justify-center gap-2 rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
      >
        {loading && <ButtonSpinner />}
        {loading ? "Синхронізація… (оптимізовано)" : "Синхронізувати ретро з лідами"}
      </button>
      {msg && (
        <p className={`mt-2 text-sm ${msg.ok ? "text-[var(--accent)]" : "text-red-400"}`}>
          {msg.text}
        </p>
      )}
    </>
  );
}

function RefreshSegmentsButton({ onDone }: { onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const runRefresh = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/internal/score", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        playSuccessSound();
        setMsg({ ok: true, text: `Оновлено сегментів: ${data.updated}` });
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
        onClick={runRefresh}
        disabled={loading}
        className="inline-flex items-center justify-center gap-2 rounded border border-[var(--border)] bg-[var(--bg-hover)] px-3 py-1.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-table-header)] disabled:opacity-50"
      >
        {loading && <ButtonSpinner className="text-[var(--text-muted)]" />}
        {loading ? "Перерахунок…" : "Перерахувати сегменти"}
      </button>
      {msg && (
        <p className={`mt-2 text-sm ${msg.ok ? "text-[var(--accent)]" : "text-red-400"}`}>
          {msg.text}
        </p>
      )}
    </>
  );
}
