/**
 * Phase 2 (hybrid) — Chart mirror: Beatport (public).
 * Primary source. Implements IngestionSource.
 * Parsing to be added: Top 100 by genre, Hype, Release charts.
 */

import type { ChartEntryInput, IngestionSource } from "@/ingest/types";

export const BeatportSource: IngestionSource = {
  sourceName: "beatport",

  async fetchEntries(date: string): Promise<ChartEntryInput[]> {
    // Stub: no scraping without explicit implementation.
    // TODO: fetch public Beatport chart page/JSON, parse to ChartEntryInput[].
    // Signals: chart_type (top100|hype|release), genre, position, chart_date, artist_name, track_title, label_name.
    void date;
    return [];
  },
};
