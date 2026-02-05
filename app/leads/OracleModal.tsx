"use client";

import { useCallback, useState } from "react";

type OracleArtistPreview = {
  artist_beatport_id: string;
  artist_name: string;
  artist_slug: string;
};

type ScanResult = {
  ok: true;
  source: string;
  type: string;
  artists: OracleArtistPreview[];
  chartCount: number;
  genre: string | null;
  sourceUrl: string;
};

export function OracleModal({
  open,
  onClose,
  onAddToLeads,
  onSaveSegment,
}: {
  open: boolean;
  onClose: () => void;
  onAddToLeads?: () => void;
  onSaveSegment?: () => void;
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [addToLeadsLoading, setAddToLeadsLoading] = useState(false);
  const [saveSegmentName, setSaveSegmentName] = useState("");
  const [saveSegmentLoading, setSaveSegmentLoading] = useState(false);

  const handleScan = useCallback(async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/internal/oracle/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (data.ok && data.artists) {
        setResult(data);
      } else {
        setError(data.error ?? "Scan failed.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }, [url]);

  const handleAddToLeads = useCallback(async () => {
    if (!result?.sourceUrl) return;
    setAddToLeadsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/internal/oracle/add-to-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: result.sourceUrl }),
      });
      const data = await res.json();
      if (data.ok) {
        onAddToLeads?.();
        onClose();
      } else {
        setError(data.error ?? "Add to Leads failed.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setAddToLeadsLoading(false);
    }
  }, [result?.sourceUrl, onAddToLeads, onClose]);

  const handleSaveSegment = useCallback(async () => {
    if (!result?.artists?.length || !saveSegmentName.trim()) return;
    setSaveSegmentLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/internal/oracle/save-segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveSegmentName.trim(),
          source_url: result.sourceUrl ?? null,
          artist_beatport_ids: result.artists.map((a) => a.artist_beatport_id).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        onSaveSegment?.();
        onClose();
      } else {
        setError(data.error ?? "Save segment failed.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setSaveSegmentLoading(false);
    }
  }, [result?.artists, result?.sourceUrl, saveSegmentName, onSaveSegment, onClose]);

  const handleDiscard = useCallback(() => {
    setResult(null);
    setUrl("");
    setError(null);
    setSaveSegmentName("");
    onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50 p-4"
      onClick={(e) => e.target === e.currentTarget && handleDiscard()}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-stone-200 px-4 py-3">
          <h2 className="text-lg font-semibold text-stone-900">Oracle Mode</h2>
          <p className="mt-0.5 text-sm text-stone-500">
            Paste a chart or source URL to scan and extract artists.
          </p>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Chart / source URL
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.beatport.com/genre/techno/5/top-100"
                className="flex-1 rounded border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
                disabled={loading}
              />
              <button
                type="button"
                onClick={handleScan}
                disabled={loading || !url.trim()}
                className="rounded bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
              >
                {loading ? "Scanning…" : "Scan & Extract"}
              </button>
            </div>
            <p className="mt-1 text-xs text-stone-500">
              Supported: Beatport chart URL. Beatstats (coming soon).
            </p>
          </div>

          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
          )}

          {result && (
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 space-y-4">
              <div className="flex flex-wrap gap-3 text-sm text-stone-700">
                <span className="font-medium text-emerald-700">
                  ✓ {result.artists.length} artists found
                </span>
                <span>✓ {result.chartCount} chart</span>
                {result.genre && (
                  <span>✓ Genre: {result.genre}</span>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleAddToLeads}
                  disabled={addToLeadsLoading}
                  className="rounded bg-stone-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
                >
                  {addToLeadsLoading ? "Adding…" : "Add to Leads"}
                </button>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={saveSegmentName}
                    onChange={(e) => setSaveSegmentName(e.target.value)}
                    placeholder="Segment name"
                    className="w-40 rounded border border-stone-300 px-2 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleSaveSegment}
                    disabled={saveSegmentLoading || !saveSegmentName.trim()}
                    className="rounded bg-stone-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-500 disabled:opacity-50"
                  >
                    {saveSegmentLoading ? "Saving…" : "Save as segment"}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleDiscard}
                  className="rounded border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
                >
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
