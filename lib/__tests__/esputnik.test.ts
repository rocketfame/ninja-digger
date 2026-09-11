import { describe, expect, it } from "vitest";
import { groupNameFor, mapEsputnikStatus, outcomeForEvent } from "../esputnikStatus";

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
