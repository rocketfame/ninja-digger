"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/lib/db";

export type NoteFormState = { error: string | null };

export async function addNote(
  _prev: NoteFormState | null,
  formData: FormData
): Promise<NoteFormState> {
  const artistId = parseInt(String(formData.get("artistId") ?? ""), 10);
  const content = (formData.get("content") as string)?.trim();
  if (Number.isNaN(artistId) || !content) return { error: "Note is empty" };

  try {
    await pool.query(
      "INSERT INTO artist_notes (artist_id, content) VALUES ($1, $2)",
      [artistId, content]
    );
    revalidatePath(`/artist/${artistId}`);
    return { error: null };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Failed to save note",
    };
  }
}
