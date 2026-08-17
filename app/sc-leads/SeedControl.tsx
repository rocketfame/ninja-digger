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
      setMsg(`✅ @${data.permalink}: +${data.harvested} артистів (фоловерів у джерела: ${data.followers?.toLocaleString("uk-UA")})`);
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
    setMsg("Добираю наступні сторінки фоловерів…");
    try {
      let totalNew = 0;
      for (let i = 0; i < 5; i++) {
        const data = await fetch("/api/cron/soundcloud?pages=6", { method: "POST" }).then((r) => r.json());
        totalNew += data.harvested ?? 0;
        setMsg(`Зібрано ${totalNew} нових…`);
        if (data.done) break;
      }
      setMsg(`✅ Готово: +${totalNew} артистів`);
      router.refresh();
    } catch {
      setMsg("Помилка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
      <h2 className="text-sm font-semibold">Додати джерело</h2>
      <p className="mt-0.5 mb-3 text-xs text-[var(--text-muted)]">
        Встав будь-який SoundCloud-профіль (промо-канал, лейбл) — зберемо його фоловерів як лідів.
      </p>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M1.175 12.225c-.051 0-.094.046-.101.1l-.233 2.154.233 2.105c.007.058.05.098.101.098.05 0 .09-.04.099-.098l.255-2.105-.27-2.154c0-.057-.045-.1-.09-.1m-.899.828c-.06 0-.091.037-.104.094L0 14.479l.165 1.308c.008.045.046.089.09.089s.089-.044.104-.089l.21-1.308-.21-1.334c-.015-.06-.045-.092-.09-.092m1.83-1.229c-.061 0-.12.05-.12.11l-.21 2.563.225 2.458c0 .075.06.135.12.135s.119-.06.13-.135l.256-2.458-.256-2.563c-.011-.06-.07-.11-.13-.11m.945-.089c-.075 0-.135.06-.15.135l-.193 2.64.21 2.544c.016.077.075.138.149.138.075 0 .135-.061.15-.15l.24-2.532-.24-2.623c-.015-.09-.075-.153-.166-.153m1.155.36c-.005-.09-.075-.166-.166-.166-.09 0-.164.076-.164.166l-.181 2.31.18 2.563c0 .09.075.164.165.164.089 0 .164-.074.18-.164l.209-2.563-.21-2.31m.914-.72c-.104 0-.194.09-.194.196l-.166 2.835.18 2.564c0 .12.09.209.195.209.104 0 .194-.089.21-.209l.196-2.564-.196-2.835c-.016-.12-.09-.196-.21-.196m1.155-.135c-.12 0-.209.104-.225.225l-.15 2.955.165 2.579c.016.135.105.239.24.239.12 0 .225-.104.225-.24l.18-2.578-.18-2.955c0-.121-.105-.226-.24-.226m1.245.166c-.135 0-.255.12-.255.271l-.135 2.789.15 2.578c0 .152.104.271.255.271.135 0 .255-.12.255-.271l.164-2.578-.164-2.789c0-.151-.12-.271-.271-.271m1.005-1.14c-.164 0-.284.135-.284.3l-.135 3.63.15 2.564c0 .164.12.299.285.299.164 0 .285-.135.285-.3l.164-2.563-.164-3.63c-.016-.164-.135-.3-.3-.3m1.396.09c-.18 0-.313.15-.313.33l-.104 3.51.12 2.549c.016.181.15.315.315.315.18 0 .313-.135.313-.316l.135-2.548-.135-3.51c0-.181-.15-.33-.331-.33m1.483-.855c-.06-.045-.135-.075-.21-.075s-.15.03-.21.075c-.104.06-.164.164-.164.284v.045l-.104 4.185.104 2.534c.016.075.045.15.104.194.06.061.135.09.21.09.075 0 .15-.029.21-.09.06-.045.104-.12.104-.209l.12-2.519-.12-4.216c0-.12-.06-.224-.164-.284m1.005-.36c-.194 0-.36.164-.36.375l-.075 4.605.09 2.489c0 .209.164.375.375.375.194 0 .36-.166.36-.375l.104-2.489-.104-4.605c-.016-.211-.166-.375-.375-.375m1.905 2.475c-.045-.03-.104-.045-.164-.045s-.12.015-.166.045c-.089.06-.149.164-.149.284v.03l-.09 2.129.09 2.489c.015.075.045.15.104.209.06.045.135.075.21.075s.135-.03.194-.075c.061-.06.104-.135.104-.224l.104-2.474-.104-2.146c0-.104-.045-.194-.135-.256m-.856-2.096c-.209 0-.404.181-.404.406l-.06 4.245.075 2.474c0 .225.18.404.404.404.209 0 .404-.18.404-.404l.075-2.474-.075-4.246c0-.224-.195-.404-.404-.404m9.15 1.665c-.375 0-.734.06-1.064.164-.226-2.474-2.294-4.41-4.83-4.41-.629 0-1.229.135-1.769.36-.21.09-.27.18-.27.36v9.301c0 .18.135.33.315.345h7.618c1.514 0 2.744-1.216 2.744-2.729 0-1.514-1.23-2.744-2.744-2.744" />
          </svg>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSeed()}
            placeholder="soundcloud.com/username"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-page)] py-2.5 pl-10 pr-3 text-sm outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30"
          />
        </div>
        <button type="button" onClick={addSeed} disabled={loading || !url.trim()}
          className="shrink-0 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40">
          {loading ? "…" : "Спарсити"}
        </button>
      </div>
      {seed && (
        <button type="button" onClick={harvestMore} disabled={loading}
          className="mt-2 text-xs text-[var(--text-muted)] underline transition-colors hover:text-[var(--text)] disabled:opacity-50">
          або добрати ще фоловерів @{seed}
        </button>
      )}
      {msg && <div className="mt-2 text-xs text-[var(--text-muted)]">{msg}</div>}
    </div>
  );
}
