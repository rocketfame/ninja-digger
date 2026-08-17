"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SeedControl({ seed }: { seed: string | null }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function addSeed() {
    if (!url.trim()) return;
    setLoading(true);
    setMsg("Резолвлю профіль і збираю фоловерів…");
    try {
      const data = await fetch("/api/internal/soundcloud/seed", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }),
      }).then((r) => r.json());
      if (!data.ok) { setMsg(`⚠️ ${data.error}`); return; }
      setMsg(`✅ @${data.permalink}: +${data.harvested} артистів (фоловерів: ${data.followers})`);
      setUrl("");
      router.refresh();
    } catch {
      setMsg("Помилка");
    } finally {
      setLoading(false);
    }
  }

  async function harvestMore() {
    setLoading(true);
    setMsg("Добираю наступні сторінки…");
    try {
      let totalNew = 0;
      for (let i = 0; i < 5; i++) {
        const data = await fetch("/api/cron/soundcloud?pages=6", { method: "POST" }).then((r) => r.json());
        totalNew += data.harvested ?? 0;
        setMsg(`Зібрано ${totalNew} нових…`);
        if (data.done) break;
      }
      setMsg(`Готово: +${totalNew} артистів`);
      router.refresh();
    } catch {
      setMsg("Помилка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addSeed()}
          placeholder="soundcloud.com/username"
          className="w-56 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
        <button type="button" onClick={addSeed} disabled={loading}
          className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50">
          Спарсити
        </button>
        {seed && (
          <button type="button" onClick={harvestMore} disabled={loading}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-50">
            Добрати @{seed}
          </button>
        )}
      </div>
      {msg && <span className="text-xs text-[var(--text-muted)]">{msg}</span>}
    </div>
  );
}
