/**
 * Send-hour weights (UTC) — where our recipients are awake and reading mail:
 * 07-12 Europe morning/lunch (1.0), 13-23 US East morning → West Coast
 * afternoon (1.5), 00-06 nobody (0). The daily cap is spread across the day
 * proportionally to these weights, so the budget lands in the recipient's
 * working hours instead of running out by 18:00 UTC (11:00 in Los Angeles).
 * Pure module (no DB import) so it is unit-testable.
 */
export function hourWeight(utcHour: number): number {
  if (utcHour >= 7 && utcHour <= 12) return 1;
  if (utcHour >= 13 && utcHour <= 23) return 1.5;
  return 0;
}
export const WEIGHT_SUM = Array.from({ length: 24 }, (_, h) => hourWeight(h)).reduce((a, b) => a + b, 0); // 6*1 + 11*1.5 = 22.5
