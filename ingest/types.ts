/**
 * Unified ingestion interface. Any new data source must implement IngestionSource.
 * No source is allowed to write directly to DB.
 */

export interface ChartEntryInput {
  source: string;
  chartType: string;
  genre: string | null;
  position: number | null;
  chartDate: string;
  artistName: string;
  trackTitle: string;
  labelName?: string | null;
  externalIds?: {
    beatportId?: string;
    tracklistsId?: string;
  };
}

export interface IngestionSource {
  sourceName: string;
  fetchEntries(date: string): Promise<ChartEntryInput[]>;
}

export interface IngestResult {
  sourceId: number;
  sourceName: string;
  chartDate: string;
  fetched: number;
  inserted: number;
  skipped: number;
}
