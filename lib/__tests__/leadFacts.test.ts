import { describe, expect, it } from "vitest";
import { isCatalogRelease } from "../leadFacts";

describe("isCatalogRelease", () => {
  const now = Date.parse("2026-09-06");
  it("flags releases older than a year as catalog", () => {
    expect(isCatalogRelease("1991-01-01", now)).toBe(true);
    expect(isCatalogRelease("2017-09-01", now)).toBe(true);
    expect(isCatalogRelease("2025-08-01", now)).toBe(true);
  });
  it("keeps recent releases and unknown values as non-catalog", () => {
    expect(isCatalogRelease("2026-09-04", now)).toBe(false);
    expect(isCatalogRelease("2025-10-01", now)).toBe(false);
    expect(isCatalogRelease("Underground Resistance", now)).toBe(false);
    expect(isCatalogRelease(null, now)).toBe(false);
  });
});
