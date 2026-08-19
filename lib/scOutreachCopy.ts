/**
 * Cold-email copy for SoundCloud leads (Ukrainian). Modern, easy, a bit slang —
 * the audience is current and cool, not corporate. Plain text, 1:1 tone.
 * Three touches: 1) genuine compliment + soft question, no offer. 2) value
 * (campaigns designed for artists at their level + top-chart services on
 * Beatport/Amazon) + soft invite. 3) the exclusive discount, only if no reply.
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

// ДОТИК 1 — щирий комплімент + м'яке питання, без оферу.
const T1_SUBJECTS = ["твій soundcloud", "коротке питання", "твої треки", "вражений", "твій звук"];
const T1_OPENERS = [
  "Послухав твій SoundCloud і чесно скажу, вражений. Круті треки, дуже заходить.",
  "Залетів на твій SoundCloud і відверто, вражений. Треки крутющі, реально подобається.",
  "Послухав твій саундклауд і мушу сказати, вражений. Кльові треки, кайфую.",
];
const T1_QUESTIONS = [
  "Питання: ти просуваєш їх десь окрім SoundCloud? Spotify, Bandcamp, Beatport, або десь ще?",
  "Скажи, ти пушиш їх десь ще, крім SoundCloud? Spotify, Bandcamp, Beatport, деінде?",
  "Ти вже качаєш їх десь поза SoundCloud, типу Spotify, Bandcamp, Beatport, або ще десь?",
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

// Minimal HTML that renders identically to the plain text (no styling, no
// images) so the email still reads 1:1, but Brevo can inject its open-tracking
// pixel. text is kept as the multipart fallback.
function toHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111">${esc.replace(/\n/g, "<br>")}</div>`;
}

export function buildScEmail(touch: 1 | 2 | 3, opts: { name: string; pct: number; code: string; unsubUrl: string; now?: Date }): { subject: string; text: string; html: string } {
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
    const body = pick(T3_BODIES, seed + 1).replace("{pct}", String(opts.pct)).replace("{code}", opts.code);
    text = `${greet}\n\n${body}\n\n${close}`;
  }
  return { subject, text, html: toHtml(text) };
}
