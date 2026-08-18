/**
 * Cold-email copy for SoundCloud leads. Plain text, human 1:1 tone, NO em-dashes
 * / spam words. Three-touch sequence — the offer is NEVER in the first email
 * (that reads as spam). Touch 1 is a short, personal, offer-free opener with one
 * soft question. Touch 2 adds a little value. Touch 3 (only if no reply) makes
 * the discount offer. Positioning: not reposts (they already do RepostExchange),
 * but full multi-platform promotion (Spotify/Apple/YouTube + SC as one rollout).
 *
 * Copy rotates weekly via an ISO-week seed so it is not fingerprintable.
 */

function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((+date - +yearStart) / 86400000 + 1) / 7);
}
function pick<T>(pool: T[], seed: number): T { return pool[Math.abs(seed) % pool.length]; }
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

const GREETINGS = ["Hi {name},", "Hey {name},", "{name}, quick one.", "Hi {name}, hope you're good."];

// TOUCH 1 — short, personal, offer-free, one soft question.
const T1_SUBJECTS = ["your soundcloud", "quick question", "your releases", "liked your track", "your sound"];
const T1_OPENERS = [
  "Been listening to your SoundCloud, your production has real potential.",
  "Came across your SoundCloud, the production on your tracks really stands out.",
  "Been going through your SoundCloud, genuinely think your production has serious potential.",
];
const T1_QUESTIONS = [
  "Are you pushing these anywhere beyond SoundCloud yet, like Spotify, Bandcamp or Beatport?",
  "Are your releases getting any push on Spotify, Apple Music or Bandcamp yet?",
  "Anything happening with these on Spotify, Beatport or Bandcamp yet?",
  "Are you promoting your tracks beyond SoundCloud at all yet (Spotify, Bandcamp, Beatport)?",
];

// TOUCH 2 — brief value, soft CTA. Still no discount.
const T2_SUBJECTS = ["re: your soundcloud", "following up", "your next release"];
// Flatter, don't diminish. "for artists at your level" + comprehensive solutions
// that grow them across ALL major streamers at once (Spotify, Deezer, Tidal,
// Apple Music), our exclusive Beatport promotion, plus socials. Grouped so it
// stays compact, never a spammy platform dump, never "SoundCloud-only".
const T2_BODIES = [
  "Following up. For artists at your level we put together complete campaigns that grow you across all the main streaming services at once (Spotify, Deezer, Tidal, Apple Music), plus our exclusive Beatport promotion and social media on top. Would that be useful for your next release?",
  "Circling back. We build comprehensive packages for artists like you: simultaneous growth on the major streamers (Spotify, Deezer, Tidal, Apple Music), our exclusive Beatport push, and socials included. Worth a look for your next drop?",
  "One more note. For artists at your stage we run full campaigns across every major streaming service (Spotify, Deezer, Tidal, Apple Music), with unique Beatport promotion and social media on top. Want me to show how it works?",
];

// TOUCH 3 — the offer, only after no reply.
const T3_SUBJECTS = ["last note", "one option for you", "re: your releases"];
const T3_BODIES = [
  "Last one from me. If you want to try it on a release, I can set you up with {pct}% off your first package, so it's low risk. Want the details?",
  "Won't keep bugging you. If you'd like to test it, I can do {pct}% off your first package. Happy to send how it works.",
  "Final note. To make it easy to try, I can take {pct}% off your first package. Want me to break it down?",
];

const CLOSERS = ["Max\nPromoSound", "Max, PromoSound", "Cheers,\nMax\nPromoSound"];

export function buildScEmail(touch: 1 | 2 | 3, opts: { name: string; pct: number; code: string; unsubUrl: string; now?: Date }): { subject: string; text: string } {
  const now = opts.now ?? new Date();
  const week = isoWeek(now);
  const name = (opts.name || "there").split(/\s+/)[0].slice(0, 40) || "there";
  const seed = hash(name) + week + touch;
  const greet = pick(GREETINGS, seed).replace("{name}", name);
  const close = pick(CLOSERS, seed);

  // No unsubscribe link anywhere — it reads as a spam footer. These are 1:1
  // style emails to a monitored reply-to inbox, and the inbox automation honors
  // "stop / not interested" replies by blacklisting the sender. Clean + compliant.
  if (touch === 1) {
    const text = `${greet}\n\n${pick(T1_OPENERS, seed + 1)}\n\n${pick(T1_QUESTIONS, seed + 2)}\n\n${close}`;
    return { subject: pick(T1_SUBJECTS, seed), text };
  }
  if (touch === 2) {
    const text = `${greet}\n\n${pick(T2_BODIES, seed + 1)}\n\n${close}`;
    return { subject: pick(T2_SUBJECTS, seed), text };
  }
  const body = pick(T3_BODIES, seed + 1).replace("{pct}", String(opts.pct)).replace("{code}", opts.code);
  const text = `${greet}\n\n${body}\n\n${close}`;
  return { subject: pick(T3_SUBJECTS, seed), text };
}
