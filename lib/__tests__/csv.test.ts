import { describe, expect, it } from "vitest";
import { csvCell } from "../csv";

describe("csvCell", () => {
  it("leaves a plain value alone", () => {
    expect(csvCell("Acid Pauli")).toBe("Acid Pauli");
    expect(csvCell(42)).toBe("42");
  });

  it("renders nothing for a missing value", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes anything that would break a row", () => {
    expect(csvCell("Smith, John")).toBe('"Smith, John"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    // a bare carriage return used to split a row — no implementation escaped it
    expect(csvCell("carriage\rreturn")).toBe('"carriage\rreturn"');
    // not our delimiter, but Excel in European locales reads it as one
    expect(csvCell("a;b")).toBe('"a;b"');
  });

  it("doubles embedded quotes so the cell survives a round trip", () => {
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
  });
});
