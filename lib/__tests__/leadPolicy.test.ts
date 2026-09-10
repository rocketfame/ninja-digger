import { describe, expect, it } from "vitest";
import {
  OPEN_EVENTS, PLATFORMS, contactableSql, isOpenEvent, leadSourcesSql,
} from "../leadPolicy";

const COLUMNS = ["email", "platform", "name", "followers", "country", "profile_url", "found_at", "touch", "email_status"];

describe("leadSourcesSql", () => {
  it("names every column in every branch", () => {
    // A UNION takes column names from its FIRST branch, so an unaliased branch
    // works inside the full union and breaks the moment its platform is asked
    // for on its own. That shipped once: platform=all worked, platform=spotify
    // returned an empty 500.
    for (const p of PLATFORMS) {
      const sql = leadSourcesSql([p]);
      for (const c of COLUMNS) {
        expect(sql, `${p} must alias ${c}`).toMatch(new RegExp(`\\b${c}\\b`));
      }
    }
  });

  it("types every placeholder NULL, which alone in a branch has no type to infer", () => {
    // `NULL country` is untyped and fails on its own; `NULL::text country` works.
    for (const p of PLATFORMS) {
      const untyped = leadSourcesSql([p]).match(/\bNULL\s+(?:country|profile_url|followers|name)\b/gi) ?? [];
      expect(untyped, `${p} has an untyped placeholder`).toHaveLength(0);
    }
  });

  it("joins the platforms asked for, and only those", () => {
    expect(leadSourcesSql(["spotify"]).match(/UNION ALL/g)).toBeNull();
    expect(leadSourcesSql().match(/UNION ALL/g)).toHaveLength(PLATFORMS.length - 1);
    expect(leadSourcesSql(["youtube"])).toContain("radar_leads");
    expect(leadSourcesSql(["youtube"])).not.toContain("sc_artists");
  });

  it("refuses an empty platform list rather than emitting broken SQL", () => {
    expect(() => leadSourcesSql([])).toThrow();
  });
});

describe("contactableSql", () => {
  it("checks suppression, hostile domains and the marketing handover", () => {
    const sql = contactableSql();
    expect(sql).toContain("email_blacklist");
    expect(sql).toContain("lead_exports");
    expect(sql).toMatch(/ru\|su\|by/);
  });

  it("applies to whatever column holds the address", () => {
    const sql = contactableSql("TRIM(ac.value)");
    expect(sql).toContain("LOWER(TRIM(ac.value)) NOT IN");
    expect(sql).toContain("TRIM(ac.value) IS NOT NULL");
    // the default column must not leak in — only the suppression subquery may
    // mention a column literally called `email`
    expect(sql).not.toContain("LOWER(email) NOT IN");
    expect(sql).not.toContain("email IS NOT NULL");
  });

  it("lets the verifier itself see unchecked addresses", () => {
    expect(contactableSql("email", { requireMailboxCheck: false })).not.toContain("email_verification");
  });

  it("refuses an address the mailbox check has never seen", () => {
    // checked-and-unknown is allowed (Outlook/Yahoo refuse probes); unchecked is not
    const sql = contactableSql();
    expect(sql).toContain("email_verification");
    expect(sql).toContain("verdict <> 'invalid'");
  });

  it("releases a lead the marketing side reported back as cold", () => {
    expect(contactableSql()).toContain("COALESCE(outcome,'') <> 'cold'");
  });
});

describe("isOpenEvent", () => {
  it("accepts every Brevo engagement event, in any case", () => {
    for (const e of OPEN_EVENTS) expect(isOpenEvent(e.toUpperCase())).toBe(true);
  });

  it("does not count Apple's pixel prefetch as a person opening mail", () => {
    expect(isOpenEvent("loadedbyproxy")).toBe(false);
    expect(isOpenEvent("delivered")).toBe(false);
    expect(isOpenEvent("hardbounces")).toBe(false);
  });
});
