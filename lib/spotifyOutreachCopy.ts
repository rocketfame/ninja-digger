/**
 * Cold-email copy for Spotify-channel leads — ENGLISH, plain text, 1:1, casual.
 * Deliverability-first: touch 1 is a genuine 1:1 note with ZERO offer / discount /
 * links (so Gmail keeps it out of Promotions). Touch 2 = soft value. Touch 3 =
 * the exclusive discount, only if no reply. No unsubscribe link — reply-based
 * opt-out, honored by the inbox automation. Copy rotates weekly.
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

const GREETINGS = ["Hey {name},", "Hi {name},", "Yo {name},"];

// TOUCH 1 — genuine, personal, NO offer / no links. Just a real note + a question.
const T1_SUBJECTS = ["your music", "quick question", "your tracks", "your sound", "just heard this"];
const T1_OPENERS = [
  "Came across your music and honestly, it really landed with me — the sound's got something.",
  "Been listening to your tracks and had to reach out — genuinely good stuff.",
  "Found your profile, gave it a proper listen, and the sound really stood out.",
];
const T1_QUESTIONS = [
  "Quick one — are you already pushing your releases anywhere, or mostly letting them grow on their own so far?",
  "Are you running any promo on your releases right now, or is it all organic at the moment?",
  "Do you do anything to push your tracks after a release, or not really yet?",
];

// TOUCH 2 — soft value, no discount yet.
const T2_SUBJECTS = ["circling back", "about your release", "an idea for you"];
const T2_BODIES = [
  "We help independent artists grow their releases — real streams and playlist placements across Spotify, Apple Music and the other platforms, plus a push on socials. Might be a fit for your next drop — open to a quick chat?",
  "For artists at your level we put together release campaigns — streams + playlists on Spotify/Apple/Deezer and a social push, all handled for you. Worth exploring for your next release?",
  "We run full release pushes for independent artists — playlists, real streams and socials, tailored to where you're at. Feels like a fit for your latest — up for a quick chat?",
];

// TOUCH 3 — the exclusive discount, only if no reply.
const T3_SUBJECTS = ["last note from me", "one last thing", "about your next release"];
const T3_BODIES = [
  "Last note from me — if you want to try what we do on one of your releases, I can offer an exclusive {pct}% off the first campaign. If it's interesting, just reply.",
  "Final message. If you'd like to test us on your next track, here's an exclusive {pct}% off to start. If it resonates, drop me a line.",
  "One last one — happy to run your next release with an exclusive {pct}% off the first campaign. If you're up for it, just reply.",
];

const CLOSERS = ["Max\nPromoSound", "Max, PromoSound"];

export function buildSpotifyEmail(touch: 1 | 2 | 3, opts: { name: string; pct: number; now?: Date }): { subject: string; text: string } {
  const now = opts.now ?? new Date();
  const week = isoWeek(now);
  const name = (opts.name || "there").split(/\s+/)[0].slice(0, 40) || "there";
  const seed = hash(name) + week + touch;
  const greet = pick(GREETINGS, seed).replace("{name}", name);
  const close = pick(CLOSERS, seed);

  let subject: string, text: string;
  if (touch === 1) {
    subject = pick(T1_SUBJECTS, seed);
    text = `${greet}\n\n${pick(T1_OPENERS, seed + 1)}\n\n${pick(T1_QUESTIONS, seed + 2)}\n\n${close}`;
  } else if (touch === 2) {
    subject = pick(T2_SUBJECTS, seed);
    text = `${greet}\n\n${pick(T2_BODIES, seed + 1)}\n\n${close}`;
  } else {
    subject = pick(T3_SUBJECTS, seed);
    const body = pick(T3_BODIES, seed + 1).replace("{pct}", String(opts.pct));
    text = `${greet}\n\n${body}\n\n${close}`;
  }
  return { subject, text };
}
