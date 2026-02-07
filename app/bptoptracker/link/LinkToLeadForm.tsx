"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { ButtonSpinner } from "@/app/components/ButtonSpinner";
import { playSuccessSound } from "@/lib/successSound";

type LeadOption = { artist_beatport_id: string; artist_name: string | null };

export function LinkToLeadForm({
  artistName,
  leads,
}: {
  artistName: string;
  leads: LeadOption[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/internal/bptoptracker/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artist_name: artistName,
          artist_beatport_id: selectedId,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        playSuccessSound();
        router.push("/bptoptracker");
        router.refresh();
      } else {
        setError(data.error ?? "Помилка");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Помилка запиту");
    } finally {
      setLoading(false);
    }
  }, [artistName, selectedId, router]);

  const [search, setSearch] = useState("");
  const filtered = search.trim()
    ? leads.filter(
        (l) =>
          (l.artist_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
          l.artist_beatport_id.includes(search)
      )
    : leads;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-stone-700 mb-1">Пошук ліда (імʼя або Beatport ID)</label>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Введіть імʼя або ID..."
          className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-stone-700 mb-1">Обрати лід</label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
        >
          <option value="">— оберіть —</option>
          {filtered.map((l) => (
            <option key={l.artist_beatport_id} value={l.artist_beatport_id}>
              {(l.artist_name ?? l.artist_beatport_id)} ({l.artist_beatport_id})
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={loading || !selectedId}
          className="inline-flex items-center justify-center gap-2 rounded bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {loading && <ButtonSpinner />}
          {loading ? "Зберігаю… (до 5 с)" : "Зберегти привʼязку"}
        </button>
        <Link
          href="/bptoptracker"
          className="rounded border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
        >
          Скасувати
        </Link>
      </div>
    </div>
  );
}
