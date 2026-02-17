import { query, pool } from "@/lib/db";
import { notFound } from "next/navigation";
import { NavBar } from "@/app/components/NavBar";
import { ArtistLeadCard } from "./bp/[id]/ArtistLeadCard";
import {
  fetchBeatportArtistInfo,
  isNumericBeatportId,
  resolveBeatportArtistUrl,
} from "@/lib/beatportArtist";
import {
  getBptoptrackerArtistUrl,
  parseNumericIdFromBptoptrackerUrl,
  resolveBptoptrackerArtistUrl,
  slugifyArtistName,
} from "@/lib/bptoptrackerUrl";

/** Відомі Beatport artist ID (slug → id), коли BPTT/Beatport resolve не спрацьовує (server-side 404). Доповнювати вручну. */
const KNOWN_BEATPORT_ARTIST_IDS: Record<string, string> = {
  "sub-zero-project": "351802",
};

type ArtistV2 = {
  artist_beatport_id: string;
  artist_name: string | null;
  artist_slug: string | null;
  first_seen: string | null;
  last_seen: string | null;
  total_days_in_charts: number | null;
  total_chart_entries: number | null;
  avg_position: string | null;
  best_position: number | null;
  genres: string[] | null;
  segment: string | null;
  score: string | null;
  signals: Record<string, unknown> | null;
};

export const dynamic = "force-dynamic";

/** Сторінка артиста Beatport/BP Top Tracker: id = slug (sub-zero-project) або числовий beatport id. */
export async function ArtistBPContent({ id: rawId }: { id: string }) {
  if (!rawId) notFound();

  const id =
    /^\d+$/.test(rawId) || rawId.startsWith("bptoptracker:")
      ? rawId
      : `bptoptracker:${rawId}`;

  /** Phase 1: display links in strategy priority order (Beatport/BPTT rendered first in card). */
  const LINK_DISPLAY_ORDER = ["linktree", "resident_advisor", "soundcloud", "bandcamp", "mixcloud", "reverbnation", "instagram", "facebook", "twitter", "website"];

  let artist: ArtistV2 | null = null;
  let profile: { status: string; notes: string | null } | null = null;
  let links: { type: string; url: string }[] = [];
  let contacts: { type: string; value: string; source_url?: string | null; confidence?: number }[] = [];
  try {
    const rows = await query<ArtistV2>(
      `SELECT am.artist_beatport_id, am.artist_name,
              (SELECT ce.artist_slug FROM chart_entries ce WHERE ce.artist_beatport_id = am.artist_beatport_id AND ce.artist_slug IS NOT NULL AND ce.artist_slug <> '' ORDER BY ce.snapshot_date DESC LIMIT 1) AS artist_slug,
              am.first_seen::text, am.last_seen::text,
              am.total_days_in_charts, am.total_chart_entries, am.avg_position::text, am.best_position,
              am.genres, ls.segment, ls.score::text, ls.signals
       FROM artist_metrics am
       LEFT JOIN lead_scores ls ON ls.artist_beatport_id = am.artist_beatport_id
       WHERE am.artist_beatport_id = $1`,
      [id]
    );
    artist = rows[0] ?? null;
    if (artist) {
      const profRows = await query<{ status: string; notes: string | null }>(
        `SELECT status, notes FROM lead_profiles WHERE artist_beatport_id = $1`,
        [id]
      );
      profile = profRows[0] ?? null;
      const linkRows = await query<{ type: string; url: string }>(
        `SELECT type, url FROM artist_links WHERE artist_beatport_id = $1`,
        [id]
      );
      links = linkRows.sort(
        (a, b) => LINK_DISPLAY_ORDER.indexOf(a.type) - LINK_DISPLAY_ORDER.indexOf(b.type) || a.type.localeCompare(b.type)
      );
      const contactRows = await query<{ type: string; value: string; source_url: string | null; confidence: number }>(
        `SELECT type, value, source_url, COALESCE(confidence, 0) AS confidence FROM artist_contacts WHERE artist_beatport_id = $1`,
        [id]
      );
      contacts = contactRows.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    }
  } catch {
    artist = null;
  }

  if (!artist) {
    const syntheticMatch = id.match(/^bptoptracker:(.+)$/);
    if (syntheticMatch) {
      const slugFromUrl = syntheticMatch[1];
      const normalizedSlug = slugFromUrl.replace(/-+/g, "-").replace(/^-|-$/g, "");
      const idsToTry = [id];
      if (normalizedSlug !== slugFromUrl) idsToTry.push(`bptoptracker:${normalizedSlug}`);

      let row: {
        artist_beatport_id: string;
        artist_name: string;
        first_seen: string;
        last_seen: string;
        total_chart_entries: string;
        avg_position: string;
        best_position: string;
        genres: string[];
      } | null = null;
      for (const tryId of idsToTry) {
        const fromChart = await query<{
          artist_beatport_id: string;
          artist_name: string;
          first_seen: string;
          last_seen: string;
          total_chart_entries: string;
          avg_position: string;
          best_position: string;
          genres: string[];
        }>(
          `SELECT ce.artist_beatport_id,
                  MAX(ce.artist_name) AS artist_name,
                  MIN(ce.snapshot_date)::text AS first_seen,
                  MAX(ce.snapshot_date)::text AS last_seen,
                  COUNT(*)::text AS total_chart_entries,
                  AVG(ce.position)::numeric(10,2)::text AS avg_position,
                  MIN(ce.position)::text AS best_position,
                  ARRAY_AGG(DISTINCT cc.genre_slug) FILTER (WHERE cc.genre_slug IS NOT NULL) AS genres
           FROM chart_entries ce
           JOIN charts_catalog cc ON cc.id = ce.chart_id
           WHERE ce.artist_beatport_id = $1
           GROUP BY ce.artist_beatport_id`,
          [tryId]
        );
        row = fromChart[0] ?? null;
        if (row) break;
      }

      if (row) {
        const resolvedId = row.artist_beatport_id;
        artist = {
          artist_beatport_id: resolvedId,
          artist_name: row.artist_name,
          artist_slug: null,
          first_seen: row.first_seen,
          last_seen: row.last_seen,
          total_days_in_charts: null,
          total_chart_entries: Number(row.total_chart_entries) || null,
          avg_position: row.avg_position,
          best_position: Number(row.best_position) || null,
          genres: Array.isArray(row.genres) ? row.genres.filter(Boolean) : null,
          segment: null,
          score: null,
          signals: null,
        };
        const [profRows, linkRows, contactRows] = await Promise.all([
          query<{ status: string; notes: string | null }>(`SELECT status, notes FROM lead_profiles WHERE artist_beatport_id = $1`, [resolvedId]),
          query<{ type: string; url: string }>(`SELECT type, url FROM artist_links WHERE artist_beatport_id = $1`, [resolvedId]),
          query<{ type: string; value: string; source_url: string | null; confidence: number }>(
            `SELECT type, value, source_url, COALESCE(confidence, 0) AS confidence FROM artist_contacts WHERE artist_beatport_id = $1`,
            [resolvedId]
          ),
        ]);
        profile = profRows[0] ?? null;
        links = linkRows.sort(
          (a, b) => LINK_DISPLAY_ORDER.indexOf(a.type) - LINK_DISPLAY_ORDER.indexOf(b.type) || a.type.localeCompare(b.type)
        );
        contacts = contactRows.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
      }
    }
    if (!artist) notFound();
  }

  type GenreStat = {
    genre_slug: string;
    entries: number;
    best_position: number;
    avg_position: string;
    first_seen: string;
    last_seen: string;
    momentum_7d: string | null;
  };
  let genreStats: GenreStat[] = [];
  try {
    const refDate = await query<{ max_date: string }>(
      `SELECT MAX(snapshot_date)::text AS max_date FROM chart_entries WHERE artist_beatport_id = $1`,
      [artist.artist_beatport_id]
    ).then((r) => r[0]?.max_date ?? null);
    const rows = await query<{
      genre_slug: string;
      entries: string;
      best_position: string;
      avg_position: string;
      first_seen: string;
      last_seen: string;
      momentum_7d: string | null;
    }>(
      `WITH ref AS (SELECT COALESCE($2::date, CURRENT_DATE) AS ref_date),
       ce AS (
         SELECT ce.snapshot_date, ce.position, cc.genre_slug
         FROM chart_entries ce
         JOIN charts_catalog cc ON cc.id = ce.chart_id
         WHERE ce.artist_beatport_id = $1 AND cc.genre_slug IS NOT NULL
       )
       SELECT
         ce.genre_slug,
         COUNT(*)::text AS entries,
         MIN(ce.position)::text AS best_position,
         AVG(ce.position)::numeric(10,2)::text AS avg_position,
         MIN(ce.snapshot_date)::text AS first_seen,
         MAX(ce.snapshot_date)::text AS last_seen,
         (AVG(ce.position) FILTER (WHERE ce.snapshot_date >= (SELECT ref_date - 7 FROM ref) AND ce.snapshot_date <= (SELECT ref_date FROM ref))
          - AVG(ce.position) FILTER (WHERE ce.snapshot_date >= (SELECT ref_date - 14 FROM ref) AND ce.snapshot_date < (SELECT ref_date - 7 FROM ref)))::numeric(10,2)::text AS momentum_7d
       FROM ce
       GROUP BY ce.genre_slug
       ORDER BY COUNT(*) DESC, AVG(ce.position) ASC`,
      [artist.artist_beatport_id, refDate]
    );
    genreStats = rows.map((r) => ({
      genre_slug: r.genre_slug,
      entries: Number(r.entries) || 0,
      best_position: Number(r.best_position) || 0,
      avg_position: r.avg_position,
      first_seen: r.first_seen,
      last_seen: r.last_seen,
      momentum_7d: r.momentum_7d,
    }));
  } catch {
    // ignore
  }

  let artistChartTypes: string[] = [];
  try {
    const ctRows = await query<{ chart_type: string }>(
      `SELECT DISTINCT cc.chart_type FROM chart_entries ce JOIN charts_catalog cc ON cc.id = ce.chart_id WHERE ce.artist_beatport_id = $1 AND cc.chart_type IS NOT NULL`,
      [artist.artist_beatport_id]
    );
    artistChartTypes = ctRows.map((r) => r.chart_type);
  } catch { /* ignore */ }

  let displayName = artist.artist_name ?? artist.artist_beatport_id;
  const isSynthetic = !isNumericBeatportId(artist.artist_beatport_id);
  const bptoptrackerSlug = isSynthetic && artist.artist_beatport_id.startsWith("bptoptracker:")
    ? artist.artist_beatport_id.replace(/^bptoptracker:/, "")
    : null;

  const BEATPORT_ORIGIN = "https://www.beatport.com";
  const BPTOTRACKER_ORIGIN = "https://www.bptoptracker.com";

  let beatportUrl: string | null = null;
  let bptoptrackerUrl: string | null = null;
  let imageUrl: string | null = null;

  let storedPath: string | null = null;
  const nameForPath = (displayName ?? "").trim();
  const tryPath = (p: string | null | undefined): boolean => {
    if (!p || typeof p !== "string") return false;
    const s = p.trim();
    if (!s.startsWith("/") || !/\/artist\/[^/]+\/\d+/.test(s)) return false;
    storedPath = s;
    return true;
  };
  try {
    const fromChart = await query<{ artist_link_path: string }>(
      `SELECT artist_link_path FROM chart_entries
       WHERE artist_link_path IS NOT NULL AND artist_link_path <> ''
         AND (artist_beatport_id = $1 OR (artist_name IS NOT NULL AND LOWER(TRIM(artist_name)) = LOWER(TRIM($2))))
       ORDER BY snapshot_date DESC LIMIT 1`,
      [artist.artist_beatport_id, nameForPath]
    );
    tryPath(fromChart[0]?.artist_link_path);
  } catch {
    // ignore
  }
  if (!storedPath && nameForPath) {
    try {
      const fromDaily = await query<{ artist_link_path: string }>(
        `SELECT artist_link_path FROM bptoptracker_daily
         WHERE artist_link_path IS NOT NULL AND artist_link_path <> ''
           AND artist_name IS NOT NULL AND LOWER(TRIM(artist_name)) = LOWER(TRIM($1))
         ORDER BY snapshot_date DESC LIMIT 1`,
        [nameForPath]
      );
      tryPath(fromDaily[0]?.artist_link_path);
    } catch {
      // ignore
    }
  }

  if (storedPath) {
    beatportUrl = BEATPORT_ORIGIN + storedPath;
    bptoptrackerUrl = BPTOTRACKER_ORIGIN + storedPath;
  } else if (isNumericBeatportId(artist.artist_beatport_id)) {
    const beatportInfo = await fetchBeatportArtistInfo(
      artist.artist_beatport_id,
      artist.artist_slug
    );
    if (beatportInfo) {
      beatportUrl = beatportInfo.url;
      displayName = beatportInfo.name;
      imageUrl = beatportInfo.imageUrl;
      if (beatportInfo.name && beatportInfo.name !== (artist.artist_name ?? "")) {
        try {
          await pool.query(
            `UPDATE artist_metrics SET artist_name = $1 WHERE artist_beatport_id = $2`,
            [beatportInfo.name, artist.artist_beatport_id]
          );
        } catch {
          // ignore
        }
      }
    } else {
      beatportUrl = `${BEATPORT_ORIGIN}/artist/${(artist.artist_slug || "artist").replace(/^\/+|\/+$/g, "")}/${artist.artist_beatport_id}`;
    }
    const slug = artist.artist_slug ?? (displayName ? slugifyArtistName(displayName) : null);
    bptoptrackerUrl = getBptoptrackerArtistUrl(slug, artist.artist_beatport_id);
  } else {
    const slugForUrl = bptoptrackerSlug ?? slugifyArtistName(displayName);
    let numericId: string | null = null;
    const nameForLookup = (displayName ?? "").trim();
    if (nameForLookup) {
      try {
        const fromMetrics = await query<{ artist_beatport_id: string }>(
          `SELECT artist_beatport_id FROM artist_metrics
           WHERE artist_beatport_id ~ '^\\d+$' AND LOWER(TRIM(artist_name)) = LOWER(TRIM($1)) LIMIT 1`,
          [nameForLookup]
        );
        if (fromMetrics[0]) numericId = fromMetrics[0].artist_beatport_id;
        if (!numericId) {
          const fromChart = await query<{ artist_beatport_id: string }>(
            `SELECT artist_beatport_id FROM chart_entries
             WHERE artist_beatport_id ~ '^\\d+$' AND artist_name IS NOT NULL AND LOWER(TRIM(artist_name)) = LOWER(TRIM($1)) LIMIT 1`,
            [nameForLookup]
          );
          if (fromChart[0]) numericId = fromChart[0].artist_beatport_id;
        }
        if (!numericId) {
          const fromLinks = await query<{ artist_beatport_id: string }>(
            `SELECT artist_beatport_id FROM bptoptracker_artist_links
             WHERE artist_beatport_id ~ '^\\d+$' AND LOWER(TRIM(artist_name)) = LOWER(TRIM($1)) LIMIT 1`,
            [nameForLookup]
          );
          if (fromLinks[0]) numericId = fromLinks[0].artist_beatport_id;
        }
      } catch {
        // ignore
      }
    }
    if (!numericId && bptoptrackerSlug) {
      const resolved = await resolveBptoptrackerArtistUrl(bptoptrackerSlug);
      if (resolved) {
        numericId = parseNumericIdFromBptoptrackerUrl(resolved);
        bptoptrackerUrl = resolved;
      }
      if (!numericId && slugForUrl) {
        const beatportResolved = await resolveBeatportArtistUrl(slugForUrl);
        if (beatportResolved) {
          numericId = beatportResolved.numericId;
          beatportUrl = beatportResolved.url;
          bptoptrackerUrl = getBptoptrackerArtistUrl(slugForUrl, beatportResolved.numericId);
        }
        if (!numericId && slugForUrl) {
          const knownId = KNOWN_BEATPORT_ARTIST_IDS[slugForUrl];
          if (knownId) {
            numericId = knownId;
            beatportUrl = `${BEATPORT_ORIGIN}/artist/${encodeURIComponent(slugForUrl)}/${knownId}`;
            bptoptrackerUrl = getBptoptrackerArtistUrl(slugForUrl, knownId);
          }
        }
      }
    }
    if (numericId && slugForUrl) {
      beatportUrl = `${BEATPORT_ORIGIN}/artist/${encodeURIComponent(slugForUrl)}/${numericId}`;
      if (!bptoptrackerUrl) bptoptrackerUrl = getBptoptrackerArtistUrl(slugForUrl, numericId);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]">
      <NavBar />

      <main className="mx-auto max-w-2xl px-4 py-6">
        <ArtistLeadCard
          artist={{ ...artist, artist_name: displayName }}
          beatportUrl={beatportUrl}
          bptoptrackerUrl={bptoptrackerUrl}
          imageUrl={imageUrl}
          initialProfile={profile}
          links={links}
          contacts={contacts}
          genreStats={genreStats}
          chartTypes={artistChartTypes}
        />
      </main>
    </div>
  );
}
