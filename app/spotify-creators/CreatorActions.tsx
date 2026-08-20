"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreatorActions({ username, status }: { username: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState(status);

  async function set(next: string) {
    setBusy(true);
    await fetch("/api/spotify/creators/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, status: next }),
    }).catch(() => {});
    setLocal(next);
    setBusy(false);
    router.refresh();
  }

  if (local === "approved") return <span className="rounded-md bg-[var(--accent)]/15 px-2.5 py-1 text-xs font-semibold text-[var(--accent)]">✓ Схвалено</span>;
  if (local === "parsed") return <span className="rounded-md bg-[#60a5fa]/15 px-2.5 py-1 text-xs font-semibold text-[#60a5fa]">спарсено</span>;
  if (local === "skipped") return <button onClick={() => set("candidate")} disabled={busy} className="text-xs text-[var(--text-muted)] underline hover:text-[var(--text)]">повернути</button>;

  return (
    <div className="flex items-center gap-1.5">
      <button onClick={() => set("approved")} disabled={busy}
        className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50">
        Схвалити
      </button>
      <button onClick={() => set("skipped")} disabled={busy}
        className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text)] disabled:opacity-50">
        Пропустити
      </button>
    </div>
  );
}
