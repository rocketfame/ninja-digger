"use client";

import { useActionState } from "react";
import { setEnrichmentAction, type EnrichmentFormState } from "./actions";
import type { EnrichmentRow } from "@/enrich/bio";

export function EnrichmentForm({
  artistId,
  initial,
}: {
  artistId: number;
  initial: EnrichmentRow | null;
}) {
  const [state, formAction] = useActionState<EnrichmentFormState | null, FormData>(
    setEnrichmentAction,
    null
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="artistId" value={artistId} />
      <label className="text-xs text-stone-500">
        Bio summary
        <textarea
          name="bio_summary"
          rows={2}
          defaultValue={initial?.bio_summary ?? ""}
          placeholder="Short bio or summary"
          className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
        />
      </label>
      <label className="text-xs text-stone-500">
        Role
        <input
          type="text"
          name="role"
          defaultValue={initial?.role ?? ""}
          placeholder="e.g. artist, DJ, label"
          className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
        />
      </label>
      <label className="text-xs text-stone-500">
        Insight
        <input
          type="text"
          name="insight"
          defaultValue={initial?.insight ?? ""}
          placeholder="Short contextual note"
          className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
        />
      </label>
      <button
        type="submit"
        className="w-fit rounded bg-stone-700 px-3 py-1.5 text-sm text-white hover:bg-stone-600"
      >
        Save enrichment
      </button>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
