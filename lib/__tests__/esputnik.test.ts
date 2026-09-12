import { describe, expect, it } from "vitest";
import { cleanFirstName, contactEmail, groupNameFor, isCustomerContact, mapEsputnikStatus, outcomeForEvent } from "../esputnikStatus";

describe("eSputnik status mapping", () => {
  it("maps every documented activity status onto our event vocabulary", () => {
    expect(mapEsputnikStatus("DELIVERED")).toBe("delivered");
    expect(mapEsputnikStatus("read")).toBe("opened");
    expect(mapEsputnikStatus("CLICKED")).toBe("click");
    expect(mapEsputnikStatus("UNSUBSCRIBED")).toBe("unsubscribed");
    expect(mapEsputnikStatus("SPAM")).toBe("spam");
    expect(mapEsputnikStatus("UNDELIVERED")).toBe("hard_bounce");
  });

  it("ignores statuses that are not outcomes (subscription changes, unknown)", () => {
    expect(mapEsputnikStatus("SUBSCRIPTION_CHANGED")).toBeNull();
    expect(mapEsputnikStatus(undefined)).toBeNull();
    expect(mapEsputnikStatus("WHATEVER")).toBeNull();
  });

  it("turns negative events into ledger outcomes that block a re-export", () => {
    expect(outcomeForEvent("spam")).toBe("complained");
    expect(outcomeForEvent("hard_bounce")).toBe("bounced");
    expect(outcomeForEvent("unsubscribed")).toBe("unsubscribed");
    expect(outcomeForEvent("click")).toBe("clicked");
  });

  it("names the day's group like the ones already in the account", () => {
    expect(groupNameFor("soundcloud", new Date(Date.UTC(2026, 8, 12)))).toBe("Leads: SoundCloud 12.09.2026 (auto)");
    expect(groupNameFor("youtube", new Date(Date.UTC(2026, 0, 3)))).toBe("Leads: YouTube 03.01.2026 (auto)");
  });
});

describe("leads never mix with customers", () => {
  it("treats a Shopify-stamped contact as a customer", () => {
    expect(isCustomerContact({ id: 1, externalCustomerId: "9766023725234", groups: [] })).toBe(true);
  });
  it("treats membership of any non-lead group as a customer", () => {
    expect(isCustomerContact({ id: 1, groups: [{ name: "Buyers: SoundCloud (auto)" }] })).toBe(true);
    expect(isCustomerContact({ id: 1, groups: [{ name: "Registration" }] })).toBe(true);
    expect(isCustomerContact({ id: 1, groups: [{ name: "Leads: SoundCloud 12.09.2026 (auto)" }, { name: "Newcomers" }] })).toBe(true);
  });
  it("leaves a plain lead alone", () => {
    expect(isCustomerContact({ id: 1, externalCustomerId: null, groups: [{ name: "Leads: Spotify 12.09.2026 (auto)" }] })).toBe(false);
    expect(isCustomerContact({ id: 1 })).toBe(false);
  });
});

describe("first names eSputnik will accept", () => {
  it("keeps letters in any script, digits, space, dot, apostrophe, hyphen", () => {
    expect(cleanFirstName("Jean-Luc O'Neil Jr.")).toBe("Jean-Luc O'Neil Jr.");
    expect(cleanFirstName("Олексій")).toBe("Олексій");
    expect(cleanFirstName("DJ 2Face")).toBe("DJ 2Face");
  });
  it("strips emoji, symbols and brackets, collapses spaces, drops empties", () => {
    expect(cleanFirstName("🔥 MAX (official) 🔥")).toBe("MAX official");
    expect(cleanFirstName("beheaded | producer")).toBe("beheaded producer");
    expect(cleanFirstName("★★★")).toBeUndefined();
    expect(cleanFirstName(null)).toBeUndefined();
  });
});

describe("exact email match on a contact", () => {
  it("reads the email channel, lower-cased", () => {
    expect(contactEmail({ id: 1, channels: [{ type: "sms", value: "+1" }, { type: "email", value: "Max@Example.com" }] })).toBe("max@example.com");
    expect(contactEmail({ id: 1 })).toBeNull();
  });
});
