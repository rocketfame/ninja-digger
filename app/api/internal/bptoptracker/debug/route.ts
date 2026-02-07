/**
 * GET /api/internal/bptoptracker/debug?genre=afro-house&date=2026-02-05
 * Fetches one chart page and returns diagnostic info (no full HTML) to see why backfill might get 0 rows.
 */

import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getBptoptrackerCookie } from "@/lib/bptoptrackerAuth";
import { looksLikeLoginOrLandingPage } from "@/lib/bptoptrackerBlocklist";

const ORIGIN = "https://www.bptoptracker.com";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get("genre")?.trim() || "afro-house";
    const date = searchParams.get("date")?.trim() || new Date().toISOString().slice(0, 10);
    const url = `${ORIGIN}/top/track/${genre}/${date}`;

    const cookie = await getBptoptrackerCookie();
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml",
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });

    const html = await res.text();
    const loginLike = looksLikeLoginOrLandingPage(html);

    const $ = cheerio.load(html);
    const allTr = $("table tbody tr, .chart-table tbody tr, tbody tr").toArray();
    let validRows = 0;
    let firstRowTexts: string[] = [];
    allTr.forEach((row, i) => {
      const $row = $(row);
      const tds = $row.find("td");
      if (tds.length < 3) return;
      const texts = tds.map((__, td) => $(td).text().trim()).get();
      const rankNum = parseInt(texts[0], 10);
      if (Number.isFinite(rankNum) && rankNum >= 1 && rankNum <= 200 && i === 0) {
        firstRowTexts = texts.slice(0, 5);
      }
      if (Number.isFinite(rankNum) && rankNum >= 1 && rankNum <= 200) validRows++;
    });

    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const hasChartKeyword = /\b(top 100|chart|position|rank)\b/i.test(html);

    // Structure hints: what tables/rows exist so we can adapt the parser
    const tables = $("table").toArray();
    const structureHint = {
      tableCount: tables.length,
      tables: tables.slice(0, 5).map((t, i) => {
        const $t = $(t);
        const theadTr = $t.find("thead tr").length;
        const tbodyTr = $t.find("tbody tr").length;
        const directTr = $t.find("> tr").length;
        const firstTrTds = $t.find("tbody tr").first().find("td").length || $t.find("tr").first().find("td").length;
        const firstTrText = $t.find("tbody tr").first().text().trim().slice(0, 120) || $t.find("tr").first().text().trim().slice(0, 120);
        return { i, theadTr, tbodyTr, directTr, firstTrTds, firstTrText };
      }),
      anyTrWithTds: $("tr").filter((_, el) => $(el).find("td").length >= 3).length,
      sampleSelector: "table tr (no tbody): " + $("table tr").length + ", table tbody tr: " + $("table tbody tr").length,
    };

    // Snippet of first table HTML to see real structure (max 2.5k chars)
    const tableStart = html.indexOf("<table");
    const htmlSnippet =
      tableStart >= 0
        ? html.slice(tableStart, tableStart + 2500).replace(/\s+/g, " ").trim()
        : html.slice(0, 1500).replace(/\s+/g, " ").trim();

    return NextResponse.json({
      url,
      status: res.status,
      htmlLength: html.length,
      title: titleMatch ? titleMatch[1].trim() : null,
      looksLikeLoginOrLanding: loginLike,
      hasChartKeyword,
      tableRowsTotal: allTr.length,
      validRowsWithRank1to200: validRows,
      firstRowPreview: firstRowTexts,
      cookieUsed: !!cookie,
      structureHint,
      htmlSnippet: htmlSnippet.slice(0, 2500),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
