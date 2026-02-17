"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonSpinner } from "@/app/components/ButtonSpinner";
import { useToast } from "@/app/components/Toast";
import { formatDateDDMMYYYY } from "@/lib/formatDate";
import { playSuccessSound } from "@/lib/successSound";
import { LinkIcon } from "./LinkIcon";

const PROFILE_STATUSES: { value: string; label: string; icon: string; color: string; bg: string }[] = [
  { value: "New",          label: "Новий",          icon: "○", color: "#a8a29e", bg: "rgba(168,162,158,0.12)" },
  { value: "Attempt 1",    label: "1-й контакт",    icon: "→", color: "#60a5fa", bg: "rgba(59,130,246,0.12)" },
  { value: "Attempt 2",    label: "2-й контакт",    icon: "→→", color: "#818cf8", bg: "rgba(129,140,248,0.12)" },
  { value: "Responded",    label: "Відповів",       icon: "←", color: "#4ade80", bg: "rgba(34,197,94,0.12)" },
  { value: "In Progress",  label: "В комунікації",  icon: "⇄", color: "#22c55e", bg: "rgba(34,197,94,0.18)" },
  { value: "Won",          label: "Виграно",        icon: "✓", color: "#10b981", bg: "rgba(16,185,129,0.15)" },
  { value: "No Response",  label: "Не відповів",    icon: "✕", color: "#f97316", bg: "rgba(249,115,22,0.12)" },
  { value: "Blacklist",    label: "Blacklist",       icon: "⛔", color: "#ef4444", bg: "rgba(239,68,68,0.15)" },
];

const SEGMENT_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  NEWCOMER:      { bg: "rgba(34,197,94,0.15)",  text: "#4ade80", label: "Новачки" },
  NEW_ENTRY:     { bg: "rgba(59,130,246,0.15)",  text: "#60a5fa", label: "Новий вхід" },
  CONSISTENT:    { bg: "rgba(168,162,158,0.15)", text: "#a8a29e", label: "Стабільний" },
  FAST_GROWING:  { bg: "rgba(168,85,247,0.15)",  text: "#c084fc", label: "Швидке зростання" },
  DECLINING:     { bg: "rgba(239,68,68,0.15)",   text: "#f87171", label: "Спад" },
  TOP_PERFORMER: { bg: "rgba(250,204,21,0.15)",  text: "#fbbf24", label: "Топ-перформер" },
};

const CHART_TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  top_tracks:    { label: "Top",      color: "#4ade80", bg: "rgba(34,197,94,0.12)" },
  hype_tracks:   { label: "Hype",     color: "#f59e0b", bg: "rgba(245,158,11,0.15)" },
  top_releases:  { label: "Releases", color: "#60a5fa", bg: "rgba(59,130,246,0.12)" },
};

const GENRE_COLORS = [
  { bg: "rgba(59,130,246,0.12)",  text: "#60a5fa" },
  { bg: "rgba(168,85,247,0.12)",  text: "#c084fc" },
  { bg: "rgba(236,72,153,0.12)",  text: "#f472b6" },
  { bg: "rgba(34,197,94,0.12)",   text: "#4ade80" },
  { bg: "rgba(250,204,21,0.12)",  text: "#fbbf24" },
  { bg: "rgba(249,115,22,0.12)",  text: "#fb923c" },
  { bg: "rgba(168,162,158,0.12)", text: "#a8a29e" },
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
type LinkRow = { type: string; url: string };
type ContactRow = { type: string; value: string; source_url?: string | null; confidence?: number };

function contactSourceLabel(sourceUrl: string | null | undefined): string {
  if (!sourceUrl) return "";
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, "");
    if (host.includes("linktr.ee")) return "Linktree";
    if (host.includes("residentadvisor.net")) return "RA";
    if (host.includes("soundcloud.com")) return "SoundCloud";
    if (host.includes("bandcamp.com")) return "Bandcamp";
    if (host.includes("instagram.com")) return "Instagram";
    return host;
  } catch {
    return "";
  }
}

function linkTypeLabel(type: string): string {
  const map: Record<string, string> = {
    instagram: "Instagram", soundcloud: "SoundCloud", linktree: "Linktree",
    resident_advisor: "Resident Advisor", bandcamp: "Bandcamp", mixcloud: "Mixcloud",
    facebook: "Facebook", twitter: "Twitter", website: "Сайт",
  };
  return map[type] ?? type;
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
  chartTypes = [],
}: {
  artist: Artist;
  beatportUrl?: string | null;
  bptoptrackerUrl?: string | null;
  imageUrl?: string | null;
  initialProfile?: Profile | null;
  links?: LinkRow[];
  contacts?: ContactRow[];
  genreStats?: GenreStat[];
  chartTypes?: string[];
}) {
  const router = useRouter();
  const { toast } = useToast();
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
  const segStyle = segment ? SEGMENT_STYLES[segment] : null;
  const primaryUrl = bptoptrackerUrl ?? beatportUrl ?? null;
  const hasExternalLinks = !!(beatportUrl || bptoptrackerUrl);

  const outreachNote = [
    `Hi,`, ``,
    `I came across your music on Beatport${artist.segment ? ` (${artist.segment})` : ""} and wanted to reach out.`, ``,
    `Would you be open to a short chat about potential collaboration or licensing?`, ``,
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
    const next = status === "New" ? "Attempt 1" : status === "Attempt 1" ? "Attempt 2" : status;
    setStatus(next);
    saveProfile({ status: next });
  }, [status, saveProfile]);

  const runEnrichment = useCallback(async () => {
    setEnrichLoading(true);
    try {
      const res = await fetch(`/api/internal/enrich/artist?artistId=${encodeURIComponent(artist.artist_beatport_id)}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok ?? res.ok) {
        playSuccessSound();
        toast("Enrichment завершено", "success");
        router.refresh();
      } else {
        toast(data?.error ?? `Помилка ${res.status}`, "error");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast(msg === "Failed to fetch" ? "Не вдалося виконати запит." : msg, "error");
    } finally {
      setEnrichLoading(false);
    }
  }, [artist.artist_beatport_id, router, toast]);

  const copyOutreach = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(outreachNote);
      setCopied(true);
      toast("Outreach скопійовано", "success");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [outreachNote, toast]);

  const exportContact = useCallback(() => {
    const line = [displayName, artist.artist_beatport_id, beatportUrl ?? "", segment ?? "", artist.score ?? ""].join(",");
    const blob = new Blob([line + "\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lead-${artist.artist_beatport_id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [displayName, artist.artist_beatport_id, artist.score, beatportUrl, segment]);

  const allLinks = [
    ...(beatportUrl ? [{ type: "beatport", url: beatportUrl }] : []),
    ...(bptoptrackerUrl ? [{ type: "bptoptracker", url: bptoptrackerUrl }] : []),
    ...links,
  ];
  const emails = contacts.filter((c) => c.type === "email");

  const signals = artist.signals;
  const signalItems: { label: string; value: string }[] = [];
  if (signals) {
    if (signals.best_position != null) signalItems.push({ label: "Найкраща позиція", value: `#${signals.best_position}` });
    if (signals.avg_position != null) signalItems.push({ label: "Середня позиція", value: `#${Number(signals.avg_position).toFixed(1)}` });
    if (signals.total_days_in_charts != null) signalItems.push({ label: "Днів у чартах", value: String(signals.total_days_in_charts) });
    if (signals.momentum_7d != null) signalItems.push({ label: "Тренд 7д", value: String(signals.momentum_7d) });
    if (signals.momentum_30d != null) signalItems.push({ label: "Тренд 30д", value: String(signals.momentum_30d) });
  }

  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
      {/* Header */}
      <div className="border-b border-[var(--border)] bg-[var(--bg-header)] px-5 py-5">
        <div className="flex items-start gap-4">
          {imageUrl && (
            <a
              href={primaryUrl ?? "#"}
              target={primaryUrl ? "_blank" : undefined}
              rel="noopener noreferrer"
              className="shrink-0 rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--bg-hover)] w-20 h-20"
            >
              <img src={imageUrl} alt="" className="w-full h-full object-cover" width={80} height={80} />
            </a>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-[var(--text)] truncate">
                {hasExternalLinks && primaryUrl ? (
                  <a href={primaryUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">
                    {displayName}
                  </a>
                ) : displayName}
              </h1>
              {artist.score != null && (
                <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--text-muted)]">{artist.score}</span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {segStyle && (
                <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ backgroundColor: segStyle.bg, color: segStyle.text }}>
                  {segStyle.label}
                </span>
              )}
              {chartTypes.map((ct) => {
                const style = CHART_TYPE_LABELS[ct];
                if (!style) return null;
                return (
                  <span
                    key={ct}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                    style={{ backgroundColor: style.bg, color: style.color }}
                  >
                    {ct === "hype_tracks" && <span className="text-[11px]">🔥</span>}
                    {style.label}
                  </span>
                );
              })}
              {genres.map((g, i) => (
                <span
                  key={g}
                  className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{ backgroundColor: GENRE_COLORS[i % GENRE_COLORS.length].bg, color: GENRE_COLORS[i % GENRE_COLORS.length].text }}
                >
                  {g}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* CRM Pipeline */}
      <div className="border-b border-[var(--border)] px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {PROFILE_STATUSES.map((s) => {
            const isActive = status === s.value;
            return (
              <button
                key={s.value}
                onClick={() => { setStatus(s.value); saveProfile({ status: s.value }); }}
                disabled={profileSaving}
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-all duration-150 border cursor-pointer"
                style={{
                  backgroundColor: isActive ? s.bg : "transparent",
                  color: isActive ? s.color : "var(--text-muted)",
                  borderColor: isActive ? s.color + "40" : "var(--border)",
                  opacity: profileSaving ? 0.5 : 1,
                  boxShadow: isActive ? `0 0 8px ${s.color}20` : "none",
                }}
              >
                <span className="text-[10px]">{s.icon}</span>
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 divide-x divide-[var(--border)] border-b border-[var(--border)]">
        <div className="px-4 py-3 text-center">
          <div className="text-lg font-bold tabular-nums text-[var(--text)]">{artist.total_chart_entries ?? "—"}</div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Появ</div>
        </div>
        <div className="px-4 py-3 text-center">
          <div className="text-lg font-bold tabular-nums text-[var(--text)]">{formatDateDDMMYYYY(artist.first_seen)}</div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Вперше</div>
        </div>
        <div className="px-4 py-3 text-center">
          <div className="text-lg font-bold tabular-nums text-[var(--text)]">{formatDateDDMMYYYY(artist.last_seen)}</div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Востаннє</div>
        </div>
      </div>

      {/* Genre stats */}
      {genreStats.length > 0 && (
        <section className="border-b border-[var(--border)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--bg-table-header)]">
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">Жанр</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">Появ</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">Топ</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">Сер.</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">7д</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {genreStats.map((g) => {
                  const m = g.momentum_7d != null ? parseFloat(g.momentum_7d) : null;
                  return (
                    <tr key={g.genre_slug} className="transition-colors hover:bg-[var(--bg-hover)]">
                      <td className="px-4 py-2 font-medium text-[var(--text)]">{g.genre_slug}</td>
                      <td className="px-3 py-2 tabular-nums text-[var(--text)]">{g.entries}</td>
                      <td className="px-3 py-2 tabular-nums text-[var(--text)]">#{g.best_position}</td>
                      <td className="px-3 py-2 tabular-nums text-[var(--text-muted)]">{Number(g.avg_position).toFixed(1)}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {m != null ? (
                          <span className={m > 0 ? "text-[var(--accent)]" : m < 0 ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}>
                            {m > 0 ? "↑" : m < 0 ? "↓" : "—"}{Math.abs(m).toFixed(1)}
                          </span>
                        ) : <span className="text-[var(--text-muted)]">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Links & contacts */}
      {(allLinks.length > 0 || emails.length > 0) && (
        <section className="px-4 py-3 border-b border-[var(--border)]">
          <div className="flex flex-wrap gap-2">
            {allLinks.map((l) => (
              <a
                key={l.type}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-medium text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-hover)]"
              >
                <LinkIcon type={l.type} />
                {linkTypeLabel(l.type)}
              </a>
            ))}
            {emails.map((c, i) => {
              const src = contactSourceLabel(c.source_url);
              return (
                <a
                  key={`${c.value}-${i}`}
                  href={`mailto:${c.value}`}
                  title={c.value}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-3 py-1.5 text-xs font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/10"
                >
                  <LinkIcon type="email" />
                  {emails.length > 1 ? c.value : "Email"}{src ? ` · ${src}` : ""}
                </a>
              );
            })}
          </div>
        </section>
      )}

      {/* Signals — compact grid */}
      {signalItems.length > 0 && (
        <section className="border-b border-[var(--border)] px-4 py-3">
          <div className="grid grid-cols-3 gap-x-4 gap-y-1 sm:grid-cols-5">
            {signalItems.map((s) => (
              <div key={s.label}>
                <div className="text-sm font-semibold tabular-nums text-[var(--text)]">{s.value}</div>
                <div className="text-[10px] text-[var(--text-muted)]">{s.label}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Notes */}
      <section className="px-4 py-3 border-b border-[var(--border)]">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          placeholder="Нотатки…"
          rows={2}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-page)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
      </section>

      {/* Actions */}
      <section className="px-4 py-3 flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={runEnrichment}
          disabled={enrichLoading}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          {enrichLoading ? <ButtonSpinner /> : (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )}
          {enrichLoading ? "Пошук…" : "Enrichment"}
        </button>
        <button
          type="button"
          onClick={copyOutreach}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-hover)]"
        >
          <svg className="h-4 w-4 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
          </svg>
          {copied ? "✓" : "Outreach"}
        </button>
        <button
          type="button"
          onClick={exportContact}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-hover)]"
        >
          <svg className="h-4 w-4 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          CSV
        </button>
        <button
          type="button"
          onClick={markContacted}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-hover)]"
        >
          <svg className="h-4 w-4 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {status === "New" ? "Написав" : status === "Attempt 1" ? "Написав вдруге" : "На контакті"}
        </button>
      </section>
    </article>
  );
}
