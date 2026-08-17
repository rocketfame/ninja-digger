"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function HarvestButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setMsg("Збираю фоловерів із SoundCloud…");
    try {
      let totalNew = 0;
      for (let i = 0; i < 5; i++) {
        const data = await fetch("/api/cron/soundcloud?pages=6", { method: "POST" }).then((r) => r.json());
        totalNew += data.harvested ?? 0;
        setMsg(`Зібрано ${totalNew} нових артистів…`);
        if (data.done) break;
      }
      setMsg(`Готово: +${totalNew} артистів`);
      router.refresh();
    } catch {
      setMsg("Помилка збору");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {msg && <span className="text-xs text-[var(--text-muted)]">{msg}</span>}
      <button type="button" onClick={run} disabled={loading}
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50">
        {loading ? "Збираю…" : "Зібрати фоловерів"}
      </button>
    </div>
  );
}
