"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonSpinner } from "@/app/components/ButtonSpinner";
import { playSuccessSound } from "@/lib/successSound";

const PROFILE_STATUSES: { value: string; label: string }[] = [
  { value: "New", label: "Новий" },
  { value: "Contacted", label: "На контакті" },
  { value: "In Progress", label: "В роботі" },
  { value: "Won", label: "Виграно" },
  { value: "Lost", label: "Програно" },
];

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

type Profile = { status: string; notes: string | null };

function whyThisLeadTeaser(segment: string | null, signals: Record<string, unknown> | null): string {
  if (segment === "NEW_ENTRY") return "Вперше в чартах за останні 14 днів.";
  if (segment === "FAST_GROWING") return "Зростання позицій за останні 7 днів.";
  if (segment === "CONSISTENT") return "30+ днів у чартах — стабільна присутність.";
  if (segment === "DECLINING") return "Нещодавнє падіння позицій у чартах.";
  if (segment === "TOP_PERFORMER") return "Топові позиції в чартах.";
  if (signals && typeof signals.best_position === "number" && signals.best_position <= 10) {
    return `Найкраща позиція: #${signals.best_position}.`;
  }
  return "Виявлено активність у чартах.";
}

type LinkRow = { type: string; url: string };
type ContactRow = { type: string; value: string };

export function ArtistLeadCard({
  artist,
  beatportUrl,
  imageUrl = null,
  initialProfile,
  links = [],
  contacts = [],
  linkLabel = "Beatport",
}: {
  artist: Artist;
  beatportUrl: string;
  imageUrl?: string | null;
  initialProfile?: Profile | null;
  links?: LinkRow[];
  contacts?: ContactRow[];
  /** When link is to BP Top Tracker (synthetic id), pass "BP Top Tracker" */
  linkLabel?: string;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState(initialProfile?.status ?? "New");
  const [notes, setNotes] = useState(initialProfile?.notes ?? "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [enrichLoading, setEnrichLoading] = useState(false);

  useEffect(() => {
    setStatus(initialProfile?.status ?? "New");
    setNotes(initialProfile?.notes ?? "");
  }, [initialProfile?.status, initialProfile?.notes]);

  const displayName = artist.artist_name ?? artist.artist_beatport_id;
  const genres = artist.genres ?? [];
  const segment = artist.segment ?? null;

  const teaser = whyThisLeadTeaser(artist.segment ?? null, artist.signals ?? null);
  const outreachNote = [
    `Hi,`,
    ``,
    `I came across your music on Beatport${artist.segment ? ` (${artist.segment})` : ""} and wanted to reach out.`,
    ``,
    `Would you be open to a short chat about potential collaboration or licensing?`,
    ``,
    `Best,`,
  ].join("\n");

  const saveProfile = useCallback(async (updates: { status?: string; notes?: string }) => {
    setProfileSaving(true);
    try {
      const res = await fetch(`/api/internal/lead-profile/${artist.artist_beatport_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) router.refresh();
    } finally {
      setProfileSaving(false);
    }
  }, [artist.artist_beatport_id, router]);

  const saveNotes = useCallback(() => {
    saveProfile({ notes });
  }, [notes, saveProfile]);

  const markContacted = useCallback(() => {
    setStatus("Contacted");
    saveProfile({ status: "Contacted" });
  }, [saveProfile]);

  const runEnrichment = useCallback(async () => {
    setEnrichLoading(true);
    try {
      const res = await fetch(`/api/internal/enrich/artist?artistId=${encodeURIComponent(artist.artist_beatport_id)}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok ?? res.ok) {
        playSuccessSound();
        router.refresh();
      }
    } finally {
      setEnrichLoading(false);
    }
  }, [artist.artist_beatport_id, router]);

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
      {/* Header: image (from Beatport), name, genres, segment badge, score */}
      <div className="border-b border-stone-100 bg-stone-50/50 px-4 py-4">
        <div className="flex items-start gap-4">
          {imageUrl && (
            <a
              href={beatportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded-lg overflow-hidden border border-stone-200 bg-stone-100 w-24 h-24"
            >
              <img
                src={imageUrl}
                alt=""
                className="w-full h-full object-cover"
                width={96}
                height={96}
              />
            </a>
          )}
          <div className="min-w-0 flex-1">
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
                <span className="text-sm font-medium text-stone-700">Бал: {artist.score}</span>
              )}
            </div>
            <p className="mt-2 text-sm text-stone-500">Чому цей лід? {teaser}</p>
          </div>
        </div>
      </div>

      {/* Discovery: source, first seen, charts count */}
      <section className="px-4 py-3 border-b border-stone-100">
        <h2 className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-2">
          Джерело
        </h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <div>
            <dt className="text-stone-500">Платформа</dt>
            <dd>{linkLabel}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Вперше в чартах</dt>
            <dd>{artist.first_seen ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Входжень у чарти</dt>
            <dd>{artist.total_chart_entries ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Остання поява</dt>
            <dd>{artist.last_seen ?? "—"}</dd>
          </div>
        </dl>
      </section>

      {/* Links */}
      <section className="px-4 py-3 border-b border-stone-100">
        <h2 className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-2">
          Посилання
        </h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          <li>
            <a
              href={beatportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-stone-700 underline hover:text-stone-900"
            >
              {linkLabel}
            </a>
          </li>
          {links.map((l) => (
            <li key={l.type}>
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-stone-700 underline hover:text-stone-900"
              >
                {l.type === "instagram" ? "Instagram" : l.type === "soundcloud" ? "SoundCloud" : l.type === "linktree" ? "Linktree" : l.type}
              </a>
            </li>
          ))}
        </ul>
        {links.length === 0 && (
          <p className="mt-1 text-xs text-stone-400">Запустіть Enrichment, щоб знайти Instagram, SoundCloud, Linktree.</p>
        )}
      </section>

      {/* Contacts */}
      <section className="px-4 py-3 border-b border-stone-100">
        <h2 className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-2">
          Контакти
        </h2>
        {contacts.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {contacts.map((c, i) => (
              <li key={i}>
                {c.type === "email" ? (
                  <a href={`mailto:${c.value}`} className="text-stone-700 underline hover:text-stone-900">{c.value}</a>
                ) : (
                  <span>{c.value}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">— Запустіть Enrichment, щоб знайти публічні email з Linktree/біо.</p>
        )}
      </section>

      {/* Нотатки та статус */}
      <section className="px-4 py-3 border-b border-stone-100">
        <h2 className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-2">
          Notes &amp; Status
        </h2>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-stone-600">Статус</label>
            <select
              value={status}
              onChange={(e) => {
                const v = e.target.value;
                setStatus(v);
                saveProfile({ status: v });
              }}
              disabled={profileSaving}
              className="rounded border border-stone-300 px-2 py-1.5 text-sm"
            >
              {PROFILE_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-stone-600 mb-1">Нотатки</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotes}
              placeholder="Нотатки…"
              rows={3}
              className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
      </section>

      {/* Actions */}
      <section className="px-4 py-3 flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={runEnrichment}
          disabled={enrichLoading}
          className="inline-flex items-center justify-center gap-2 rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
        >
          {enrichLoading && <ButtonSpinner />}
          {enrichLoading ? "Виконується… (до 2 хв)" : "Запустити Enrichment"}
        </button>
        <button
          type="button"
          onClick={copyOutreach}
          className="rounded bg-stone-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700"
        >
          {copied ? "Скопійовано" : "Копіювати outreach"}
        </button>
        <button
          type="button"
          onClick={exportContact}
          className="rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
        >
          Експорт
        </button>
        <button
          type="button"
          onClick={markContacted}
          className="rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
        >
          Позначити як на контакті
        </button>
      </section>

      {artist.signals && Object.keys(artist.signals).length > 0 && (
        <section className="px-4 py-3 border-t border-stone-100 bg-stone-50/30">
          <h2 className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-2">
            Сигнали
          </h2>
          <pre className="overflow-auto rounded bg-stone-100 p-3 text-xs">
            {JSON.stringify(artist.signals, null, 2)}
          </pre>
        </section>
      )}
    </article>
  );
}
