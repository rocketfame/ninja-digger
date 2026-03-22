/**
 * RA Events Scraper — fetches events and promoter groups from Resident Advisor GraphQL API.
 * Segments events by weeks until event date (1-6 weeks).
 * Enriches promoter contacts via GraphQL API fields + website email extraction.
 */

import * as cheerio from "cheerio";
import { pool } from "@/lib/db";

const RA_GRAPHQL = "https://ra.co/graphql";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ---- GraphQL Queries ----

/** Event listings with full promoter contact fields */
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
        promoters { id name contentUrl followerCount website facebook instagram twitter email }
        artists { name }
      }
    }
    totalResults
  }
}`;

/** Single promoter query for enrichment */
const PROMOTER_QUERY = `
query GetPromoter($id: ID!) {
  promoter(id: $id) {
    id name website facebook instagram twitter email followerCount
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
  website?: string | null;
  facebook?: string | null;
  instagram?: string | null;
  twitter?: string | null;
  email?: string | null;
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
              promoters?: Array<{
                id: string; name: string; contentUrl: string; followerCount: number;
                website?: string | null; facebook?: string | null; instagram?: string | null;
                twitter?: string | null; email?: string | null;
              }>;
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
        website: p.website || null,
        facebook: p.facebook || null,
        instagram: p.instagram || null,
        twitter: p.twitter || null,
        email: p.email || null,
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
  return null;
}

/** Save events and promoters to DB, including contact info from GraphQL */
export async function saveEventsAndPromoters(events: RAEvent[]): Promise<{
  eventsAdded: number;
  promotersAdded: number;
  contactsAdded: number;
}> {
  let eventsAdded = 0;
  let promotersAdded = 0;
  let contactsAdded = 0;

  for (const event of events) {
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

      // Save contacts from GraphQL directly (website, social, email)
      if (promoterId) {
        const contacts: Array<{ type: string; value: string; confidence: number }> = [];
        if (promoter.website) contacts.push({ type: "website", value: promoter.website, confidence: 0.95 });
        if (promoter.facebook) contacts.push({ type: "facebook", value: promoter.facebook.startsWith("http") ? promoter.facebook : `https://facebook.com/${promoter.facebook}`, confidence: 0.95 });
        if (promoter.instagram) contacts.push({ type: "instagram", value: promoter.instagram.startsWith("http") ? promoter.instagram : `https://instagram.com/${promoter.instagram}`, confidence: 0.95 });
        if (promoter.twitter) contacts.push({ type: "twitter", value: promoter.twitter.startsWith("http") ? promoter.twitter : `https://twitter.com/${promoter.twitter}`, confidence: 0.95 });
        if (promoter.email) contacts.push({ type: "email", value: promoter.email.toLowerCase(), confidence: 0.95 });

        for (const c of contacts) {
          const cr = await pool.query(
            `INSERT INTO ra_promoter_contacts (promoter_id, type, value, source_url, confidence)
             VALUES ($1, $2, $3, 'ra_graphql', $4)
             ON CONFLICT (promoter_id, type, value) DO UPDATE SET confidence = GREATEST(ra_promoter_contacts.confidence, $4)
             RETURNING id`,
            [promoterId, c.type, c.value, c.confidence]
          );
          if (cr.rowCount && cr.rowCount > 0) contactsAdded++;
        }
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
      [event.id, event.title, event.date, event.venue, event.city, event.city, event.country, event.raUrl, promoterId, event.artists.join(", ")]
    );
    if (r.rows[0]) eventsAdded++;

    if (promoterId && segment) {
      await pool.query(
        `INSERT INTO ra_promoter_profiles (promoter_id, segment, status, updated_at)
         VALUES ($1, $2, 'New', now())
         ON CONFLICT (promoter_id) DO UPDATE SET
           segment = CASE
             WHEN ra_promoter_profiles.segment IS NULL THEN $2
             WHEN $2 < ra_promoter_profiles.segment THEN $2
             ELSE ra_promoter_profiles.segment
           END,
           updated_at = now()`,
        [promoterId, segment]
      );
    }
  }

  return { eventsAdded, promotersAdded, contactsAdded };
}

/**
 * Scrape events for the next 6 weeks — scrapes EACH WEEK separately
 * so we guarantee coverage of all 6 weeks even when week 1 has thousands of events.
 */
export async function scrapeAndSaveRAEvents(): Promise<{
  eventsAdded: number;
  promotersAdded: number;
  contactsAdded: number;
  pages: number;
}> {
  const now = new Date();
  let totalEvents = 0;
  let totalPromoters = 0;
  let totalContacts = 0;
  let totalPages = 0;
  const maxPagesPerWeek = 15; // 15 pages × 20 = 300 events per week max

  for (let week = 0; week < 6; week++) {
    const weekStart = new Date(now.getTime() + week * 7 * 24 * 60 * 60 * 1000);
    const weekEnd = new Date(now.getTime() + (week + 1) * 7 * 24 * 60 * 60 * 1000);
    const startDate = weekStart.toISOString().split("T")[0];
    const endDate = weekEnd.toISOString().split("T")[0];

    let page = 1;
    while (page <= maxPagesPerWeek) {
      try {
        const { events, total } = await fetchRAEvents(startDate, endDate, page, 20);
        if (events.length === 0) break;

        const result = await saveEventsAndPromoters(events);
        totalEvents += result.eventsAdded;
        totalPromoters += result.promotersAdded;
        totalContacts += result.contactsAdded;
        totalPages++;

        if (page * 20 >= total) break;
        page++;

        await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));
      } catch (e) {
        console.error(`[ra-scrape] Week ${week + 1} page ${page} error:`, e);
        break;
      }
    }

    console.log(`[ra-scrape] Week ${week + 1}: ${page} pages, running total: ${totalEvents} events, ${totalPromoters} promoters, ${totalContacts} contacts`);
  }

  return { eventsAdded: totalEvents, promotersAdded: totalPromoters, contactsAdded: totalContacts, pages: totalPages };
}

// ---- Promoter Enrichment ----

/**
 * Enrich promoter: first try GraphQL API for direct fields,
 * then fall back to website scraping for emails.
 */
export async function enrichPromoter(promoterId: number): Promise<{
  linksFound: number;
  emailsFound: number;
}> {
  let linksFound = 0;
  let emailsFound = 0;

  const pRes = await pool.query<{ ra_id: string; ra_url: string; name: string }>(
    "SELECT ra_id, ra_url, name FROM ra_promoters WHERE id = $1",
    [promoterId]
  );
  if (!pRes.rows[0]) return { linksFound, emailsFound };

  const { ra_id, ra_url, name } = pRes.rows[0];

  // 1. Try GraphQL API for direct contact fields
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(RA_GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA, Referer: "https://ra.co" },
      body: JSON.stringify({ query: PROMOTER_QUERY, variables: { id: ra_id } }),
      signal: controller.signal,
    });
    clearTimeout(t);

    if (res.ok) {
      const json = await res.json() as {
        data?: { promoter?: { website?: string; facebook?: string; instagram?: string; twitter?: string; email?: string } };
      };
      const p = json.data?.promoter;
      if (p) {
        const contacts: Array<{ type: string; value: string; confidence: number }> = [];
        if (p.website) contacts.push({ type: "website", value: p.website, confidence: 0.95 });
        if (p.facebook) contacts.push({ type: "facebook", value: p.facebook.startsWith("http") ? p.facebook : `https://facebook.com/${p.facebook}`, confidence: 0.95 });
        if (p.instagram) contacts.push({ type: "instagram", value: p.instagram.startsWith("http") ? p.instagram : `https://instagram.com/${p.instagram}`, confidence: 0.95 });
        if (p.twitter) contacts.push({ type: "twitter", value: p.twitter.startsWith("http") ? p.twitter : `https://twitter.com/${p.twitter}`, confidence: 0.95 });
        if (p.email) contacts.push({ type: "email", value: p.email.toLowerCase(), confidence: 0.95 });

        for (const c of contacts) {
          await pool.query(
            `INSERT INTO ra_promoter_contacts (promoter_id, type, value, source_url, confidence)
             VALUES ($1, $2, $3, 'ra_graphql', $4)
             ON CONFLICT (promoter_id, type, value) DO UPDATE SET confidence = GREATEST(ra_promoter_contacts.confidence, $4)`,
            [promoterId, c.type, c.value, c.confidence]
          );
          if (c.type === "email") emailsFound++;
          else linksFound++;
        }
      }
    }
  } catch { /* skip GraphQL errors */ }

  // 2. If we found a website, scrape it for emails
  const websites = await pool.query<{ value: string }>(
    "SELECT value FROM ra_promoter_contacts WHERE promoter_id = $1 AND type = 'website' LIMIT 2",
    [promoterId]
  );

  const emailRegex = /[\w.+-]+@[\w.-]+\.\w{2,}/g;
  for (const { value: websiteUrl } of websites.rows) {
    if (!websiteUrl || websiteUrl.includes("facebook.com") || websiteUrl.includes("ra.co")) continue;
    try {
      const wc = new AbortController();
      const wt = setTimeout(() => wc.abort(), 8000);
      const wres = await fetch(websiteUrl, { headers: { "User-Agent": UA }, signal: wc.signal });
      clearTimeout(wt);
      if (wres.ok) {
        const whtml = await wres.text();
        const foundEmails = whtml.match(emailRegex) ?? [];
        for (const email of [...new Set(foundEmails)]) {
          if (email.includes("@sentry") || email.includes("@cloudflare") || email.includes("@w3.org") || email.includes("@example")) continue;
          await pool.query(
            `INSERT INTO ra_promoter_contacts (promoter_id, type, value, source_url, confidence)
             VALUES ($1, 'email', $2, $3, 0.80)
             ON CONFLICT (promoter_id, type, value) DO NOTHING`,
            [promoterId, email.toLowerCase(), websiteUrl]
          );
          emailsFound++;
        }
      }
    } catch { /* skip */ }
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000));
  }

  return { linksFound, emailsFound };
}
