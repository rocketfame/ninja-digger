/**
 * RA Events Scraper — fetches events and promoter groups from Resident Advisor GraphQL API.
 * Segments events by weeks until event date (1-6 weeks).
 * Enriches promoter contacts via RA profile → website → email extraction.
 */

import * as cheerio from "cheerio";
import { pool } from "@/lib/db";

const RA_GRAPHQL = "https://ra.co/graphql";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ---- GraphQL Queries ----

const EVENTS_QUERY = `
query GetEvents($filters: FilterInputDtoInput, $pageSize: Int, $page: Int) {
  eventListings(filters: $filters, pageSize: $pageSize, page: $page) {
    data {
      event {
        id
        title
        date
        startTime
        contentUrl
        venue { name area { name country { name } } }
        promoters { id name contentUrl followerCount }
        artists { name }
      }
    }
    totalResults
  }
}`;

// ---- Types ----

export type RAEvent = {
  id: string;
  title: string;
  date: string;
  venue: string;
  city: string;
  country: string;
  raUrl: string;
  promoters: RAPromoter[];
  artists: string[];
};

export type RAPromoter = {
  id: string;
  name: string;
  raUrl: string;
  followerCount: number;
};

export type EventSegment = "1_week" | "2_weeks" | "3_weeks" | "4_weeks" | "5_weeks" | "6_weeks";

// ---- Core Functions ----

/** Fetch events from RA GraphQL API for a date range */
export async function fetchRAEvents(
  startDate: string,
  endDate: string,
  page = 1,
  pageSize = 20,
): Promise<{ events: RAEvent[]; total: number }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(RA_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA,
        Referer: "https://ra.co/events",
      },
      body: JSON.stringify({
        query: EVENTS_QUERY,
        variables: {
          filters: {
            listingDate: { gte: startDate, lte: endDate },
          },
          pageSize,
          page,
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(t);

    if (!res.ok) throw new Error(`RA GraphQL HTTP ${res.status}`);
    const json = await res.json() as {
      data?: {
        eventListings?: {
          data?: Array<{
            event: {
              id: string;
              title: string;
              date: string;
              startTime: string;
              contentUrl: string;
              venue?: { name?: string; area?: { name?: string; country?: { name?: string } } };
              promoters?: Array<{ id: string; name: string; contentUrl: string; followerCount: number }>;
              artists?: Array<{ name: string }>;
            };
          }>;
          totalResults?: number;
        };
      };
    };

    const listings = json.data?.eventListings?.data ?? [];
    const events: RAEvent[] = listings.map((l) => ({
      id: l.event.id,
      title: l.event.title,
      date: l.event.date?.split("T")[0] ?? "",
      venue: l.event.venue?.name ?? "TBA",
      city: l.event.venue?.area?.name ?? "",
      country: l.event.venue?.area?.country?.name ?? "",
      raUrl: `https://ra.co${l.event.contentUrl}`,
      promoters: (l.event.promoters ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        raUrl: `https://ra.co${p.contentUrl}`,
        followerCount: p.followerCount ?? 0,
      })),
      artists: (l.event.artists ?? []).map((a) => a.name),
    }));

    return { events, total: json.data?.eventListings?.totalResults ?? 0 };
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

/** Determine segment based on days until event */
export function getSegment(eventDate: string): EventSegment | null {
  const now = new Date();
  const event = new Date(eventDate);
  const diffDays = Math.ceil((event.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 7) return "1_week";
  if (diffDays <= 14) return "2_weeks";
  if (diffDays <= 21) return "3_weeks";
  if (diffDays <= 28) return "4_weeks";
  if (diffDays <= 35) return "5_weeks";
  if (diffDays <= 42) return "6_weeks";
  return null; // Too far out
}

/** Save events and promoters to DB */
export async function saveEventsAndPromoters(events: RAEvent[]): Promise<{
  eventsAdded: number;
  promotersAdded: number;
}> {
  let eventsAdded = 0;
  let promotersAdded = 0;

  for (const event of events) {
    // Save promoters first
    let promoterId: number | null = null;
    for (const promoter of event.promoters) {
      const r = await pool.query(
        `INSERT INTO ra_promoters (ra_id, name, ra_url, city, region, country, follower_count, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (ra_id) DO UPDATE SET
           name = EXCLUDED.name,
           follower_count = GREATEST(ra_promoters.follower_count, EXCLUDED.follower_count),
           updated_at = now()
         RETURNING id`,
        [promoter.id, promoter.name, promoter.raUrl, event.city, event.city, event.country, promoter.followerCount]
      );
      if (r.rows[0]) {
        promoterId = r.rows[0].id;
        promotersAdded++;
      }
    }

    // Save event
    const segment = getSegment(event.date);
    const r = await pool.query(
      `INSERT INTO ra_events (ra_event_id, name, event_date, venue_name, city, region, country, ra_url, promoter_id, lineup, scraped_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       ON CONFLICT (ra_event_id) DO UPDATE SET
         name = EXCLUDED.name,
         event_date = EXCLUDED.event_date,
         promoter_id = COALESCE(EXCLUDED.promoter_id, ra_events.promoter_id),
         lineup = EXCLUDED.lineup,
         scraped_at = now()
       RETURNING id`,
      [
        event.id,
        event.title,
        event.date,
        event.venue,
        event.city,
        event.city,
        event.country,
        event.raUrl,
        promoterId,
        event.artists.join(", "),
      ]
    );
    if (r.rows[0]) eventsAdded++;

    // Update promoter profile segment
    if (promoterId && segment) {
      await pool.query(
        `INSERT INTO ra_promoter_profiles (promoter_id, segment, status, updated_at)
         VALUES ($1, $2, 'New', now())
         ON CONFLICT (promoter_id) DO UPDATE SET
           segment = CASE
             WHEN ra_promoter_profiles.segment IS NULL THEN $2
             WHEN $2 < ra_promoter_profiles.segment THEN $2  -- closer event = higher priority
             ELSE ra_promoter_profiles.segment
           END,
           updated_at = now()`,
        [promoterId, segment]
      );
    }
  }

  return { eventsAdded, promotersAdded };
}

/** Scrape events for the next 6 weeks and save to DB */
export async function scrapeAndSaveRAEvents(): Promise<{
  eventsAdded: number;
  promotersAdded: number;
  pages: number;
}> {
  const now = new Date();
  const sixWeeksLater = new Date(now.getTime() + 42 * 24 * 60 * 60 * 1000);
  const startDate = now.toISOString().split("T")[0];
  const endDate = sixWeeksLater.toISOString().split("T")[0];

  let totalEvents = 0;
  let totalPromoters = 0;
  let page = 1;
  const maxPages = 20; // Cap at ~400 events

  while (page <= maxPages) {
    const { events, total } = await fetchRAEvents(startDate, endDate, page, 20);
    if (events.length === 0) break;

    const result = await saveEventsAndPromoters(events);
    totalEvents += result.eventsAdded;
    totalPromoters += result.promotersAdded;

    if (page * 20 >= total) break;
    page++;

    // Rate limit: 1-3s between requests
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
  }

  return { eventsAdded: totalEvents, promotersAdded: totalPromoters, pages: page };
}

// ---- Promoter Enrichment ----

/** Extract emails from a promoter's RA profile page and linked websites */
export async function enrichPromoter(promoterId: number): Promise<{
  linksFound: number;
  emailsFound: number;
}> {
  let linksFound = 0;
  let emailsFound = 0;

  // Get promoter info
  const pRes = await pool.query<{ ra_url: string; name: string }>(
    "SELECT ra_url, name FROM ra_promoters WHERE id = $1",
    [promoterId]
  );
  if (!pRes.rows[0]) return { linksFound, emailsFound };

  const { ra_url, name } = pRes.rows[0];

  // 1. Fetch RA profile page
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(ra_url, {
      headers: { "User-Agent": UA },
      signal: controller.signal,
    });
    clearTimeout(t);

    if (res.ok) {
      const html = await res.text();
      const $ = cheerio.load(html);

      // Extract all external links
      const links: Array<{ type: string; url: string }> = [];
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (!href || href.startsWith("/") || href.includes("ra.co")) return;
        try {
          const u = new URL(href.startsWith("http") ? href : `https://${href}`);
          const host = u.hostname.toLowerCase();
          let type = "website";
          if (host.includes("instagram.com")) type = "instagram";
          else if (host.includes("facebook.com")) type = "facebook";
          else if (host.includes("soundcloud.com")) type = "soundcloud";
          else if (host.includes("twitter.com") || host.includes("x.com")) type = "twitter";
          links.push({ type, url: u.href });
        } catch { /* skip */ }
      });

      // Save links as contacts
      for (const link of links) {
        await pool.query(
          `INSERT INTO ra_promoter_contacts (promoter_id, type, value, source_url, confidence)
           VALUES ($1, $2, $3, $4, 0.80)
           ON CONFLICT (promoter_id, type, value) DO NOTHING`,
          [promoterId, link.type, link.url, ra_url]
        );
        linksFound++;
      }

      // Extract emails from HTML
      const emailRegex = /[\w.+-]+@[\w.-]+\.\w{2,}/g;
      const emails = html.match(emailRegex) ?? [];
      for (const email of [...new Set(emails)]) {
        if (email.includes("@sentry") || email.includes("@cloudflare")) continue;
        await pool.query(
          `INSERT INTO ra_promoter_contacts (promoter_id, type, value, source_url, confidence)
           VALUES ($1, 'email', $2, $3, 0.90)
           ON CONFLICT (promoter_id, type, value) DO NOTHING`,
          [promoterId, email.toLowerCase(), ra_url]
        );
        emailsFound++;
      }

      // 2. Follow website links to find emails
      const websiteLinks = links.filter((l) => l.type === "website").slice(0, 2);
      for (const wl of websiteLinks) {
        try {
          const wc = new AbortController();
          const wt = setTimeout(() => wc.abort(), 8000);
          const wres = await fetch(wl.url, {
            headers: { "User-Agent": UA },
            signal: wc.signal,
          });
          clearTimeout(wt);
          if (wres.ok) {
            const whtml = await wres.text();
            const wemails = whtml.match(emailRegex) ?? [];
            for (const email of [...new Set(wemails)]) {
              if (email.includes("@sentry") || email.includes("@cloudflare") || email.includes("@w3.org")) continue;
              await pool.query(
                `INSERT INTO ra_promoter_contacts (promoter_id, type, value, source_url, confidence)
                 VALUES ($1, 'email', $2, $3, 0.80)
                 ON CONFLICT (promoter_id, type, value) DO NOTHING`,
                [promoterId, email.toLowerCase(), wl.url]
              );
              emailsFound++;
            }
          }
        } catch { /* skip failed website fetches */ }
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 1500));
      }
    }
  } catch { /* skip RA fetch errors */ }

  return { linksFound, emailsFound };
}
