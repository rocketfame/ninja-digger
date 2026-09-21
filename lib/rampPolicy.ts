/**
 * The warm-up ladder's decision rules, pure and parameterless so the cron's
 * behaviour is unit-tested without a database (see lib/ramp.ts for the I/O).
 */
export type RampConfig = { start: string; steps: number[]; stepDays: number; hours: number };

/** Yesterday's outcome, 24 h after each group's broadcast. */
export type DayMetrics = { pushed: number; delivered: number; opened: number; hardBounce: number; unsub: number; spam: number };

/** What Gmail itself reports for the sending domain (lib/postmaster.ts), newest published day. */
export type PostmasterMetrics = { date: string; spamRatio: number | null; authRatio: number | null; deliveryErrorRatio: number; needsWork: string[]; verdict: string | null };

export type RampDecision =
  | { action: "off"; reason: string }
  | { action: "stop"; level: number; push: 0; reason: string }
  | { action: "hold" | "climb" | "start"; level: number; push: number; reason: string };

/** Gates (knowledge/MASS-OUTREACH.md, ramp table). Percentages of delivered unless noted. */
export const GATES = {
  minDelivered: 150,       // below this a day is too small to judge — treated as passed (52 letters stopped the ladder on 20.09)
  stopSpamPct: 0.1,
  stopBouncePct: 4,        // of pushed
  holdOpenPct: 10,
  holdOpenPctEarly: 15,    // first two rungs
  holdBouncePct: 2,        // of pushed
  holdUnsubPct: 1,
  pmStopSpam: 0.001,       // Postmaster userReportedSpamRatio (0..1): Google's own "keep below 0.1 %"
  pmStopErrors: 0.05,      // Postmaster delivery error ratio
  pmHoldAuth: 0.95,        // SPF/DKIM/DMARC success ratios
} as const;

const pct = (a: number, b: number) => (b > 0 ? (100 * a) / b : 0);

/** Which gate failed, if any. Empty string = all passed. `stop` gates are checked first. */
export function gateVerdict(m: DayMetrics | null, level: number, pm: PostmasterMetrics | null = null): { stop: string; hold: string } {
  const p = postmasterVerdict(pm);
  if (p.stop) return p;
  const own = ownVerdict(m, level);
  if (own.stop) return own;
  return { stop: "", hold: own.hold || p.hold };
}

/** Postmaster is judged on its own: it lags ~2 days but it is Gmail's verdict, not ours. */
export function postmasterVerdict(pm: PostmasterMetrics | null): { stop: string; hold: string } {
  if (!pm) return { stop: "", hold: "" };
  const f = (x: number) => (100 * x).toFixed(2);
  if (pm.spamRatio !== null && pm.spamRatio >= GATES.pmStopSpam) return { stop: `Postmaster ${pm.date}: скарги ${f(pm.spamRatio)} % ≥ 0.1 %`, hold: "" };
  if (pm.deliveryErrorRatio > GATES.pmStopErrors) return { stop: `Postmaster ${pm.date}: delivery errors ${f(pm.deliveryErrorRatio)} % > 5 %`, hold: "" };
  if (pm.verdict && /SPAM_RATE_HIGH|SMTP_ERRORS_HIGH|USER_FEEDBACK_NEGATIVE/.test(pm.verdict)) return { stop: "", hold: `Postmaster: вердикт ${pm.verdict}` };
  if (pm.authRatio !== null && pm.authRatio < GATES.pmHoldAuth) return { stop: "", hold: `Postmaster ${pm.date}: автентифікація ${f(pm.authRatio)} % < 95 %` };
  const hard = pm.needsWork.filter((r) => r !== "USER_REPORTED_SPAM_RATE"); // spam rate is judged by the ratio above
  if (hard.length) return { stop: "", hold: `Postmaster: needs work — ${hard.join(", ")}` };
  return { stop: "", hold: "" };
}

function ownVerdict(m: DayMetrics | null, level: number): { stop: string; hold: string } {
  if (!m || m.delivered < GATES.minDelivered) return { stop: "", hold: "" };
  const open = pct(m.opened, m.delivered), spam = pct(m.spam, m.delivered), bounce = pct(m.hardBounce, m.pushed), unsub = pct(m.unsub, m.delivered);
  const f = (x: number) => x.toFixed(2);
  if (spam >= GATES.stopSpamPct) return { stop: `скарги ${f(spam)} % ≥ ${GATES.stopSpamPct} %`, hold: "" };
  if (bounce > GATES.stopBouncePct) return { stop: `bounce ${f(bounce)} % > ${GATES.stopBouncePct} %`, hold: "" };
  const need = level < 2 ? GATES.holdOpenPctEarly : GATES.holdOpenPct;
  if (open < need) return { stop: "", hold: `відкриття ${f(open)} % < ${need} %` };
  if (bounce >= GATES.holdBouncePct) return { stop: "", hold: `bounce ${f(bounce)} % ≥ ${GATES.holdBouncePct} %` };
  if (unsub >= GATES.holdUnsubPct) return { stop: "", hold: `відписки ${f(unsub)} % ≥ ${GATES.holdUnsubPct} %` };
  return { stop: "", hold: "" };
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function rampDecision(i: {
  cfg: RampConfig | null; today: string; level: number; levelSince: string | null;
  stopped: boolean; manualHold: boolean; metrics: DayMetrics | null; postmaster?: PostmasterMetrics | null;
}): RampDecision {
  const { cfg } = i;
  if (!cfg || !cfg.steps.length) return { action: "off", reason: "esputnik_ramp не заданий" };
  if (i.today < cfg.start) return { action: "off", reason: `старт ${cfg.start}` };
  if (i.stopped) return { action: "stop", level: i.level, push: 0, reason: "стоп-кран не знято (esputnik_ramp_stopped)" };
  const level = Math.min(Math.max(i.level, 0), cfg.steps.length - 1);
  if (!i.levelSince) return { action: "start", level, push: cfg.steps[level], reason: "перший день сходинки" };
  const g = gateVerdict(i.metrics, level, i.postmaster ?? null);
  if (g.stop) return { action: "stop", level, push: 0, reason: g.stop };
  if (i.manualHold) return { action: "hold", level, push: cfg.steps[level], reason: "ручний hold (esputnik_ramp_hold)" };
  if (g.hold) return { action: "hold", level, push: cfg.steps[level], reason: g.hold };
  if (dayDiff(i.levelSince, i.today) < cfg.stepDays) return { action: "hold", level, push: cfg.steps[level], reason: `сходинка триває ${cfg.stepDays} дн.` };
  if (level >= cfg.steps.length - 1) return { action: "hold", level, push: cfg.steps[level], reason: "верхня сходинка" };
  return { action: "climb", level: level + 1, push: cfg.steps[level + 1], reason: "гейти пройдено" };
}

