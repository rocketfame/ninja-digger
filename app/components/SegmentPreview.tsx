"use client";

import { useState } from "react";

type Col = { header: string; key: string; num?: boolean; link?: boolean };
type Row = { name?: string | null; link?: string | null; email?: string | null } & Record<string, unknown>;

/** Generic "preview this email segment" modal, shared across channels. The
 * previewUrl must return { total:number, rows:[{name,link,email,...}] }. Extra
 * per-channel columns are declared via extraColumns. */
export function SegmentPreview({
  previewUrl, downloadUrl, count, extraColumns = [], accent = "var(--accent)",
}: { previewUrl: string; downloadUrl: string; count: number; extraColumns?: Col[]; accent?: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  async function openModal() {
    setOpen(true);
    if (rows) return;
    setLoading(true);
    try {
      const d = await fetch(previewUrl).then((r) => r.json());
      setRows(d.rows ?? []);
      setTotal(d.total ?? 0);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  const num = (v: unknown): string => (typeof v === "number" ? v.toLocaleString("uk-UA") : v == null || v === "" ? "—" : String(v));

  return (
    <>
      <button type="button" onClick={openModal}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-5 py-2.5 text-sm font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)]/60 hover:text-[var(--text)]">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
        Превʼю сегмента
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <div className="text-left">
                <div className="text-sm font-semibold text-[var(--text)]">Превʼю сегмента</div>
                <div className="text-xs text-[var(--text-muted)]">
                  {total.toLocaleString("uk-UA")} лідів з email {rows && total > rows.length ? `· показано перші ${rows.length}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a href={downloadUrl} download
                  className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: accent }}>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4" /></svg>
                  Завантажити {count.toLocaleString("uk-UA")}
                </a>
                <button type="button" onClick={() => setOpen(false)}
                  className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-white/5 hover:text-[var(--text)]">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            <div className="overflow-auto">
              {loading && <div className="p-10 text-center text-sm text-[var(--text-muted)]">Завантажую превʼю…</div>}
              {!loading && rows && rows.length === 0 && <div className="p-10 text-center text-sm text-[var(--text-muted)]">Порожньо</div>}
              {!loading && rows && rows.length > 0 && (
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-[var(--bg-card)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    <tr className="border-b border-[var(--border)]">
                      <th className="px-4 py-2.5 font-medium">Імʼя</th>
                      <th className="px-4 py-2.5 font-medium">Email</th>
                      {extraColumns.map((c) => (
                        <th key={c.key} className={`px-4 py-2.5 font-medium ${c.num ? "text-right" : ""}`}>{c.header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-b border-[var(--border)]/50 hover:bg-white/[0.02]">
                        <td className="px-4 py-2.5">
                          {r.link ? (
                            <a href={r.link} target="_blank" rel="noreferrer" className="font-medium text-[var(--text)] hover:text-[var(--accent)]">{r.name || "—"}</a>
                          ) : (
                            <span className="font-medium text-[var(--text)]">{r.name || "—"}</span>
                          )}
                          {typeof r.handle === "string" && r.handle && <div className="text-[10px] text-[var(--text-muted)]">{r.handle}</div>}
                        </td>
                        <td className="px-4 py-2.5 text-[var(--text-muted)]">{r.email ?? "—"}</td>
                        {extraColumns.map((c) => {
                          const v = r[c.key];
                          if (c.link) {
                            const url = typeof v === "string" && v ? v : "";
                            return (
                              <td key={c.key} className="px-4 py-2.5">
                                {url ? <a href={url} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">↗</a> : <span className="text-[var(--text-muted)]">—</span>}
                              </td>
                            );
                          }
                          return <td key={c.key} className={`px-4 py-2.5 text-[var(--text-muted)] ${c.num ? "text-right tabular-nums" : ""}`}>{num(v)}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
