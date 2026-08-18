/**
 * Cold-email copy for SoundCloud leads. Plain text only (best deliverability
 * for a cold list), human 1:1 tone, NO em-dashes / spam words. Positioning:
 * these artists already do SoundCloud reposts (RepostExchange) — so we DON'T
 * sell reposts. We sell the gap: their fans also stream on Spotify/Apple/
 * YouTube, and we cover all of them as one release rollout. SC push is included.
 *
 * Copy is assembled from pools with an ISO-week seed so it rotates weekly and
 * every recipient gets a slightly different, non-fingerprintable message.
 */

function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((+date - +yearStart) / 86400000 + 1) / 7);
}

// Deterministic pick so a given (recipient, week) always yields the same email.
function pick<T>(pool: T[], seed: number): T {
  return pool[Math.abs(seed) % pool.length];
}
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const SUBJECTS = [
  "saw your SoundCloud, bigger idea",
  "your track, every platform",
  "beyond the SoundCloud reposts",
  "quick idea for your next release",
  "your music + a wider push",
];

const GREETINGS = ["Hi {name},", "Hey {name},", "Hi {name}, hope you're good.", "{name}, quick one."];

const OPENINGS = [
  "Came across your SoundCloud and saw you're actively pushing your music.",
  "Been listening through your SoundCloud, you're clearly putting in the work on releases.",
  "Found your tracks on SoundCloud and noticed you're active right now.",
];

const GAPS = [
  "Most artists stop at SoundCloud reposts. The thing is, your fans also stream on Spotify, Apple Music and YouTube, and that's where a release really grows.",
  "Reposts are fine, but they only move one platform. Your listeners are also on Spotify, Apple Music and YouTube, and that's the part most artists leave on the table.",
  "SoundCloud reposts get you so far. Real growth happens when the same release also lands on Spotify, Apple Music and YouTube at once.",
];

const PITCHES = [
  "At PromoSound we run the full rollout across all of them: Spotify playlist pitching, Apple Music, YouTube, plus the SoundCloud push you already know, as one campaign.",
  "We handle the whole picture: Spotify playlists, Apple Music, YouTube and SoundCloud, packaged so your release hits everywhere instead of one channel.",
  "PromoSound covers it end to end: Spotify pitching, Apple Music, YouTube and SoundCloud together, so one release works across every platform your fans use.",
];

const OFFERS = [
  "Since you're active right now, use {code} for {pct}% off your first package so you can see how it moves your numbers everywhere, not just one platform.",
  "You're releasing at the right time, so here's {pct}% off your first package with code {code}. Good way to test it on a real release.",
  "Because you're already putting music out, I can give you {pct}% off the first package ({code}) to see the difference across platforms.",
];

const CTAS = ["Want the breakdown?", "Want me to send the details?", "Should I send over how it works?", "Open to seeing the numbers?"];

export function buildScEmail(opts: { name: string; pct: number; code: string; unsubUrl: string; now?: Date }): { subject: string; text: string } {
  const now = opts.now ?? new Date();
  const week = isoWeek(now);
  const seed = hash(opts.name || "artist") + week;
  const name = (opts.name || "there").split(/\s+/)[0].slice(0, 40) || "there";

  const subject = pick(SUBJECTS, seed);
  const body =
    pick(GREETINGS, seed).replace("{name}", name) + "\n\n" +
    pick(OPENINGS, seed + 1) + "\n\n" +
    pick(GAPS, seed + 2) + "\n\n" +
    pick(PITCHES, seed + 3) + "\n\n" +
    pick(OFFERS, seed + 4).replace("{pct}", String(opts.pct)).replace("{code}", opts.code) + "\n\n" +
    pick(CTAS, seed + 5) + "\n\n" +
    "Max\nPromoSound\n\n" +
    "Not the right time? Unsubscribe: " + opts.unsubUrl;

  return { subject, text: body };
}
