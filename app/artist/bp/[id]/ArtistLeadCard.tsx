"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonSpinner } from "@/app/components/ButtonSpinner";
import { formatDateDDMMYYYY } from "@/lib/formatDate";
import { playSuccessSound } from "@/lib/successSound";
import { LinkIcon } from "./LinkIcon";

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
  if (segment === "NEWCOMER") return "Новачок: вперше потрапив у топ-чарт, раніше не був.";
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
type ContactRow = { type: string; value: string; source_url?: string | null; confidence?: number };

function contactSourceLabel(sourceUrl: string | null | undefined): string {
  if (!sourceUrl) return "";
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, "");
    if (host.includes("linktr.ee")) return "Linktree";
    if (host.includes("beacons.ai")) return "Beacons";
    if (host.includes("carrd.co")) return "Carrd";
    if (host.includes("residentadvisor.net")) return "Resident Advisor";
    if (host.includes("soundcloud.com")) return "SoundCloud";
    if (host.includes("bandcamp.com")) return "Bandcamp";
    if (host.includes("mixcloud.com")) return "Mixcloud";
    if (host.includes("reverbnation.com")) return "Reverb Nation";
    if (host.includes("instagram.com")) return "Instagram";
    return host;
  } catch {
    return "";
  }
}

function linkTypeLabel(type: string): string {
  switch (type) {
    case "instagram": return "Instagram";
    case "soundcloud": return "SoundCloud";
    case "linktree": return "Linktree";
    case "resident_advisor": return "Resident Advisor";
    case "bandcamp": return "Bandcamp";
    case "mixcloud": return "Mixcloud";
    case "reverbnation": return "Reverb Nation";
    case "website": return "Сайт";
    default: return type;
  }
}

export type GenreStat = {
  genre_slug: string;
  entries: number;
  best_position: number;
  avg_position: string;
  first_seen: string;
  last_seen: string;
  momentum_7d: string | null;
};

export function ArtistLeadCard({
  artist,
  beatportUrl = null,
  bptoptrackerUrl = null,
  imageUrl = null,
  initialProfile,
  links = [],
  contacts = [],
  genreStats = [],
}: {
  artist: Artist;
  beatportUrl?: string | null;
  bptoptrackerUrl?: string | null;
  imageUrl?: string | null;
  initialProfile?: Profile | null;
  links?: LinkRow[];
  contacts?: ContactRow[];
  genreStats?: GenreStat[];
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
  const primaryUrl = bptoptrackerUrl ?? beatportUrl ?? null;
  const hasExternalLinks = !!(beatportUrl || bptoptrackerUrl);

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
      beatportUrl ?? "",
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
    <article className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
      {/* Header: image (from Beatport), name, genres, segment badge, score */}
      <div className="border-b border-[var(--border)] bg-[var(--bg-header)] px-4 py-4">
        <div className="flex items-start gap-4">
          {imageUrl && (
            hasExternalLinks && primaryUrl ? (
              <a
                href={primaryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--bg-hover)] w-24 h-24"
              >
                <img
                  src={imageUrl}
                  alt=""
                  className="w-full h-full object-cover"
                  width={96}
                  height={96}
                />
              </a>
            ) : (
              <div className="shrink-0 rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--bg-hover)] w-24 h-24">
                <img
                  src={imageUrl}
                  alt=""
                  className="w-full h-full object-cover"
                  width={96}
                  height={96}
                />
              </div>
            )
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-[var(--text)]">
              {hasExternalLinks && primaryUrl ? (
                <a
                  href={primaryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--accent)] hover:underline focus:underline"
                >
                  {displayName}
                </a>
              ) : (
                <span>{displayName}</span>
              )}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {genres.length > 0 && (
                <span className="text-xs text-[var(--text-muted)]">
                  {genres.slice(0, 5).join(", ")}
                  {genres.length > 5 ? ` +${genres.length - 5}` : ""}
                </span>
              )}
              {segment && (
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                    segment === "NEWCOMER"
                      ? "bg-violet-500/20 text-violet-300"
                      : segment === "NEW_ENTRY"
                        ? "bg-blue-500/20 text-blue-300"
                        : segment === "FAST_GROWING"
                          ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                          : segment === "TOP_PERFORMER"
                            ? "bg-amber-500/20 text-amber-400"
                            : segment === "DECLINING"
                              ? "bg-[var(--danger)]/20 text-red-400"
                              : "bg-[var(--bg-hover)] text-[var(--text-muted)]"
                  }`}
                >
                  {({ NEWCOMER: "Новачки", NEW_ENTRY: "Новий вхід", FAST_GROWING: "Швидке зростання", TOP_PERFORMER: "Топ-перформер", DECLINING: "Спад", CONSISTENT: "Стабільний" } as Record<string, string>)[segment] ?? segment}
                </span>
              )}
              {artist.score != null && (
                <span className="text-sm font-medium text-[var(--text)]">Бал: {artist.score}</span>
              )}
            </div>
            <p className="mt-2 text-sm text-[var(--text-muted)]">Чому цей лід? {teaser}</p>
          </div>
        </div>
      </div>

      {/* Discovery: first seen, charts count */}
      <section className="px-4 py-3 border-b border-[var(--border)]">
        <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)] mb-2">
          Джерело
        </h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <div>
            <dt className="text-[var(--text-muted)]">Вперше в чартах</dt>
            <dd className="text-[var(--text)]">{formatDateDDMMYYYY(artist.first_seen)}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Появ у чартах</dt>
            <dd className="text-[var(--text)]">{artist.total_chart_entries ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Остання поява</dt>
            <dd className="text-[var(--text)]">{formatDateDDMMYYYY(artist.last_seen)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Появ у чартах — це кількість записів у чартах (кожна поява треку в чарті на певну дату = один запис). Це не кількість треків: один трек може дати багато записів, якщо він був у чарті багато днів.
        </p>
      </section>

      {/* Статистика по жанрах — завжди виводимо блок: таблиця або повідомлення */}
      <section className="px-4 py-3 border-b border-[var(--border)]">
        <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)] mb-2">
          Статистика по жанрах
        </h2>
        <p className="mb-2 text-xs text-[var(--text-muted)]">
          В яких жанрах зʼявляється в топах, найкраща позиція, середня позиція, тренд за 7 днів (↓ краще позиція). Колонка «Появ» — кількість записів у чарті по цьому жанру (не кількість треків).
        </p>
        {genreStats.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="py-1.5 pr-2 font-medium text-[var(--text)]">Жанр</th>
                  <th className="py-1.5 pr-2 font-medium text-[var(--text)]">Появ</th>
                  <th className="py-1.5 pr-2 font-medium text-[var(--text)]">Найкраща поз.</th>
                  <th className="py-1.5 pr-2 font-medium text-[var(--text)]">Сер. поз.</th>
                  <th className="py-1.5 pr-2 font-medium text-[var(--text)]">Тренд 7д</th>
                </tr>
              </thead>
              <tbody>
                {genreStats.map((g) => {
                  const momentum = g.momentum_7d != null ? parseFloat(g.momentum_7d) : null;
                  const trendUp = momentum != null && momentum > 0;
                  const trendDown = momentum != null && momentum < 0;
                  return (
                    <tr key={g.genre_slug} className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)]">
                      <td className="py-1.5 pr-2 font-medium text-[var(--text)]">{g.genre_slug}</td>
                      <td className="py-1.5 pr-2 text-[var(--text)]">{g.entries}</td>
                      <td className="py-1.5 pr-2 text-[var(--text)]">#{g.best_position}</td>
                      <td className="py-1.5 pr-2 text-[var(--text-muted)]">{g.avg_position}</td>
                      <td className="py-1.5 pr-2">
                        {momentum != null ? (
                          <span className={trendUp ? "text-[var(--accent)]" : trendDown ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}>
                            {trendUp ? "↑" : trendDown ? "↓" : "—"} {Math.abs(momentum).toFixed(1)}
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">Немає даних по жанрах у топах для цього артиста.</p>
        )}
      </section>

      {/* Посилання та контакти — кнопки з іконками */}
      <section className="px-4 py-3 border-b border-[var(--border)]">
        <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)] mb-3">
          Посилання та контакти
        </h2>
        <div className="flex flex-wrap gap-2">
          {beatportUrl && (
            <a
              href={beatportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm font-medium text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-hover)]"
            >
              <LinkIcon type="beatport" />
              Beatport
            </a>
          )}
          {bptoptrackerUrl && (
            <a
              href={bptoptrackerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm font-medium text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-hover)]"
            >
              <LinkIcon type="bptoptracker" />
              BP Top Tracker
            </a>
          )}
          {links.map((l) => (
            <a
              key={l.type}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm font-medium text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-hover)]"
            >
              <LinkIcon type={l.type} />
              {linkTypeLabel(l.type)}
            </a>
          ))}
          {contacts.filter((c) => c.type === "email").map((c, i) => {
            const sourceLabel = contactSourceLabel(c.source_url);
            const label = sourceLabel ? `Email · via ${sourceLabel}` : "Email";
            const title = sourceLabel ? `via ${sourceLabel}${c.confidence != null ? ` (${Math.round(c.confidence * 100)}%)` : ""}` : undefined;
            return (
              <a
                key={i}
                href={`mailto:${c.value}`}
                title={title}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm font-medium text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-hover)]"
              >
                <LinkIcon type="email" />
                {label}
              </a>
            );
          })}
        </div>
        {!beatportUrl && !bptoptrackerUrl && (
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Посилання на Beatport і BP Top Tracker зʼявляться після sync/backfill з BPTT або переходу з посилання в чарті.
          </p>
        )}
        {links.length === 0 && contacts.length === 0 && (
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Запустіть Enrichment, щоб знайти Instagram, SoundCloud, Linktree, Resident Advisor, Bandcamp, Mixcloud, email та ін.
          </p>
        )}
      </section>

      {/* Нотатки та статус */}
      <section className="px-4 py-3 border-b border-[var(--border)]">
        <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)] mb-2">
          Notes &amp; Status
        </h2>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-[var(--text-muted)]">Статус</label>
            <select
              value={status}
              onChange={(e) => {
                const v = e.target.value;
                setStatus(v);
                saveProfile({ status: v });
              }}
              disabled={profileSaving}
              className="rounded border border-[var(--border)] bg-[var(--bg-hover)] px-2 py-1.5 text-sm text-[var(--text)]"
            >
              {PROFILE_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-[var(--text-muted)] mb-1">Нотатки</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotes}
              placeholder="Нотатки…"
              rows={3}
              className="w-full rounded border border-[var(--border)] bg-[var(--bg-hover)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
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
          className="inline-flex items-center justify-center gap-2 rounded border border-[var(--border)] bg-[var(--bg-hover)] px-3 py-1.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-table-header)] disabled:opacity-50"
        >
          {enrichLoading && <ButtonSpinner />}
          {enrichLoading ? "Виконується… (до 2 хв)" : "Запустити Enrichment"}
        </button>
        <button
          type="button"
          onClick={copyOutreach}
          className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
        >
          {copied ? "Скопійовано" : "Копіювати outreach"}
        </button>
        <button
          type="button"
          onClick={exportContact}
          className="rounded border border-[var(--border)] bg-[var(--bg-hover)] px-3 py-1.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-table-header)]"
        >
          Експорт
        </button>
        <button
          type="button"
          onClick={markContacted}
          className="rounded border border-[var(--border)] bg-[var(--bg-hover)] px-3 py-1.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-table-header)]"
        >
          Позначити як на контакті
        </button>
      </section>

      {artist.signals && Object.keys(artist.signals).length > 0 && (
        <section className="px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-header)]">
          <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)] mb-2">
            Сигнали
          </h2>
          <pre className="overflow-auto rounded bg-[var(--bg-hover)] p-3 text-xs text-[var(--text-muted)]">
            {JSON.stringify(artist.signals, null, 2)}
          </pre>
        </section>
      )}
    </article>
  );
}
