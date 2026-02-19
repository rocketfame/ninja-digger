"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  const { toast } = useToast();
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

  const [outreachChannel, setOutreachChannel] = useState<"email" | "social">("social");

  const emailTemplates = useMemo(() => [
    {
      touch: 1, label: "Touch 1", hint: "М'який старт", statusValue: "Attempt 1",
      subject: "Congrats on your recent chart entry",
      body: `Hi ${displayName},\n\nSaw your recent appearance in the Beatport charts — great move.\n\nI'm Max from PromoSound. We work with electronic artists right when momentum starts building, helping extend that visibility across platforms in a structured way.\n\nIf you're planning to push this release further, I'd be happy to share a few ideas tailored to your current stage.\n\nBest,\nMax`,
      color: "#60a5fa", bg: "rgba(59,130,246,0.08)", borderColor: "rgba(59,130,246,0.25)",
    },
    {
      touch: 2, label: "Touch 2", hint: "Follow-up — через 3–4 дні", statusValue: "Attempt 2",
      subject: "Re: chart momentum",
      body: `Hi ${displayName},\n\nJust wanted to briefly follow up in case my previous message got buried.\n\nWhen a track starts moving in the charts, there's usually a short window where additional exposure can significantly amplify results.\n\nIf you're open to it, I can outline how we typically approach this stage for electronic releases.\n\nBest,\nMax`,
      color: "#818cf8", bg: "rgba(129,140,248,0.08)", borderColor: "rgba(129,140,248,0.25)",
    },
    {
      touch: 3, label: "Touch 3", hint: "Закриття — ще через 4–5 днів", statusValue: "No Response",
      subject: "Should I close the loop?",
      body: `Hi ${displayName},\n\nI'll keep this short — just wanted to check once more before I step back.\n\nIf building on your recent chart momentum is something you'd like to explore, I'd be glad to connect.\n\nIf now isn't the right time, no worries at all — wishing you continued success with the release.\n\nBest,\nMax`,
      color: "#f97316", bg: "rgba(249,115,22,0.08)", borderColor: "rgba(249,115,22,0.25)",
    },
  ], [displayName]);

  const socialTemplate = useMemo(() => ({
    touch: 1, label: "DM", hint: "Одне повідомлення", statusValue: "Contacted",
    subject: "",
    body: `Hey ${displayName} 👋\n\nSaw your track hit the Beatport charts — congrats, that's big.\n\nQuick one: we run a Daily Push product made specifically for tracks that are already charting. It helps you hold the position longer and can move the track higher while the chart window is still active.\n\nIf you want, send me the link + which chart you're in, and I'll tell you what plan makes sense. No pressure.`,
    color: "#a78bfa", bg: "rgba(167,139,250,0.08)", borderColor: "rgba(167,139,250,0.25)",
  }), [displayName]);

  const touchTemplates = outreachChannel === "email" ? emailTemplates : [socialTemplate];

  const activeTouchIndex = outreachChannel === "social"
    ? (["New", "Contacted"].includes(status) ? 0 : -1)
    : status === "New" ? 0
      : status === "Attempt 1" ? 1
      : status === "Attempt 2" ? 2
      : -1;

  const [copiedTouch, setCopiedTouch] = useState<number | null>(null);
  const [expandedTouch, setExpandedTouch] = useState<number | null>(0);

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

  const copyTouch = useCallback(async (touchIdx: number) => {
    const t = touchTemplates[touchIdx];
    if (!t) return;
    const full = t.subject ? `Subject: ${t.subject}\n\n${t.body}` : t.body;
    try {
      await navigator.clipboard.writeText(full);
      setCopiedTouch(touchIdx);
      toast(`Touch ${touchIdx + 1} скопійовано`, "success");
      setTimeout(() => setCopiedTouch(null), 2000);
    } catch { /* ignore */ }
  }, [touchTemplates, toast]);

  const markTouchSent = useCallback((touchIdx: number) => {
    const t = touchTemplates[touchIdx];
    if (!t) return;
    setStatus(t.statusValue);
    saveProfile({ status: t.statusValue });
    toast(`Статус → ${t.statusValue}`, "success");
  }, [touchTemplates, saveProfile, toast]);

  const runEnrichment = useCallback(() => {
    setEnrichLoading(true);
    toast("Пошук контактів запущено у фоні…", "success");

    fetch(`/api/internal/enrich/artist?artistId=${encodeURIComponent(artist.artist_beatport_id)}`, {
      method: "POST",
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (data?.ok ?? res.ok) {
          playSuccessSound();
          toast(`✅ Контакти для ${displayName} знайдено!`, "success", { long: true });
          router.refresh();
        } else {
          toast(data?.error ?? `Помилка enrichment ${res.status}`, "error", { long: true });
        }
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        toast(msg === "Failed to fetch" ? "Не вдалося виконати запит." : msg, "error", { long: true });
      })
      .finally(() => setEnrichLoading(false));
  }, [artist.artist_beatport_id, displayName, router, toast]);

  const sentViaList = useMemo(() => {
    const match = notes.match(/\[via:([^\]]+)\]/);
    return match ? match[1].split(",").filter(Boolean) : [];
  }, [notes]);

  const toggleSocialSent = useCallback((network: string) => {
    const current = [...sentViaList];
    const idx = current.indexOf(network);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(network);
    }
    const cleanNotes = notes.replace(/\[via:[^\]]+\]\s*/g, "").trim();
    const tag = current.length > 0 ? `[via:${current.join(",")}]` : "";
    const updatedNotes = tag ? (cleanNotes ? `${tag} ${cleanNotes}` : tag) : cleanNotes;
    setNotes(updatedNotes);

    const isFirstMark = sentViaList.length === 0 && current.length > 0;
    const sentStatuses = ["Attempt 1", "Attempt 2", "No Response", "Responded", "In Progress", "Won", "Contacted"];
    const alreadySent = sentStatuses.includes(status);

    if (isFirstMark && !alreadySent) {
      const t = touchTemplates[0];
      if (t) {
        setStatus(t.statusValue);
        saveProfile({ status: t.statusValue, notes: updatedNotes });
      } else {
        saveProfile({ notes: updatedNotes });
      }
    } else {
      saveProfile({ notes: updatedNotes });
    }

    if (idx >= 0) {
      toast(`${linkTypeLabel(network)} знято`, "info");
    } else {
      toast(`${linkTypeLabel(network)} відмічено`, "success");
    }
  }, [sentViaList, notes, status, touchTemplates, saveProfile, toast]);

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

      {/* CRM Pipeline + Enrichment */}
      <div className="border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
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
          <button
            type="button"
            onClick={runEnrichment}
            disabled={enrichLoading}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-opacity"
          >
            {enrichLoading ? <ButtonSpinner /> : (
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            )}
            {enrichLoading ? "Шукаю…" : "Пошук контактів"}
          </button>
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
            {allLinks.map((l) => {
              const isSentViaThis = sentViaList.includes(l.type);
              return (
                <a
                  key={l.type}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-hover)]"
                  style={{
                    borderColor: isSentViaThis ? "rgba(52,211,153,0.4)" : "var(--border)",
                    backgroundColor: isSentViaThis ? "rgba(52,211,153,0.1)" : "var(--bg-card)",
                    color: "var(--text)",
                  }}
                >
                  <LinkIcon type={l.type} brandColor />
                  {linkTypeLabel(l.type)}
                  {isSentViaThis && (
                    <svg className="h-3.5 w-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                  )}
                </a>
              );
            })}
            {emails.map((c, i) => {
              const src = contactSourceLabel(c.source_url);
              const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(c.value)}`;
              return (
                <span key={`${c.value}-${i}`} className="inline-flex items-center gap-0 rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/5 text-xs font-medium text-[var(--accent)]">
                  <a
                    href={gmailUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Відкрити Gmail для ${c.value}`}
                    className="inline-flex items-center gap-1.5 pl-3 py-1.5 pr-1.5 transition-colors hover:bg-[var(--accent)]/10 rounded-l-full"
                  >
                    <LinkIcon type="email" brandColor />
                    {c.value}{src ? ` · ${src}` : ""}
                  </a>
                  <button
                    type="button"
                    title="Копіювати email"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(c.value);
                        toast("Email скопійовано", "success");
                      } catch { /* ignore */ }
                    }}
                    className="inline-flex items-center px-2 py-1.5 transition-colors hover:bg-[var(--accent)]/10 rounded-r-full"
                  >
                    <svg className="h-3.5 w-3.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  </button>
                </span>
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

      {/* Outreach */}
      <section className="border-b border-[var(--border)]">
        {/* Channel toggle */}
        <div className="px-4 pt-3 pb-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setOutreachChannel("social"); setExpandedTouch(0); }}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all border"
            style={{
              backgroundColor: outreachChannel === "social" ? "rgba(167,139,250,0.15)" : "transparent",
              color: outreachChannel === "social" ? "#a78bfa" : "var(--text-muted)",
              borderColor: outreachChannel === "social" ? "rgba(167,139,250,0.4)" : "var(--border)",
            }}
          >
            💬 Social DM
          </button>
          <button
            type="button"
            onClick={() => { setOutreachChannel("email"); setExpandedTouch(0); }}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all border"
            style={{
              backgroundColor: outreachChannel === "email" ? "rgba(96,165,250,0.15)" : "transparent",
              color: outreachChannel === "email" ? "#60a5fa" : "var(--text-muted)",
              borderColor: outreachChannel === "email" ? "rgba(96,165,250,0.4)" : "var(--border)",
            }}
          >
            ✉ Email · 3 touches
          </button>
        </div>

        {outreachChannel === "email" && (
          <div className="px-4 pb-2 flex items-center gap-1">
            {emailTemplates.map((t, i) => {
              const isSent = (i === 0 && ["Attempt 1", "Attempt 2", "No Response", "Responded", "In Progress", "Won", "Contacted"].includes(status))
                || (i === 1 && ["Attempt 2", "No Response", "Responded", "In Progress", "Won"].includes(status))
                || (i === 2 && ["No Response", "Responded", "In Progress", "Won"].includes(status));
              const isActive = expandedTouch === i;
              return (
                <button
                  key={t.touch}
                  onClick={() => setExpandedTouch(isActive ? null : i)}
                  className="flex-1 rounded-md py-1 text-[10px] font-semibold transition-all"
                  style={{
                    backgroundColor: isActive ? t.bg : "transparent",
                    color: isSent ? t.color : isActive ? t.color : "var(--text-muted)",
                    border: isActive ? `1px solid ${t.borderColor}` : "1px solid transparent",
                  }}
                >
                  {isSent && <span className="mr-0.5">✓</span>}{t.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Template body */}
        {expandedTouch != null && touchTemplates[expandedTouch] && (() => {
          const t = touchTemplates[expandedTouch];
          const sentStatuses = ["Attempt 1", "Attempt 2", "No Response", "Responded", "In Progress", "Won", "Contacted"];
          const isSent = outreachChannel === "social"
            ? sentStatuses.includes(status)
            : (expandedTouch === 0 && sentStatuses.includes(status))
              || (expandedTouch === 1 && ["Attempt 2", "No Response", "Responded", "In Progress", "Won"].includes(status))
              || (expandedTouch === 2 && ["No Response", "Responded", "In Progress", "Won"].includes(status));
          const socialLinks = links.filter((l) => ["instagram", "facebook", "twitter", "soundcloud", "mixcloud"].includes(l.type));
          return (
            <div className="mx-4 mb-3 rounded-lg border overflow-hidden" style={{ borderColor: t.borderColor, backgroundColor: t.bg }}>
              {/* Subject — email only */}
              {outreachChannel === "email" && t.subject && (
                <div className="px-4 py-2 border-b flex items-center gap-2" style={{ borderColor: t.borderColor + "80" }}>
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)] shrink-0">Subject:</span>
                  <span className="text-sm text-[var(--text)] font-medium">{t.subject}</span>
                </div>
              )}

              <div className="px-4 py-3">
                <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-[var(--text)]" style={{ fontFamily: "inherit" }}>
                  {t.body}
                </pre>
              </div>

              <div className="px-4 py-2 flex flex-wrap items-center gap-2 border-t" style={{ borderColor: t.borderColor }}>
                <button
                  type="button"
                  onClick={() => copyTouch(expandedTouch)}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all border"
                  style={{
                    borderColor: t.borderColor,
                    color: copiedTouch === expandedTouch ? t.color : "var(--text)",
                    backgroundColor: copiedTouch === expandedTouch ? t.color + "15" : "transparent",
                  }}
                >
                  {copiedTouch === expandedTouch ? (
                    <><svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> Скопійовано</>
                  ) : (
                    <><svg className="h-3.5 w-3.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg> Копіювати</>
                  )}
                </button>
                {outreachChannel === "email" && (
                  <>
                    {!isSent && (
                      <button
                        type="button"
                        onClick={() => markTouchSent(expandedTouch)}
                        disabled={profileSaving}
                        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white transition-all"
                        style={{ backgroundColor: t.color, opacity: profileSaving ? 0.5 : 1 }}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        Надіслано
                      </button>
                    )}
                    {isSent && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold" style={{ color: t.color }}>
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                        Надіслано
                      </span>
                    )}
                    {emails.length > 0 && (
                      <a
                        href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(emails[0].value)}&su=${encodeURIComponent(t.subject)}&body=${encodeURIComponent(t.body)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-[var(--text)] transition-colors hover:bg-[var(--bg-hover)]"
                        style={{ borderColor: t.borderColor }}
                      >
                        <svg className="h-3.5 w-3.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                        Gmail
                      </a>
                    )}
                  </>
                )}
                {outreachChannel === "social" && socialLinks.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)] mr-0.5">
                      {sentViaList.length > 0 ? "Надіслано:" : "Надіслати через:"}
                    </span>
                    {socialLinks.map((sl) => {
                      const isChecked = sentViaList.includes(sl.type);
                      return (
                        <button
                          key={sl.url}
                          type="button"
                          onClick={() => toggleSocialSent(sl.type)}
                          disabled={profileSaving}
                          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-all cursor-pointer"
                          style={{
                            borderColor: isChecked ? "rgba(52,211,153,0.4)" : t.borderColor,
                            color: isChecked ? "#34d399" : "var(--text)",
                            backgroundColor: isChecked ? "rgba(52,211,153,0.1)" : "transparent",
                          }}
                        >
                          {isChecked && (
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                          )}
                          <LinkIcon type={sl.type} brandColor />
                          {linkTypeLabel(sl.type)}
                        </button>
                      );
                    })}
                  </div>
                )}
                {outreachChannel === "social" && socialLinks.length === 0 && (
                  !isSent ? (
                    <button
                      type="button"
                      onClick={() => markTouchSent(expandedTouch)}
                      disabled={profileSaving}
                      className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white transition-all"
                      style={{ backgroundColor: t.color, opacity: profileSaving ? 0.5 : 1 }}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      Надіслано
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 px-3 py-1.5 text-xs font-bold text-emerald-400">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                      Надіслано
                    </span>
                  )
                )}
              </div>
            </div>
          );
        })()}
      </section>

      {/* Notes */}
      <section className="px-4 py-3 border-b border-[var(--border)]">
        <textarea
          value={notes.replace(/\[via:[^\]]+\]\s*/g, "")}
          onChange={(e) => {
            const viaTag = notes.match(/\[via:[^\]]+\]/)?.[0] ?? "";
            const clean = e.target.value;
            setNotes(viaTag ? `${viaTag} ${clean}`.trim() : clean);
          }}
          onBlur={saveNotes}
          placeholder="Нотатки…"
          rows={2}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-page)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
      </section>

    </article>
  );
}
