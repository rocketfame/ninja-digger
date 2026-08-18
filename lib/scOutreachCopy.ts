/**
 * Cold-email copy for SoundCloud leads (Ukrainian, per request). Plain text,
 * human 1:1 tone. Three-touch sequence — the offer is NEVER in the first email.
 * Touch 1: short, personal opener + one soft question, no offer. Touch 2: value
 * (comprehensive multi-streamer + exclusive Beatport + socials), soft CTA.
 * Touch 3 (only if no reply): the discount offer. No unsubscribe link — opt-out
 * is reply-based and honored by the inbox automation. Copy rotates weekly.
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

const GREETINGS = ["Привіт, {name}!", "Хей, {name}!", "{name}, коротко.", "Привіт, {name}, як справи?"];

// ДОТИК 1 — коротко, особисто, без оферу, одне м'яке питання.
const T1_SUBJECTS = ["твій soundcloud", "коротке питання", "твої релізи", "сподобався трек", "твій звук"];
const T1_OPENERS = [
  "Слухав твій SoundCloud, у твого продакшену реально є потенціал.",
  "Натрапив на твій SoundCloud, продакшн у треках справді вирізняється.",
  "Переслухав твій SoundCloud, щиро вважаю, що твій продакшн має серйозний потенціал.",
];
const T1_QUESTIONS = [
  "Ти вже просуваєш їх десь окрім SoundCloud, типу Spotify, Bandcamp чи Beatport?",
  "Твої релізи вже отримують просування на Spotify, Apple Music чи Bandcamp?",
  "З цими треками вже щось відбувається на Spotify, Beatport чи Bandcamp?",
  "Ти взагалі промоутиш свої треки поза SoundCloud (Spotify, Bandcamp, Beatport)?",
];

// ДОТИК 2 — цінність: комплекс на всіх стрімінгах + ексклюзив Beatport + соцмережі.
const T2_SUBJECTS = ["re: твій soundcloud", "нагадую про себе", "твій наступний реліз"];
const T2_BODIES = [
  "Нагадую про себе. Для артистів твого рівня в нас є комплексні кампанії, які одночасно ростять тебе на всіх основних стрімінгах (Spotify, Deezer, Tidal, Apple Music), плюс наше ексклюзивне просування на Beatport і соцмережі зверху. Було б це корисно для твого наступного релізу?",
  "Повертаюся до тебе. Ми збираємо комплексні пакети для таких артистів, як ти: одночасне зростання на основних стрімінгах (Spotify, Deezer, Tidal, Apple Music), наш ексклюзивний пуш на Beatport і соцмережі в комплекті. Глянемо для твого наступного дропу?",
  "Ще одне. Для артистів твого етапу ми ведемо повноцінні кампанії на всіх основних стрімінгах (Spotify, Deezer, Tidal, Apple Music), з унікальним просуванням на Beatport і соцмережами зверху. Показати, як це працює?",
];

// ДОТИК 3 — аж тепер оффер, тільки якщо не відповіли.
const T3_SUBJECTS = ["останнє", "один варіант для тебе", "re: твої релізи"];
const T3_BODIES = [
  "Останнє від мене. Якщо хочеш спробувати на релізі, можу дати {pct}% знижки на перший пакет, тож ризик мінімальний. Скинути деталі?",
  "Не набридатиму. Якщо захочеш протестувати, можу зробити {pct}% знижки на перший пакет. З радістю розповім, як це працює.",
  "Фінальне. Щоб було простіше спробувати, можу зняти {pct}% з першого пакета. Розписати деталі?",
];

const CLOSERS = ["Max\nPromoSound", "Max, PromoSound", "Гарного дня,\nMax\nPromoSound"];

export function buildScEmail(touch: 1 | 2 | 3, opts: { name: string; pct: number; code: string; unsubUrl: string; now?: Date }): { subject: string; text: string } {
  const now = opts.now ?? new Date();
  const week = isoWeek(now);
  const name = (opts.name || "there").split(/\s+/)[0].slice(0, 40) || "there";
  const seed = hash(name) + week + touch;
  const greet = pick(GREETINGS, seed).replace("{name}", name);
  const close = pick(CLOSERS, seed);

  // No unsubscribe link anywhere (reads as a spam footer). 1:1 style to a
  // monitored reply-to inbox; the inbox automation honors "stop / not interested".
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
