/**
 * POST /api/internal/enrich/rescan-flagged
 * Batch rescan all artists that have flagged links or contacts.
 * Streams progress as newline-delimited JSON.
 */

import { pool } from "@/lib/db";
import { runEnrichmentForArtist } from "@/lib/enrichV1";

export async function POST() {
  const flaggedArtists = await pool.query<{ aid: string }>(
    `SELECT DISTINCT x.aid FROM (
       SELECT artist_beatport_id AS aid FROM artist_links WHERE status = 'flagged'
       UNION
       SELECT artist_beatport_id AS aid FROM artist_contacts WHERE status = 'flagged'
     ) x ORDER BY x.aid`
  );

  const artistIds = flaggedArtists.rows.map(r => r.aid);
  const total = artistIds.length;

  if (total === 0) {
    return Response.json({ ok: true, rescanned: 0, errors: 0 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let rescanned = 0;
      let errors = 0;

      for (let i = 0; i < artistIds.length; i++) {
        const artistId = artistIds[i];
        try {
          const flaggedLinks = await pool.query<{ url: string }>(
            `SELECT url FROM artist_links WHERE artist_beatport_id = $1 AND status = 'flagged'`,
            [artistId]
          );
          const flaggedContacts = await pool.query<{ source_url: string | null }>(
            `SELECT source_url FROM artist_contacts WHERE artist_beatport_id = $1 AND status = 'flagged'`,
            [artistId]
          );

          const urlsToInvalidate = new Set<string>();
          for (const r of flaggedLinks.rows) if (r.url) urlsToInvalidate.add(r.url);
          for (const r of flaggedContacts.rows) if (r.source_url) urlsToInvalidate.add(r.source_url);

          await pool.query(
            `DELETE FROM artist_links WHERE artist_beatport_id = $1 AND status = 'flagged'`,
            [artistId]
          );
          await pool.query(
            `DELETE FROM artist_contacts WHERE artist_beatport_id = $1 AND status = 'flagged'`,
            [artistId]
          );

          if (urlsToInvalidate.size > 0) {
            await pool.query(
              `DELETE FROM url_cache WHERE url = ANY($1::text[])`,
              [[...urlsToInvalidate]]
            );
          }

          await runEnrichmentForArtist(artistId);
          rescanned++;
        } catch {
          errors++;
        }

        controller.enqueue(
          encoder.encode(JSON.stringify({ type: "progress", done: i + 1, total, rescanned, errors }) + "\n")
        );
      }

      controller.enqueue(
        encoder.encode(JSON.stringify({ type: "done", rescanned, errors, total }) + "\n")
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
    },
  });
}
