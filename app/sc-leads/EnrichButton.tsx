"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function EnrichButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setMsg("Шукаю контакти по лінках (Linktree, сайт, IG)…");
    try {
      let found = 0, processed = 0;
      for (let i = 0; i < 6; i++) {
        const d = await fetch("/api/internal/soundcloud/enrich", { method: "POST" }).then((r) => r.json());
        found += d.found ?? 0; processed += d.processed ?? 0;
        setMsg(`Оброблено ${processed}, знайдено email: ${found}…`);
        if ((d.processed ?? 0) === 0) break;
      }
      setMsg(`✅ Знайдено ${found} нових email`);
      router.refresh();
    } catch {
      setMsg("Помилка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3">
      <button type="button" onClick={run} disabled={loading}
        className="w-full rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)]/60 hover:text-[var(--text)] disabled:opacity-50">
        {loading ? "Шукаю контакти…" : "Знайти більше email"}
      </button>
      {msg && <div className="mt-2 text-[11px] text-[var(--text-muted)]">{msg}</div>}
    </div>
  );
}
