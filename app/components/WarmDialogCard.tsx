"use client";

import { useCallback, useState } from "react";

type SegmentRow = {
  artist_beatport_id: string;
  artist_name: string | null;
  email: string;
  lead_status: string;
  tier: string | null;
};

type DialogMessage = { direction: "in" | "out"; subject: string; date: string; text: string };

const STATUS_UA: Record<string, string> = { "Responded": "Відповів", "In Progress": "В діалозі", "Won": "Виграно" };

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-[var(--text-muted)]">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      {label}
    </div>
  );
}

export function WarmDialogCard({ count, lastUpdated }: { count: number; lastUpdated: string | null }) {
  const [open, setOpen] = useState(false);
  const [leads, setLeads] = useState<SegmentRow[] | null>(null);
  const [selected, setSelected] = useState<SegmentRow | null>(null);
  const [dialog, setDialog] = useState<DialogMessage[] | null>(null);
  const [loadingDialog, setLoadingDialog] = useState(false);
  const [dialogCache] = useState(() => new Map<string, DialogMessage[]>());

  const fetchDialog = useCallback(async (artistId: string): Promise<DialogMessage[]> => {
    const hit = dialogCache.get(artistId);
    if (hit) return hit;
    const data = await fetch(`/api/internal/lead-dialog?artistId=${encodeURIComponent(artistId)}`)
      .then((r) => r.json())
      .catch(() => null);
    const msgs: DialogMessage[] = data?.messages ?? [];
    dialogCache.set(artistId, msgs);
    return msgs;
  }, [dialogCache]);

  const openModal = useCallback(async () => {
    setOpen(true);
    let rows = leads;
    if (!rows) {
      const data = await fetch("/api/segments/email/list?type=warm").then((r) => r.json()).catch(() => null);
      rows = data?.rows ?? [];
      setLeads(rows);
    }
    // Background prefetch: warm the server cache one by one so clicks are instant
    (async () => {
      for (const l of rows ?? []) {
        if (!dialogCache.has(l.artist_beatport_id)) await fetchDialog(l.artist_beatport_id).catch(() => {});
      }
    })();
  }, [leads, dialogCache, fetchDialog]);

  const openDialog = useCallback(async (lead: SegmentRow) => {
    setSelected(lead);
    if (dialogCache.has(lead.artist_beatport_id)) {
      setDialog(dialogCache.get(lead.artist_beatport_id)!);
      setLoadingDialog(false);
      return;
    }
    setDialog(null);
    setLoadingDialog(true);
    const msgs = await fetchDialog(lead.artist_beatport_id);
    setDialog(msgs);
    setLoadingDialog(false);
  }, [dialogCache, fetchDialog]);

  return (
    <>
      <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 transition-colors hover:border-[var(--accent)]/50">
        <button type="button" onClick={openModal} className="flex-1 text-left">
          <div className="text-xs text-[var(--text-muted)]">🔥 Теплі (відповідали) <span className="text-[var(--accent)]">→ діалоги</span></div>
          <div className="text-2xl font-bold tabular-nums leading-tight text-green-400">{count}</div>
          {lastUpdated && <div className="text-[9px] text-[var(--text-muted)]">оновлено {lastUpdated.slice(5, 16).replace("T", " ")}</div>}
        </button>
        <a
          href="/api/segments/email/export?type=warm"
          title="Завантажити CSV"
          download
          className="rounded-md border border-[var(--border)] p-2 text-[var(--text-muted)] transition-colors hover:border-[var(--accent)]/60 hover:text-[var(--text)]"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4" />
          </svg>
        </a>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <div
            className="flex h-[80vh] w-full max-w-4xl overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Lead list */}
            <div className="w-64 shrink-0 overflow-y-auto border-r border-[var(--border)]">
              <div className="sticky top-0 border-b border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm font-semibold">
                🔥 Теплі ліди {leads ? `(${leads.length})` : ""}
              </div>
              {!leads && <div className="p-4"><Spinner label="Завантажую лідів…" /></div>}
              {leads?.map((l) => (
                <button
                  key={l.artist_beatport_id}
                  type="button"
                  onClick={() => openDialog(l)}
                  className={`block w-full border-b border-[var(--border)]/50 px-4 py-2.5 text-left transition-colors hover:bg-[var(--bg-page)] ${selected?.artist_beatport_id === l.artist_beatport_id ? "bg-[var(--bg-page)]" : ""}`}
                >
                  <div className="text-sm font-medium">{l.artist_name ?? l.artist_beatport_id} {l.tier === "A" ? "💎" : ""}</div>
                  <div className="truncate text-[10px] text-[var(--text-muted)]">{l.email}</div>
                  <div className="text-[10px] text-green-400">{STATUS_UA[l.lead_status] ?? l.lead_status}</div>
                </button>
              ))}
            </div>

            {/* Dialog view */}
            <div className="flex flex-1 flex-col">
              <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                <div className="text-sm font-semibold">
                  {selected ? `💬 ${selected.artist_name ?? selected.artist_beatport_id}` : "Обери ліда зліва"}
                </div>
                <button type="button" onClick={() => setOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text)]">✕</button>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {loadingDialog && <Spinner label="Тягну листування з Gmail (перший раз ~5-10с, далі миттєво)…" />}
                {dialog && dialog.length === 0 && <div className="text-sm text-[var(--text-muted)]">Листів не знайдено за 180 днів.</div>}
                {dialog?.map((m, i) => (
                  <div key={i} className={`max-w-[85%] ${m.direction === "out" ? "ml-auto" : ""}`}>
                    <div className={`rounded-xl px-4 py-2.5 text-sm leading-relaxed ${m.direction === "out" ? "bg-[var(--accent)]/15 border border-[var(--accent)]/30" : "border border-[var(--border)] bg-[var(--bg-page)]"}`}>
                      <div className="mb-1 flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                        <b>{m.direction === "out" ? "Ми" : selected?.artist_name ?? "Лід"}</b>
                        <span>{m.date.slice(0, 16).replace("T", " ")}</span>
                      </div>
                      {m.subject && <div className="mb-1 text-[11px] font-semibold text-[var(--text-muted)]">✉️ {m.subject}</div>}
                      <div className="whitespace-pre-wrap">{m.text || "(порожньо)"}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
