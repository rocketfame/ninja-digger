"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonSpinner } from "@/app/components/ButtonSpinner";
import { useToast } from "@/app/components/Toast";

export function BatchRescanButton() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const handleRescan = async () => {
    setLoading(true);
    setProgress(null);
    try {
      const res = await fetch("/api/internal/enrich/rescan-flagged", { method: "POST" });
      const reader = res.body?.getReader();
      if (!reader) {
        const data = await res.json();
        if (data.ok) {
          toast(`Ресканування завершено: ${data.rescanned} артистів`, "success");
        } else {
          toast(data.error ?? "Помилка", "error");
        }
        router.refresh();
        setLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let lastResult = { rescanned: 0, errors: 0 };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === "progress") {
              setProgress({ done: msg.done, total: msg.total });
            } else if (msg.type === "done") {
              lastResult = { rescanned: msg.rescanned, errors: msg.errors };
            }
          } catch { /* skip */ }
        }
      }

      toast(
        `Ресканування завершено: ${lastResult.rescanned} артистів${lastResult.errors > 0 ? `, ${lastResult.errors} помилок` : ""}`,
        lastResult.errors > 0 ? "info" : "success"
      );
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Помилка", "error");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  return (
    <button
      type="button"
      onClick={handleRescan}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-400 transition-colors hover:bg-amber-500/20 cursor-pointer disabled:opacity-50"
    >
      {loading ? (
        <>
          <ButtonSpinner />
          {progress ? `${progress.done}/${progress.total}` : "Ресканування…"}
        </>
      ) : (
        <>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          Ресканувати всіх
        </>
      )}
    </button>
  );
}
