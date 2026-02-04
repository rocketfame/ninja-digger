"use client";

import { useActionState } from "react";
import { addNote, type NoteFormState } from "./actions";

export function AddNoteForm({ artistId }: { artistId: number }) {
  const [state, formAction] = useActionState<NoteFormState | null, FormData>(
    addNote,
    null
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="artistId" value={artistId} />
      <textarea
        name="content"
        rows={3}
        placeholder="Add a note…"
        className="w-full rounded border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
      />
      <button
        type="submit"
        className="w-fit rounded bg-stone-800 px-3 py-1.5 text-sm text-white hover:bg-stone-700"
      >
        Save note
      </button>
      {state?.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
    </form>
  );
}
