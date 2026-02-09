"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { ButtonSpinner } from "@/app/components/ButtonSpinner";
import { playSuccessSound } from "@/lib/successSound";

type ChartMeta = {
  genre: string | null;
  chartType: string;
  sourceUrl: string;
};

type ScanItem = {
  artist_beatport_id: string;
  artist_name: string;
  artist_url: string;
  track_name: string;
  track_url: string | null;
  rank: number;
};

type Counts = { charts: number; tracks: number; artists: number };

type ScanResult = {
  ok: true;
  source: string;
  chartMeta: ChartMeta;
  items: ScanItem[];
  counts: Counts;
};

const PREVIEW_TOP = 20;

export function OracleModal({
  open,
  onClose,
  onSaveSegment,
}: {
  open: boolean;
  onClose: () => void;
  onSaveSegment?: () => void;
}) {
  const [url, setUrl] = useState("");
  const [segmentName, setSegmentName] = useState("");
  const [notes, setNotes] = useState("");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [savedSegmentId, setSavedSegmentId] = useState<string | null>(null);

  const handleScan = useCallback(async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setSavedSegmentId(null);
    try {
      const res = await fetch("/api/internal/oracle/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          segmentName: segmentName.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok && data.items) {
        playSuccessSound();
        setResult({
          ok: true,
          source: data.source,
          chartMeta: data.chartMeta,
          items: data.items,
          counts: data.counts,
        });
      } else {
        setError(data.error ?? "Сканування не вдалося.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Помилка запиту.");
    } finally {
      setLoading(false);
    }
  }, [url, segmentName, notes]);

  const handleSaveSegment = useCallback(async () => {
    if (!result || !result.items.length) return;
    const name = segmentName.trim() || result.chartMeta.genre || "Сегмент Oracle";
    setSaveLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/internal/oracle/segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segmentName: name,
          notes: notes.trim() || undefined,
          source_url: result.chartMeta.sourceUrl,
          items: result.items,
        }),
      });
      const data = await res.json();
      if (data.ok && data.segmentId) {
        playSuccessSound();
        setSavedSegmentId(data.segmentId);
        onSaveSegment?.();
      } else {
        setError(data.error ?? "Збереження не вдалося.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Помилка запиту.");
    } finally {
      setSaveLoading(false);
    }
  }, [result, segmentName, notes, onSaveSegment]);

  const handleCancel = useCallback(() => {
    setResult(null);
    setUrl("");
    setError(null);
    setSavedSegmentId(null);
    onClose();
  }, [onClose]);

  if (!open) return null;

  const previewItems = result?.items?.slice(0, PREVIEW_TOP) ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => e.target === e.currentTarget && handleCancel()}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-lg font-semibold text-[var(--text)]">Режим Oracle</h2>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">
            Вставте URL чарту або джерела, щоб відсканувати та переглянути артистів/треки.
          </p>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1">
              URL чарту або джерела
            </label>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Beatport, bptoptracker.com/top/track/…, beatstats.com/artists/…"
                  className="flex-1 rounded border border-[var(--border)] bg-[var(--bg-hover)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={handleScan}
                  disabled={loading || !url.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                >
                  {loading && <ButtonSpinner />}
                  {loading ? "Сканування… (до 30 с)" : "Сканувати"}
                </button>
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Beatport · BP Top Tracker (ретро по днях) · Beatstats (тренди за період)
              </p>
            </div>
          </div>

          {/* Optional: Segment Name, Notes (collapsed by default) */}
          <div>
            <button
              type="button"
              onClick={() => setOptionsOpen((o) => !o)}
              className="text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              {optionsOpen ? "−" : "+"} Опційно: назва сегменту, нотатки
            </button>
            {optionsOpen && (
              <div className="mt-2 space-y-2">
                <input
                  type="text"
                  value={segmentName}
                  onChange={(e) => setSegmentName(e.target.value)}
                  placeholder="Назва сегменту"
                  className="w-full rounded border border-[var(--border)] bg-[var(--bg-hover)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
                />
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Нотатки"
                  rows={2}
                  className="w-full rounded border border-[var(--border)] bg-[var(--bg-hover)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
                />
              </div>
            )}
          </div>

          {error && (
            <p className="rounded bg-[var(--danger)]/20 px-3 py-2 text-sm text-red-400">{error}</p>
          )}

          {/* After save: toast + CTAs */}
          {savedSegmentId && (
            <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/10 p-4 space-y-3">
              <p className="font-medium text-[var(--accent)]">Сегмент створено</p>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/segments/${savedSegmentId}`}
                  className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
                >
                  Відкрити сегмент
                </Link>
                <Link
                  href={`/segments/${savedSegmentId}#enrich`}
                  className="rounded border border-[var(--border)] bg-[var(--bg-hover)] px-3 py-1.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-table-header)]"
                >
                  Запустити Enrichment
                </Link>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded border border-[var(--border)] bg-[var(--bg-hover)] px-3 py-1.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-table-header)]"
                >
                  Закрити
                </button>
              </div>
            </div>
          )}

          {/* Preview: source, chartMeta, counts, table (top 20), Save / Cancel */}
          {result && !savedSegmentId && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-header)] p-4 space-y-4">
              <div className="flex flex-wrap gap-4 text-sm text-[var(--text-muted)]">
                <span><strong className="text-[var(--text)]">Джерело:</strong> {result.source}</span>
                {result.chartMeta.genre && (
                  <span><strong className="text-[var(--text)]">Жанр:</strong> {result.chartMeta.genre}</span>
                )}
                <span><strong className="text-[var(--text)]">Тип чарту:</strong> {result.chartMeta.chartType}</span>
                <span><strong className="text-[var(--text)]">Чартів:</strong> {result.counts.charts} · <strong className="text-[var(--text)]">Треків:</strong> {result.counts.tracks} · <strong className="text-[var(--text)]">Артистів:</strong> {result.counts.artists}</span>
              </div>

              <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--bg-card)]">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--bg-table-header)]">
                      <th className="px-3 py-2 font-medium text-[var(--text)]">Позиція</th>
                      <th className="px-3 py-2 font-medium text-[var(--text)]">Артист</th>
                      <th className="px-3 py-2 font-medium text-[var(--text)]">Трек</th>
                      <th className="px-3 py-2 font-medium text-[var(--text)]">URL артиста</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewItems.map((row, i) => (
                      <tr key={i} className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)]">
                        <td className="px-3 py-2 text-[var(--text)]">{row.rank}</td>
                        <td className="px-3 py-2 text-[var(--text)]">{row.artist_name}</td>
                        <td className="px-3 py-2 text-[var(--text)]">{row.track_name || "—"}</td>
                        <td className="px-3 py-2">
                          {row.artist_url ? (
                            <a href={row.artist_url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline truncate block max-w-[180px]">
                              {row.artist_url.replace(/^https?:\/\//, "")}
                            </a>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.items.length > PREVIEW_TOP && (
                  <p className="px-3 py-2 text-xs text-[var(--text-muted)]">
                    Показано перші {PREVIEW_TOP} з {result.items.length} записів.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSaveSegment}
                  disabled={saveLoading}
                  className="inline-flex items-center justify-center gap-2 rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                >
                  {saveLoading && <ButtonSpinner />}
                  {saveLoading ? "Збереження… (до 10 с)" : "Зберегти сегмент"}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded border border-[var(--border)] bg-[var(--bg-hover)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-table-header)]"
                >
                  Скасувати
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}