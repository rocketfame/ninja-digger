/**
 * Enrichment quality scoring utilities.
 * Pure functions, no external deps except cheerio.
 */

import * as cheerio from "cheerio";

export type EmailType =
  | "personal"
  | "booking"
  | "management"
  | "generic"
  | "unknown";

export type SourceContext =
  | "ra_profile_direct"
  | "ra_bio"
  | "linktree"
  | "soundcloud_bio"
  | "bandcamp"
  | "mixcloud"
  | "search_result"
  | "unknown";

export function classifyEmail(
  email: string,
  artistName: string
): { type: EmailType; confidenceAdjustment: number; reason: string } {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  const normalized = artistName
    .toLowerCase()
    .replace(/^dj\s+/i, "")
    .trim();
  const parts = normalized.split(/\s+/).filter((p) => p.length >= 2);

  const fullName = normalized.replace(/\s+/g, "");
  const localDomain = local + domain;

  if (parts.length > 0) {
    const nameInLocal = parts.some((p) => local.includes(p) || local.includes(p.replace(/[^a-z0-9]/g, "")));
    const nameInDomain = parts.some((p) => domain.includes(p));
    if (nameInLocal || nameInDomain || localDomain.includes(fullName)) {
      return { type: "personal", confidenceAdjustment: 15, reason: "artist name in email" };
    }
  }

  const managementPatterns = ["management", "manager", "mgmt"];
  const hasManagement = managementPatterns.some((p) => local.includes(p) || domain.includes(p));
  if (hasManagement) {
    return {
      type: "management",
      confidenceAdjustment: -25,
      reason: "management pattern in email",
    };
  }

  const bookingPatterns = ["booking", "agency", "pr", "press", "label"];
  const hasBooking = bookingPatterns.some((p) => local.includes(p) || domain.includes(p));
  if (hasBooking) {
    return {
      type: "booking",
      confidenceAdjustment: -25,
      reason: "booking pattern in email",
    };
  }

  const genericPatterns = ["info", "contact", "hello", "mail", "support", "admin"];
  if (genericPatterns.some((p) => local === p)) {
    return { type: "generic", confidenceAdjustment: -10, reason: "generic local part" };
  }

  return { type: "unknown", confidenceAdjustment: 0, reason: "no pattern matched" };
}

export function detectSourceContext(sourceUrl: string): SourceContext {
  if (!sourceUrl || typeof sourceUrl !== "string") return "unknown";
  const lower = sourceUrl.toLowerCase();

  if (/ra\.co\/dj\/[^/?#]+/.test(lower) || /residentadvisor\.net\/[^/?#]*\/dj\/[^/?#]+/.test(lower)) {
    return "ra_profile_direct";
  }
  if (/ra\.co/.test(lower) || /residentadvisor\.net/.test(lower)) {
    return "ra_bio";
  }
  if (/linktree\.com|linktr\.ee|beacons\.ai|carrd\.co/.test(lower)) {
    return "linktree";
  }
  if (/soundcloud\.com/.test(lower)) {
    return "soundcloud_bio";
  }
  if (/bandcamp\.com/.test(lower)) {
    return "bandcamp";
  }
  if (/mixcloud\.com/.test(lower)) {
    return "mixcloud";
  }
  if (/duckduckgo|bing\.com|startpage|google\.com\/search/.test(lower)) {
    return "search_result";
  }

  return "unknown";
}

export function baseConfidenceForSource(context: SourceContext): number {
  const map: Record<SourceContext, number> = {
    ra_profile_direct: 90,
    ra_bio: 80,
    linktree: 75,
    soundcloud_bio: 70,
    bandcamp: 70,
    mixcloud: 65,
    search_result: 50,
    unknown: 40,
  };
  return map[context] ?? 40;
}

export function computeConfidence(
  sourceUrl: string,
  email: string,
  artistName: string
): {
  confidence: number;
  emailType: EmailType;
  sourceContext: SourceContext;
  reason: string;
} {
  const sourceContext = detectSourceContext(sourceUrl);
  const base = baseConfidenceForSource(sourceContext);
  const { type: emailType, confidenceAdjustment, reason } = classifyEmail(
    email,
    artistName
  );
  const confidence = Math.max(0, Math.min(100, base + confidenceAdjustment));
  return {
    confidence,
    emailType,
    sourceContext,
    reason,
  };
}

export async function validateInstagramHandle(
  handle: string,
  artistName: string,
  fetchFn: (url: string) => Promise<string | null>
): Promise<{ valid: boolean; confidence: number; note: string }> {
  const cleanHandle = handle.replace(/^@/, "").replace(/\/$/, "").trim();
  if (!cleanHandle) {
    return { valid: false, confidence: 0, note: "empty handle" };
  }

  const url = `https://www.instagram.com/${cleanHandle}/`;
  const html = await fetchFn(url);
  if (!html || html.length < 500) {
    return { valid: false, confidence: 0, note: "empty or failed fetch" };
  }

  const isPrivate =
    html.includes('"is_private":true') ||
    html.includes("This Account is Private");
  if (isPrivate) {
    return  { valid: false, confidence: 50, note: "private account" };
  }

  const normalized = artistName
    .toLowerCase()
    .replace(/^dj\s+/i, "")
    .trim();
  const parts = normalized.split(/\s+/).filter((p) => p.length >= 2);

  let confidence = 30;
  const signals: string[] = [];

  const $ = cheerio.load(html);
  let displayName = "";
  let bio = "";

  const ldJsonScripts = $('script[type="application/ld+json"]');
  ldJsonScripts.each((_, el) => {
    try {
      const text = $(el).html();
      if (!text) return;
      const data = JSON.parse(text) as { type?: string; name?: string; description?: string };
      if (data.name) displayName = data.name;
      if (data.description) bio = data.description;
    } catch {
      // ignore parse errors
    }
  });

  if (!bio) {
    const metaDesc = $('meta[name="description"]').attr("content");
    if (metaDesc) bio = metaDesc;
  }

  const displayLower = displayName.toLowerCase();
  const bioLower = bio.toLowerCase();

  if (parts.length > 0) {
    const nameInDisplay = parts.some(
      (p) =>
        displayLower.includes(p) ||
        displayLower.includes(p.replace(/[^a-z0-9]/g, ""))
    );
    if (nameInDisplay) {
      confidence += 35;
      signals.push("name_in_display");
    }

    const nameInBio = parts.some(
      (p) => bioLower.includes(p) || bioLower.includes(p.replace(/[^a-z0-9]/g, ""))
    );
    if (nameInBio) {
      confidence += 15;
      signals.push("name_in_bio");
    }
  }

  if (bioLower.includes("beatport.com")) {
    confidence += 15;
    signals.push("beatport_in_bio");
  }
  if (bioLower.includes("ra.co") || bioLower.includes("residentadvisor")) {
    confidence += 10;
    signals.push("ra_in_bio");
  }

  confidence = Math.min(confidence, 100);

  const valid = confidence >= 60;
  const note = signals.length > 0 ? signals.join(", ") : "unverified";

  return { valid, confidence, note };
}
