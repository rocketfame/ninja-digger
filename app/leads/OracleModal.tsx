"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

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
        setResult({
          ok: true,
          source: data.source,
          chartMeta: data.chartMeta,
          items: data.items,
          counts: data.counts,
        });
      } else {
        setError(data.error ?? "Scan failed.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }, [url, segmentName, notes]);

  const handleSaveSegment = useCallback(async () => {
    if (!result || !result.items.length) return;
    const name = segmentName.trim() || result.chartMeta.genre || "Oracle segment";
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
        setSavedSegmentId(data.segmentId);
        onSaveSegment?.();
      } else {
        setError(data.error ?? "Save failed.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50 p-4"
      onClick={(e) => e.target === e.currentTarget && handleCancel()}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-stone-200 px-4 py-3">
          <h2 className="text-lg font-semibold text-stone-900">Oracle Mode</h2>
          <p className="mt-0.5 text-sm text-stone-500">
            Paste a chart or source URL to scan and preview artists/tracks.
          </p>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Paste chart / source URL
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Beatport, bptoptracker.com/top/track/…, beatstats.com/artists/…"
                className="flex-1 rounded border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
                disabled={loading}
              />
              <p className="mt-1 text-xs text-stone-500">
                Beatport · BP Top Tracker (ретро по днях) · Beatstats (тренди за період)
              </p>
              <button
                type="button"
                onClick={handleScan}
                disabled={loading || !url.trim()}
                className="rounded bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
              >
                {loading ? "Scanning…" : "Scan & Preview"}
              </button>
            </div>
          </div>

          {/* Optional: Segment Name, Notes (collapsed by default) */}
          <div>
            <button
              type="button"
              onClick={() => setOptionsOpen((o) => !o)}
              className="text-sm font-medium text-stone-600 hover:text-stone-900"
            >
              {optionsOpen ? "−" : "+"} Optional: Segment name, Notes
            </button>
            {optionsOpen && (
              <div className="mt-2 space-y-2">
                <input
                  type="text"
                  value={segmentName}
                  onChange={(e) => setSegmentName(e.target.value)}
                  placeholder="Segment name"
                  className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
                />
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes"
                  rows={2}
                  className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
                />
              </div>
            )}
          </div>

          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
          )}

          {/* After save: toast + CTAs */}
          {savedSegmentId && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-3">
              <p className="font-medium text-emerald-800">Segment created</p>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/segments/${savedSegmentId}`}
                  className="rounded bg-stone-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700"
                >
                  Open Segment
                </Link>
                <Link
                  href={`/segments/${savedSegmentId}#enrich`}
                  className="rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
                >
                  Run Enrichment
                </Link>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {/* Preview: source, chartMeta, counts, table (top 20), Save / Cancel */}
          {result && !savedSegmentId && (
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 space-y-4">
              <div className="flex flex-wrap gap-4 text-sm">
                <span><strong>Source:</strong> {result.source}</span>
                {result.chartMeta.genre && (
                  <span><strong>Genre:</strong> {result.chartMeta.genre}</span>
                )}
                <span><strong>Chart type:</strong> {result.chartMeta.chartType}</span>
                <span><strong>Charts:</strong> {result.counts.charts} · <strong>Tracks:</strong> {result.counts.tracks} · <strong>Artists:</strong> {result.counts.artists}</span>
              </div>

              <div className="overflow-x-auto rounded border border-stone-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 bg-stone-100">
                      <th className="px-3 py-2 font-medium">Rank</th>
                      <th className="px-3 py-2 font-medium">Artist</th>
                      <th className="px-3 py-2 font-medium">Track</th>
                      <th className="px-3 py-2 font-medium">Artist URL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewItems.map((row, i) => (
                      <tr key={i} className="border-b border-stone-100">
                        <td className="px-3 py-2">{row.rank}</td>
                        <td className="px-3 py-2">{row.artist_name}</td>
                        <td className="px-3 py-2">{row.track_name || "—"}</td>
                        <td className="px-3 py-2">
                          {row.artist_url ? (
                            <a href={row.artist_url} target="_blank" rel="noopener noreferrer" className="text-stone-600 underline truncate block max-w-[180px]">
                              {row.artist_url.replace(/^https?:\/\//, "")}
                            </a>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.items.length > PREVIEW_TOP && (
                  <p className="px-3 py-2 text-xs text-stone-500">
                    Showing top {PREVIEW_TOP} of {result.items.length} items.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSaveSegment}
                  disabled={saveLoading}
                  className="rounded bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
                >
                  {saveLoading ? "Saving…" : "Save Segment"}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}