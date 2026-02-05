"use client";

import { useCallback, useState } from "react";

type Artist = {
  artist_beatport_id: string;
  artist_name: string | null;
  first_seen: string | null;
  last_seen: string | null;
  total_chart_entries: number | null;
  genres: string[] | null;
  segment: string | null;
  score: string | null;
  signals: Record<string, unknown> | null;
};

export function ArtistLeadCard({
  artist,
  beatportUrl,
}: {
  artist: Artist;
  beatportUrl: string;
}) {
  const [copied, setCopied] = useState(false);

  const displayName = artist.artist_name ?? artist.artist_beatport_id;
  const genres = artist.genres ?? [];
  const segment = artist.segment ?? null;

  const outreachNote = [
    `Hi,`,
    ``,
    `I came across your music on Beatport and wanted to reach out.`,
    ``,
    `Would you be open to a short chat about potential collaboration or licensing?`,
    ``,
    `Best,`,
  ].join("\n");

  const copyOutreach = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(outreachNote);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [outreachNote]);

  const exportContact = useCallback(() => {
    const line = [
      displayName,
      artist.artist_beatport_id,
      beatportUrl,
      segment ?? "",
      artist.score ?? "",
    ].join(",");
    const blob = new Blob([line + "\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lead-${artist.artist_beatport_id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [displayName, artist.artist_beatport_id, artist.score, beatportUrl, segment]);

  return (
    <article className="rounded-xl border border-stone-200 bg-white shadow-sm overflow-hidden">
      {/* Header: name, genres, segment badge, score */}
      <div className="border-b border-stone-100 bg-stone-50/50 px-4 py-4">
        <h1 className="text-xl font-semibold text-stone-900">{displayName}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {genres.length > 0 && (
            <span className="text-xs text-stone-500">
              {genres.slice(0, 5).join(", ")}
              {genres.length > 5 ? ` +${genres.length - 5}` : ""}
            </span>
          )}
          {segment && (
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                segment === "NEW_ENTRY"
                  ? "bg-blue-100 text-blue-800"
                  : segment === "FAST_GROWING"
                    ? "bg-emerald-100 text-emerald-800"
                    : segment === "TOP_PERFORMER"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-stone-200 text-stone-700"
              }`}
            >
              {segment}
            </span>
          )}
          {artist.score != null && (
            <span className="text-sm font-medium text-stone-700">Score: {artist.score}</span>
          )}
        </div>
      </div>

      {/* Discovery: source, first seen, charts count */}
      <section className="px-4 py-3 border-b border-stone-100">
        <h2 className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-2">
          Discovery
        </h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <div>
            <dt className="text-stone-500">Source</dt>
            <dd>Beatport</dd>
          </div>
          <div>
            <dt className="text-stone-500">First seen</dt>
            <dd>{artist.first_seen ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Charts count</dt>
            <dd>{artist.total_chart_entries ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Last seen</dt>
            <dd>{artist.last_seen ?? "—"}</dd>
          </div>
        </dl>
      </section>

      {/* Links */}
      <section className="px-4 py-3 border-b border-stone-100">
        <h2 className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-2">
          Links
        </h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          <li>
            <a
              href={beatportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-stone-700 underline hover:text-stone-900"
            >
              Beatport
            </a>
          </li>
        </ul>
        <p className="mt-1 text-xs text-stone-400">SoundCloud, Spotify, Instagram (enrichment v1)</p>
      </section>

      {/* Contacts — placeholder until enrichment */}
      <section className="px-4 py-3 border-b border-stone-100">
        <h2 className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-2">
          Contacts
        </h2>
        <p className="text-sm text-stone-500">— Email, booking (after enrichment)</p>
      </section>

      {/* Actions */}
      <section className="px-4 py-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copyOutreach}
          className="rounded bg-stone-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700"
        >
          {copied ? "Copied" : "Copy outreach note"}
        </button>
        <button
          type="button"
          onClick={exportContact}
          className="rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
        >
          Export contact
        </button>
        <span className="text-xs text-stone-400 self-center">Mark as contacted (coming soon)</span>
      </section>

      {artist.signals && Object.keys(artist.signals).length > 0 && (
        <section className="px-4 py-3 border-t border-stone-100 bg-stone-50/30">
          <h2 className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-2">
            Signals
          </h2>
          <pre className="overflow-auto rounded bg-stone-100 p-3 text-xs">
            {JSON.stringify(artist.signals, null, 2)}
          </pre>
        </section>
      )}
    </article>
  );
}
