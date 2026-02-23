"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
type LinkRow = { id?: string; type: string; url: string; status?: string };
type ContactRow = { id?: string; type: string; value: string; source_url?: string | null; confidence?: number; status?: string };

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
  const [flaggedLinks, setFlaggedLinks] = useState<Set<string>>(() => new Set(links.filter(l => l.status === "flagged").map(l => l.id!).filter(Boolean)));
  const [flaggedContacts, setFlaggedContacts] = useState<Set<string>>(() => new Set(contacts.filter(c => c.status === "flagged").map(c => c.id!).filter(Boolean)));

  useEffect(() => {
    setStatus(initialProfile?.status ?? "New");
    setNotes(initialProfile?.notes ?? "");
  }, [initialProfile?.status, initialProfile?.notes]);

  const hasFlaggedItems = flaggedLinks.size > 0 || flaggedContacts.size > 0;

  const toggleFlag = useCallback(async (table: "link" | "contact", id: string) => {
    const setFlagged = table === "link" ? setFlaggedLinks : setFlaggedContacts;
    const isFlagged = (table === "link" ? flaggedLinks : flaggedContacts).has(id);
    const newFlagged = !isFlagged;

    setFlagged(prev => {
      const next = new Set(prev);
      if (newFlagged) next.add(id); else next.delete(id);
      return next;
    });

    try {
      await fetch("/api/internal/enrich/flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table, id, flagged: newFlagged }),
      });
      toast(newFlagged ? "Помічено як помилковий" : "Відмічення знято", newFlagged ? "info" : "success");
    } catch {
      setFlagged(prev => {
        const next = new Set(prev);
        if (isFlagged) next.add(id); else next.delete(id);
        return next;
      });
      toast("Помилка при оновленні", "error");
    }
  }, [flaggedLinks, flaggedContacts, toast]);

  const rescanArtist = useCallback(async () => {
    setEnrichLoading(true);
    try {
      const res = await fetch(`/api/internal/enrich/artist?artistId=${artist.artist_beatport_id}&rescan=1`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        toast(`Ресканування завершено: ${data.linksAdded} посилань, ${data.contactsAdded} контактів`, "success");
        setFlaggedLinks(new Set());
        setFlaggedContacts(new Set());
        router.refresh();
      } else {
        toast(data.error ?? "Помилка ресканування", "error", { long: true });
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Помилка", "error");
    } finally {
      setEnrichLoading(false);
    }
  }, [artist.artist_beatport_id, toast, router]);

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
      subject: "Congrats on your recent Beatport chart entry | Promosound",
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

  const socialVariants = useMemo(() => [
    `Hey ${displayName} 👋\n\nSaw your track hit the Beatport charts — congrats, that's big.\n\nQuick one: we run a Daily Push product made specifically for tracks that are already charting. It helps you hold the position longer and can move the track higher while the chart window is still active.\n\nIf you want, send me the link + which chart you're in, and I'll tell you what plan makes sense. No pressure.`,
    `Hey ${displayName} 👋\n\nJust noticed your track on the Beatport charts — solid stuff.\n\nWe have a Daily Push service built exactly for tracks in this position. It's designed to keep your chart placement longer and push it higher while the momentum is there.\n\nDrop me the track link and your chart, I'll let you know what would work best. Zero obligation.`,
    `Hey ${displayName} 👋\n\nCongrats on landing in the Beatport charts — that's no small thing.\n\nWe offer a Daily Push specifically for charting tracks. The idea is simple: extend your time on the chart and improve your position while the window's open.\n\nSend me the link + the chart you're in, and I'll share what plan fits. No strings attached.`,
    `Hey ${displayName} 👋\n\nSpotted your track charting on Beatport — nice one.\n\nWe've got a product called Daily Push that works best for tracks already in the charts. It helps maintain and improve your position during the active chart window.\n\nIf you're interested, just share the track link and which chart — I'll tell you what makes sense. No commitment needed.`,
    `Hey ${displayName} 👋\n\nYour track made it to the Beatport charts — congrats, well deserved.\n\nI work with a tool called Daily Push that's designed for exactly this moment — helping charting tracks hold position and climb higher while they're still active.\n\nHappy to take a look if you send me the link and chart name. Totally no pressure either way.`,
    `Hey ${displayName} 👋\n\nSaw you just entered the Beatport charts — that's awesome.\n\nWanted to mention our Daily Push — it's made for tracks that are already charting. The goal is to keep the momentum going and push you up while the chart window is still live.\n\nFeel free to send me the track link + chart, and I'll suggest the best approach. No pressure at all.`,
    `Hey ${displayName} 👋\n\nNoticed your Beatport chart entry — great achievement.\n\nWe run a Daily Push service that targets charting tracks specifically. It helps you stay on the chart longer and improve position while things are still moving.\n\nIf you want, share the track link and chart — I'll figure out what plan works. No obligation whatsoever.`,
  ], [displayName]);

  const [socialVariantIdx, setSocialVariantIdx] = useState(0);
  const socialVariantInitRef = useRef(false);
  useEffect(() => {
    if (!socialVariantInitRef.current) {
      socialVariantInitRef.current = true;
      setSocialVariantIdx(Math.floor(Math.random() * socialVariants.length));
    }
  }, [socialVariants.length]);

  const socialTemplate = useMemo(() => ({
    touch: 1, label: "DM", hint: "Одне повідомлення", statusValue: "Contacted",
    subject: "",
    body: socialVariants[socialVariantIdx],
    color: "#a78bfa", bg: "rgba(167,139,250,0.08)", borderColor: "rgba(167,139,250,0.25)",
  }), [socialVariants, socialVariantIdx]);

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

  const emailSentTouches = useMemo(() => {
    const match = notes.match(/\[email:([^\]]+)\]/);
    return match ? match[1].split(",").map(Number).filter(Boolean) : [];
  }, [notes]);

  const toggleEmailSent = useCallback((touchNum: number) => {
    const current = [...emailSentTouches];
    const idx = current.indexOf(touchNum);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(touchNum);
    }
    current.sort();
    const cleanNotes = notes.replace(/\[email:[^\]]+\]\s*/g, "").trim();
    const tag = current.length > 0 ? `[email:${current.join(",")}]` : "";
    const updatedNotes = tag ? (cleanNotes ? `${tag} ${cleanNotes}` : tag) : cleanNotes;
    setNotes(updatedNotes);

    const t = emailTemplates[touchNum - 1];
    if (t && idx < 0) {
      setStatus(t.statusValue);
      saveProfile({ status: t.statusValue, notes: updatedNotes });
      toast(`Touch ${touchNum} відмічено`, "success");
    } else {
      saveProfile({ notes: updatedNotes });
      toast(`Touch ${touchNum} знято`, "info");
    }
  }, [emailSentTouches, notes, emailTemplates, saveProfile, toast]);

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
              {hasFlaggedItems && (
                <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "#f87171" }}>
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {flaggedLinks.size + flaggedContacts.size} помилк.
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
              const isFlagged = !!(l.id && flaggedLinks.has(l.id));
              return (
                <span key={l.type} className="inline-flex items-center gap-0 rounded-full border text-xs font-medium transition-colors" style={{
                  borderColor: isFlagged ? "rgba(239,68,68,0.4)" : isSentViaThis ? "rgba(52,211,153,0.4)" : "var(--border)",
                  backgroundColor: isFlagged ? "rgba(239,68,68,0.08)" : isSentViaThis ? "rgba(52,211,153,0.1)" : "var(--bg-card)",
                  color: isFlagged ? "#f87171" : "var(--text)",
                  opacity: isFlagged ? 0.6 : 1,
                }}>
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 pl-3 py-1.5 pr-1.5 transition-colors hover:bg-[var(--bg-hover)] rounded-l-full"
                  >
                    <LinkIcon type={l.type} brandColor />
                    {linkTypeLabel(l.type)}
                    {isSentViaThis && !isFlagged && (
                      <svg className="h-3.5 w-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                    )}
                    {isFlagged && (
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    )}
                  </a>
                  {l.id && (
                    <button
                      type="button"
                      title={isFlagged ? "Зняти позначку помилки" : "Помилковий результат"}
                      onClick={() => toggleFlag("link", l.id!)}
                      className="inline-flex items-center px-2 py-1.5 transition-colors hover:bg-red-500/10 rounded-r-full"
                    >
                      {isFlagged ? (
                        <svg className="h-3.5 w-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" /></svg>
                      ) : (
                        <svg className="h-3.5 w-3.5 opacity-40 hover:opacity-100 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 11-12.728 0M12 9v4m0 4h.01" /></svg>
                      )}
                    </button>
                  )}
                </span>
              );
            })}
            {emails.map((c, i) => {
              const src = contactSourceLabel(c.source_url);
              const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(c.value)}`;
              const isFlagged = !!(c.id && flaggedContacts.has(c.id));
              return (
                <span key={`${c.value}-${i}`} className="inline-flex items-center gap-0 rounded-full border text-xs font-medium" style={{
                  borderColor: isFlagged ? "rgba(239,68,68,0.4)" : "rgba(var(--accent-rgb, 96,165,250),0.3)",
                  backgroundColor: isFlagged ? "rgba(239,68,68,0.08)" : "rgba(var(--accent-rgb, 96,165,250),0.05)",
                  color: isFlagged ? "#f87171" : "var(--accent)",
                  opacity: isFlagged ? 0.6 : 1,
                }}>
                  <a
                    href={gmailUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Відкрити Gmail для ${c.value}`}
                    className="inline-flex items-center gap-1.5 pl-3 py-1.5 pr-1.5 transition-colors hover:bg-[var(--accent)]/10 rounded-l-full"
                  >
                    <LinkIcon type="email" brandColor />
                    {c.value}{src ? ` · ${src}` : ""}
                    {isFlagged && (
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    )}
                  </a>
                  <button
                    type="button"
                    title="Копіювати email"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(c.value);
                        toast("Email скопійовано", "success");
                        setOutreachChannel("email");
                        setExpandedTouch(0);
                      } catch { /* ignore */ }
                    }}
                    className="inline-flex items-center px-2 py-1.5 transition-colors hover:bg-[var(--accent)]/10"
                  >
                    <svg className="h-3.5 w-3.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  </button>
                  {c.id && (
                    <button
                      type="button"
                      title={isFlagged ? "Зняти позначку помилки" : "Помилковий email"}
                      onClick={() => toggleFlag("contact", c.id!)}
                      className="inline-flex items-center px-2 py-1.5 transition-colors hover:bg-red-500/10 rounded-r-full"
                    >
                      {isFlagged ? (
                        <svg className="h-3.5 w-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" /></svg>
                      ) : (
                        <svg className="h-3.5 w-3.5 opacity-40 hover:opacity-100 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 11-12.728 0M12 9v4m0 4h.01" /></svg>
                      )}
                    </button>
                  )}
                </span>
              );
            })}
          </div>
          {hasFlaggedItems && (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={rescanArtist}
                disabled={enrichLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-400 transition-colors hover:bg-amber-500/20 cursor-pointer disabled:opacity-50"
              >
                {enrichLoading ? (
                  <ButtonSpinner />
                ) : (
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                )}
                Ресканувати
              </button>
              <span className="text-[10px] text-[var(--text-muted)]">
                {flaggedLinks.size + flaggedContacts.size} помічено як помилкові — будуть видалені та знайдені заново
              </span>
            </div>
          )}
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
              const isThisSent = emailSentTouches.includes(i + 1);
              const isActive = expandedTouch === i;
              return (
                <button
                  key={t.touch}
                  onClick={() => setExpandedTouch(isActive ? null : i)}
                  className="flex-1 rounded-md py-1 text-[10px] font-semibold transition-all"
                  style={{
                    backgroundColor: isActive ? t.bg : "transparent",
                    color: isThisSent ? t.color : isActive ? t.color : "var(--text-muted)",
                    border: isActive ? `1px solid ${t.borderColor}` : "1px solid transparent",
                  }}
                >
                  {isThisSent && <span className="mr-0.5">✓</span>}{t.label}
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
          const socialLinks = links.filter((l) => ["instagram", "facebook", "twitter", "soundcloud", "mixcloud"].includes(l.type) && !(l.id && flaggedLinks.has(l.id)));
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
                {outreachChannel === "email" && (() => {
                  const touchNum = (expandedTouch ?? 0) + 1;
                  const isEmailSent = emailSentTouches.includes(touchNum);
                  return (
                    <button
                      type="button"
                      onClick={() => toggleEmailSent(touchNum)}
                      disabled={profileSaving}
                      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-all cursor-pointer"
                      style={{
                        borderColor: isEmailSent ? "rgba(52,211,153,0.4)" : t.borderColor,
                        color: isEmailSent ? "#34d399" : "var(--text)",
                        backgroundColor: isEmailSent ? "rgba(52,211,153,0.1)" : "transparent",
                      }}
                    >
                      {isEmailSent && (
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                      )}
                      <LinkIcon type="email" brandColor />
                      {isEmailSent ? "Надіслано" : "Позначити надісланим"}
                    </button>
                  );
                })()}
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
          value={notes.replace(/\[via:[^\]]+\]\s*/g, "").replace(/\[email:[^\]]+\]\s*/g, "")}
          onChange={(e) => {
            const viaTag = notes.match(/\[via:[^\]]+\]/)?.[0] ?? "";
            const emailTag = notes.match(/\[email:[^\]]+\]/)?.[0] ?? "";
            const tags = [viaTag, emailTag].filter(Boolean).join(" ");
            const clean = e.target.value;
            setNotes(tags ? `${tags} ${clean}`.trim() : clean);
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
