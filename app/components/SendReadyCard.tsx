import type { ReactNode } from "react";
import { SegmentPreview } from "@/app/components/SegmentPreview";

type Example = { name: string; email?: string | null; link?: string | null };
type Col = { header: string; key: string; num?: boolean; link?: boolean };

/**
 * Shared "Готові до розсилки" result card — identical across all channels
 * (Beatport / SoundCloud / Spotify). Sits in the right sticky column of the
 * two-column channel layout: headline email count, primary download, segment
 * preview, optional secondary actions, and a few example contacts.
 */
export function SendReadyCard({
  count,
  downloadUrl,
  downloadLabel,
  previewUrl,
  previewColumns = [],
  examples = [],
  examplesTitle = "Приклад із сегмента",
  emptyNote,
  subline,
  accent = "var(--accent)",
  secondaryActions,
  footer,
}: {
  count: number;
  downloadUrl: string;
  downloadLabel?: string;
  previewUrl: string;
  previewColumns?: Col[];
  examples?: Example[];
  examplesTitle?: string;
  emptyNote?: string;
  subline?: ReactNode;
  accent?: string;
  secondaryActions?: ReactNode;
  footer?: ReactNode;
}) {
  const n = (x: number) => x.toLocaleString("uk-UA");
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 text-center">
      <div className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Готові до розсилки</div>
      <div className="my-2 text-5xl font-bold tabular-nums text-[var(--accent)]">{n(count)}</div>
      {subline && <div className="text-sm text-[var(--text-muted)]">{subline}</div>}

      <a href={downloadUrl} download
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--accent-hover)]">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4" /></svg>
        {downloadLabel ?? `Завантажити ${n(count)} з email`}
      </a>

      {secondaryActions}

      <SegmentPreview previewUrl={previewUrl} downloadUrl={downloadUrl} count={count} extraColumns={previewColumns} accent={accent} />

      {footer}

      {examples.length > 0 ? (
        <div className="mt-5 border-t border-[var(--border)] pt-4 text-left">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{examplesTitle}</div>
          <ul className="space-y-1.5 text-xs">
            {examples.map((e, i) => (
              <li key={i} className="truncate">
                {e.link
                  ? <a href={e.link} target="_blank" rel="noreferrer" className="font-medium hover:text-[var(--accent)]">{e.name}</a>
                  : <span className="font-medium">{e.name}</span>}
                {e.email && <span className="text-[var(--text-muted)]"> · {e.email}</span>}
              </li>
            ))}
          </ul>
        </div>
      ) : emptyNote ? (
        <div className="mt-5 border-t border-[var(--border)] pt-4 text-left">
          <p className="text-xs text-[var(--text-muted)]">{emptyNote}</p>
        </div>
      ) : null}
    </div>
  );
}
