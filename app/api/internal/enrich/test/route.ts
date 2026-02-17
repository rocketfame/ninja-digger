/**
 * GET /api/internal/enrich/test?artistId=117859
 * Запускає discoverLinks для артиста з логуванням; не зберігає в БД (dry run).
 * Результат: logs, links, contacts, artistName, artistSlug для аналізу.
 */

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { discoverLinks } from "@/lib/enrichV1";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const artistId = searchParams.get("artistId") ?? "117859";

  const logs: string[] = [];
  const log = (msg: string) => {
    const line = `[${new Date().toISOString().slice(11, 23)}] ${msg}`;
    logs.push(line);
  };

  let artistName = "";
  let artistSlug: string | null = null;

  try {
    log(`artistId=${artistId}`);
    const rows = await query<{ artist_name: string | null; artist_slug: string | null }>(
      `SELECT am.artist_name,
              (SELECT ce.artist_slug FROM chart_entries ce WHERE ce.artist_beatport_id = am.artist_beatport_id AND ce.artist_slug IS NOT NULL LIMIT 1) AS artist_slug
       FROM artist_metrics am WHERE am.artist_beatport_id = $1`,
      [artistId]
    );
    const r = rows[0];
    artistName = r?.artist_name ?? "";
    artistSlug = r?.artist_slug ?? null;
    if (!artistName && !artistSlug) {
      const ceRows = await query<{ artist_name: string; artist_slug: string | null }>(
        `SELECT artist_name, artist_slug FROM chart_entries WHERE artist_beatport_id = $1 LIMIT 1`,
        [artistId]
      );
      artistName = ceRows[0]?.artist_name ?? "";
      artistSlug = ceRows[0]?.artist_slug ?? null;
    }
    log(`artistName="${artistName}" artistSlug=${artistSlug ?? "null"}`);

    const { links, contacts } = await discoverLinks(artistName, artistSlug, log);

    return NextResponse.json({
      ok: true,
      artistId,
      artistName,
      artistSlug,
      linksCount: links.length,
      contactsCount: contacts.length,
      links: links.map((l) => ({ type: l.type, url: l.url, source: l.source })),
      contacts: contacts.map((c) => ({ type: c.type, value: c.value, source_url: c.source_url })),
      logs,
    });
  } catch (e) {
    log(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json(
      {
        ok: false,
        artistId,
        artistName,
        artistSlug,
        error: e instanceof Error ? e.message : String(e),
        logs,
      },
      { status: 500 }
    );
  }
}
