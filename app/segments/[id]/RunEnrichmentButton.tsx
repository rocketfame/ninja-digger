"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

export function RunEnrichmentButton({ segmentId }: { segmentId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/internal/enrich/segment?segmentId=${encodeURIComponent(segmentId)}`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.ok) {
        setMessage(`Processed ${data.processed ?? 0} artists. Links: ${data.linksAdded ?? 0}, contacts: ${data.contactsAdded ?? 0}.`);
        router.refresh();
      } else {
        setMessage(data.error ?? "Failed");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [segmentId, router]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50 disabled:opacity-50"
      >
        {loading ? "Running…" : "Run Enrichment"}
      </button>
      {message && <span className="text-sm text-stone-600">{message}</span>}
    </div>
  );
}
