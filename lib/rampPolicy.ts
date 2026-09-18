/**
 * The warm-up ladder's decision rules, pure and parameterless so the cron's
 * behaviour is unit-tested without a database (see lib/ramp.ts for the I/O).
 */
export type RampConfig = { start: string; steps: number[]; stepDays: number; hours: number };

/** Yesterday's outcome, 24 h after each group's broadcast. */
export type DayMetrics = { pushed: number; delivered: number; opened: number; hardBounce: number; unsub: number; spam: number };

export type RampDecision =
  | { action: "off"; reason: string }
  | { action: "stop"; level: number; push: 0; reason: string }
  | { action: "hold" | "climb" | "start"; level: number; push: number; reason: string };

/** Gates (knowledge/MASS-OUTREACH.md, ramp table). Percentages of delivered unless noted. */
export const GATES = {
  minDelivered: 50,        // below this a day is too small to judge — treated as passed
  stopSpamPct: 0.1,
  stopBouncePct: 4,        // of pushed
  stopOpenPct: 4,
  holdOpenPct: 10,
  holdOpenPctEarly: 15,    // first two rungs
  holdBouncePct: 2,        // of pushed
  holdUnsubPct: 1,
} as const;

const pct = (a: number, b: number) => (b > 0 ? (100 * a) / b : 0);

/** Which gate failed, if any. Empty string = all passed. `stop` gates are checked first. */
export function gateVerdict(m: DayMetrics | null, level: number): { stop: string; hold: string } {
  if (!m || m.delivered < GATES.minDelivered) return { stop: "", hold: "" };
  const open = pct(m.opened, m.delivered), spam = pct(m.spam, m.delivered), bounce = pct(m.hardBounce, m.pushed), unsub = pct(m.unsub, m.delivered);
  const f = (x: number) => x.toFixed(2);
  if (spam >= GATES.stopSpamPct) return { stop: `скарги ${f(spam)} % ≥ ${GATES.stopSpamPct} %`, hold: "" };
  if (bounce > GATES.stopBouncePct) return { stop: `bounce ${f(bounce)} % > ${GATES.stopBouncePct} %`, hold: "" };
  if (open < GATES.stopOpenPct) return { stop: `відкриття ${f(open)} % < ${GATES.stopOpenPct} %`, hold: "" };
  const need = level < 2 ? GATES.holdOpenPctEarly : GATES.holdOpenPct;
  if (open < need) return { stop: "", hold: `відкриття ${f(open)} % < ${need} %` };
  if (bounce >= GATES.holdBouncePct) return { stop: "", hold: `bounce ${f(bounce)} % ≥ ${GATES.holdBouncePct} %` };
  if (unsub >= GATES.holdUnsubPct) return { stop: "", hold: `відписки ${f(unsub)} % ≥ ${GATES.holdUnsubPct} %` };
  return { stop: "", hold: "" };
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function rampDecision(i: {
  cfg: RampConfig | null; today: string; level: number; levelSince: string | null;
  stopped: boolean; manualHold: boolean; metrics: DayMetrics | null;
}): RampDecision {
  const { cfg } = i;
  if (!cfg || !cfg.steps.length) return { action: "off", reason: "esputnik_ramp не заданий" };
  if (i.today < cfg.start) return { action: "off", reason: `старт ${cfg.start}` };
  if (i.stopped) return { action: "stop", level: i.level, push: 0, reason: "стоп-кран не знято (esputnik_ramp_stopped)" };
  const level = Math.min(Math.max(i.level, 0), cfg.steps.length - 1);
  if (!i.levelSince) return { action: "start", level, push: cfg.steps[level], reason: "перший день сходинки" };
  const g = gateVerdict(i.metrics, level);
  if (g.stop) return { action: "stop", level, push: 0, reason: g.stop };
  if (i.manualHold) return { action: "hold", level, push: cfg.steps[level], reason: "ручний hold (esputnik_ramp_hold)" };
  if (g.hold) return { action: "hold", level, push: cfg.steps[level], reason: g.hold };
  if (dayDiff(i.levelSince, i.today) < cfg.stepDays) return { action: "hold", level, push: cfg.steps[level], reason: `сходинка триває ${cfg.stepDays} дн.` };
  if (level >= cfg.steps.length - 1) return { action: "hold", level, push: cfg.steps[level], reason: "верхня сходинка" };
  return { action: "climb", level: level + 1, push: cfg.steps[level + 1], reason: "гейти пройдено" };
}

