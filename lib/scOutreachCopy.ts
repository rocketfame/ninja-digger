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
  "Ми в PromoSound одні з топових провайдерів промо на SoundCloud, тому й натрапив на твій профіль. Чесно скажу, вражений. Круті треки, дуже заходить.",
  "Ми серйозно рухаємо артистів на SoundCloud, тому й залетів на твій профіль. Відверто, вражений. Треки крутющі, реально подобається.",
  "Ми одні з топових SoundCloud-промо провайдерів, і твій звук зачепив. Мушу сказати, вражений. Кльові треки, кайфую.",
];
const T1_QUESTIONS = [
  "Питання: ти просуваєш їх десь окрім SoundCloud? Може, на Spotify, Bandcamp чи Beatport?",
  "Скажи, ти пушиш їх десь ще, крім SoundCloud? Spotify, Bandcamp, Beatport?",
  "Ти вже качаєш їх десь поза SoundCloud, типу Spotify, Bandcamp чи Beatport?",
];

// ДОТИК 2 — кампанії під артистів твого рівня + окремі топові послуги.
const T2_SUBJECTS = ["нагадую про себе", "щодо твого релізу", "є ідея"];
const T2_BODIES = [
  "Нагадую про себе. Для артистів твого рівня в нас є круті кампанії, які ми спеціально задизайнили саме під таких, як ти. Плюс є кілька окремих топових послуг, наприклад просування в топ-чарти на Beatport, Amazon та інших. Якщо є настрій перетерти про наступний реліз, зберемо тобі гарний пакет і зробимо чудову знижку.",
  "Знову я. Ми запилили круті кампанії саме під артистів твого рівня. Ще маємо кілька топових окремих послуг, типу заходу в топ-чарти Beatport, Amazon і не тільки. Хочеш поговорити про наступний дроп? Зберемо класний пакет із гарною знижкою.",
  "Нагадую про себе. Для таких артистів, як ти, у нас є кампанії, які ми задизайнили спеціально під вас. Плюс окремі топові штуки, наприклад пуш у топ-чарти на Beatport, Amazon та інших. Цікаво обговорити наступний реліз? Зробимо крутий пакет і чудову знижку.",
];

// ДОТИК 3 — ексклюзивна знижка, тільки якщо не відповіли.
const T3_SUBJECTS = ["останнє від мене", "ексклюзив для тебе", "щодо твоїх релізів"];
const T3_BODIES = [
  "Останнє від мене. Якщо хочеш протестити наші потужності на своїх релізах, можу дати чудову ексклюзивну знижку {pct}% на наші послуги. Якщо цікаво, напиши.",
  "Фінальне повідомлення. Хочеш крутнути наші можливості на своїх треках? Тримай ексклюзивну знижку {pct}% на наші послуги. Якщо відгукується, пиши.",
  "Останній меседж. Готовий спробувати наші потужності на релізах? Дам ексклюзивну знижку {pct}%. Цікаво, напиши.",
];

const CLOSERS = ["Max\nPromoSound", "Max, PromoSound"];

export function buildScEmail(touch: 1 | 2 | 3, opts: { name: string; pct: number; code: string; unsubUrl: string; now?: Date }): { subject: string; text: string } {
  const now = opts.now ?? new Date();
  const week = isoWeek(now);
  const name = (opts.name || "there").split(/\s+/)[0].slice(0, 40) || "there";
  const seed = hash(name) + week + touch;
  const greet = pick(GREETINGS, seed).replace("{name}", name);
  const close = pick(CLOSERS, seed);

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
