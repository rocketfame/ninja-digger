import { describe, expect, it } from "vitest";
import { icpReject, nonArtistReason } from "../emailJunk";

describe("icpReject — who we do NOT sell to", () => {
  it("treats a non-freemail domain shared by three or more artists as representation", () => {
    expect(icpReject("booking@unitedtalent.com", { followers: 900, sharedBy: 67, maxFollowers: 50000 })).toMatch(/representation domain/);
    expect(icpReject("me@myownlabel.com", { followers: 900, sharedBy: 1, maxFollowers: 50000 })).toBeNull();
  });

  it("never mistakes a crowded freemail provider for an agency", () => {
    expect(icpReject("artist@gmail.com", { followers: 900, sharedBy: 10158, maxFollowers: 50000 })).toBeNull();
    expect(icpReject("artist@hotmail.fr", { followers: 900, sharedBy: 74, maxFollowers: 50000 })).toBeNull();
  });

  it("rejects a star above the follower ceiling", () => {
    expect(icpReject("x@gmail.com", { followers: 8599826, sharedBy: 0, maxFollowers: 50000 })).toMatch(/star/);
    expect(icpReject("x@gmail.com", { followers: 49999, sharedBy: 0, maxFollowers: 50000 })).toBeNull();
    expect(icpReject("x@gmail.com", { followers: null, sharedBy: 0, maxFollowers: 50000 })).toBeNull();
  });
});

describe("nonArtistReason — labels, hubs and agencies are not artists", () => {
  it("catches a label or repost hub by name", () => {
    for (const n of ["Future House Records", "Label & Music Collective", "* ONLY FREE DOWNLOAD *", "Repost - Music Promotion Agency", "Bookings & Mngmnt", "Deep House Podcast"])
      expect(nonArtistReason(n, null), n).toBe("name");
  });
  it("catches a label by its bio", () => {
    expect(nonArtistReason("cat soup", "Independent record label. Send us your demos at ...")).toBe("bio");
    expect(nonArtistReason("x", "Free download in description")).toBe("bio");
  });
  it("leaves real artists alone, including the ones that replied to us", () => {
    for (const n of ["Blanke", "Alex Medellin", "FLØRALS", "Sark 7", "DJ GETDOWN", "Radio Slave", "Deadmau5 Official"])
      expect(nonArtistReason(n, "producer / dj. bookings: me@me.com"), n).toBeNull();
  });
  it("feeds through icpReject with its own reason", () => {
    expect(icpReject("a@gmail.com", { followers: 100, sharedBy: 0, maxFollowers: 50000, name: "SMOG Records" })).toMatch(/not an artist \(name\)/);
  });
});
