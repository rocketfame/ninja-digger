import { describe, expect, it } from "vitest";
import { icpReject } from "../emailHygiene";

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
