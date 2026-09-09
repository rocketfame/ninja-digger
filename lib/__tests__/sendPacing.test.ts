import { describe, expect, it } from "vitest";
import { hourWeight, rampCap, WEIGHT_SUM } from "../sendPacing";

describe("hourWeight", () => {
  it("sends nothing while recipients are asleep", () => {
    for (const h of [0, 3, 6]) expect(hourWeight(h)).toBe(0);
  });

  it("weights US waking hours above the European morning", () => {
    expect(hourWeight(9)).toBe(1);
    expect(hourWeight(15)).toBe(1.5);
    expect(hourWeight(23)).toBe(1.5);
  });

  it("spreads exactly one daily cap across the day", () => {
    // hourly allowance = cap * weight / WEIGHT_SUM, so the day must sum to cap.
    const cap = 280;
    const spent = Array.from({ length: 24 }, (_, h) => (cap * hourWeight(h)) / WEIGHT_SUM).reduce((a, b) => a + b, 0);
    expect(spent).toBeCloseTo(cap, 6);
  });
});

describe("rampCap", () => {
  it("starts at 20 a day and grows about a quarter daily", () => {
    expect(rampCap(0, 300)).toBe(20);
    expect(rampCap(1, 300)).toBe(25);
    expect(rampCap(4, 300)).toBe(49);
  });

  it("never exceeds the configured ceiling", () => {
    expect(rampCap(20, 300)).toBe(300);
    expect(rampCap(365, 300)).toBe(300);
  });

  it("treats a clock skew into the past as day zero, not a negative cap", () => {
    expect(rampCap(-5, 300)).toBe(20);
  });
});
