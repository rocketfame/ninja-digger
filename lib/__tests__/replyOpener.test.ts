import { describe, expect, it } from "vitest";
import { replyOpener } from "../llm";

describe("replyOpener — the draft stands on what OUR first email said", () => {
  it("keeps a YouTube lead on YouTube and never on charts", () => {
    const o = replyOpener("Radar/youtube");
    expect(o.platform).toBe("YouTube");
    expect(o.opener).toMatch(/latest YouTube video/);
    expect(o.opener).not.toMatch(/chart/i);
  });
  it("maps every acquisition channel to its own platform", () => {
    expect(replyOpener("soundcloud").platform).toBe("SoundCloud");
    expect(replyOpener("spotify").platform).toBe("Spotify");
    expect(replyOpener("Beatport").platform).toBe("Beatport");
    expect(replyOpener("beatport").opener).toMatch(/chart/);
  });
  it("only an unknown channel leaves the platform open", () => {
    expect(replyOpener(undefined).platform).toBe("");
  });
});
