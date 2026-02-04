"use server";

import { revalidatePath } from "next/cache";
import { setEnrichment } from "@/enrich/bio";
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

export type EnrichmentFormState = { error: string | null };

export async function setEnrichmentAction(
  _prev: EnrichmentFormState | null,
  formData: FormData
): Promise<EnrichmentFormState> {
  const artistId = parseInt(String(formData.get("artistId") ?? ""), 10);
  if (Number.isNaN(artistId)) return { error: "Invalid artist" };

  try {
    await setEnrichment(artistId, {
      bio_summary: (formData.get("bio_summary") as string)?.trim() || null,
      role: (formData.get("role") as string)?.trim() || null,
      insight: (formData.get("insight") as string)?.trim() || null,
    });
    revalidatePath(`/artist/${artistId}`);
    return { error: null };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Failed to save enrichment",
    };
  }
}
