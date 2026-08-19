/**
 * Cold-email copy for Spotify-channel leads (Ukrainian). Same framework/tone as
 * the SoundCloud copy — modern, easy, a bit slang, plain text, 1:1. These leads
 * are independent artists (found active around Spotify-promo content), so the
 * angle leads with Spotify/streaming rather than SoundCloud.
 * Three touches: 1) genuine discovery + soft question, no offer. 2) value
 * (campaigns for artists at their level: Spotify + all streaming + Beatport
 * charts + socials) + soft invite. 3) the exclusive discount, only if no reply.
 * No unsubscribe link — opt-out is reply-based, honored by the inbox automation.
 * Copy rotates weekly so it is not fingerprintable.
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

const GREETINGS = ["Привіт, {name}!", "Хей, {name}!", "Йо, {name}!"];

// ДОТИК 1 — щире відкриття + м'яке питання, без оферу.
const T1_SUBJECTS = ["твоя музика", "коротке питання", "твої треки", "залетіло", "твій звук"];
const T1_OPENERS = [
  "Натрапив на твою музику і чесно, вражений. Крутий звук, реально заходить.",
  "Послухав твої треки і мушу сказати, вражений. Дуже кльово, кайфую.",
  "Залетів на твій профіль, послухав і відверто, вражений. Звук топовий.",
];
const T1_QUESTIONS = [
  "Питання: ти вже якось просуваєш треки на Spotify та інших стрімінгах, чи поки органіка?",
  "Скажи, ти пушиш релізи на Spotify, Apple Music і десь ще, чи все поки саме росте?",
  "Ти вже качаєш це десь на стрімінгах, типу Spotify, Apple, Deezer, чи поки ні?",
];

// ДОТИК 2 — кампанії під артистів твого рівня + окремі топові послуги.
const T2_SUBJECTS = ["нагадую про себе", "щодо твого релізу", "є ідея"];
const T2_BODIES = [
  "Для артистів твого рівня в нас є кампанії під ключ: зростання на Spotify, Apple Music, Deezer, Tidal, топ-чарти Beatport і Amazon, плюс соцмережі (TikTok, Instagram). Зберемо пакет під твій наступний реліз? З гарною знижкою.",
  "Робимо повний розкрут релізу: Spotify, Apple Music, Deezer, Tidal, топ-чарти Beatport та Amazon, плюс TikTok і Instagram. Хочеш пакет під наступний дроп? Дамо чудову знижку.",
  "В нас є все під твій наступний реліз: стрімінги (Spotify, Apple Music, Deezer, Tidal), топ-чарти Beatport і Amazon, соцмережі (TikTok, Instagram). Цікаво? Зберемо пакет зі знижкою.",
];

// ДОТИК 3 — ексклюзивна знижка, тільки якщо не відповіли.
const T3_SUBJECTS = ["останнє від мене", "ексклюзив для тебе", "щодо твоїх релізів"];
const T3_BODIES = [
  "Останнє від мене. Якщо хочеш протестити наші потужності на своїх релізах, можу дати чудову ексклюзивну знижку {pct}% на наші послуги. Якщо цікаво, напиши.",
  "Фінальне повідомлення. Хочеш крутнути наші можливості на своїх треках? Тримай ексклюзивну знижку {pct}% на наші послуги. Якщо відгукується, пиши.",
  "Останній меседж. Готовий спробувати наші потужності на релізах? Дам ексклюзивну знижку {pct}%. Цікаво, напиши.",
];

const CLOSERS = ["Max\nPromoSound", "Max, PromoSound"];

function toHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111">${esc.replace(/\n/g, "<br>")}</div>`;
}

export function buildSpotifyEmail(touch: 1 | 2 | 3, opts: { name: string; pct: number; now?: Date }): { subject: string; text: string; html: string } {
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
  return { subject, text, html: toHtml(text) };
}
