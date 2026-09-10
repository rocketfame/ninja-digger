/**
 * Radar outreach copy, SOURCE-AWARE. Each Radar segment gets a tailored offer:
 *   youtube → YouTube-promo pitch (they're actively uploading videos)
 *   reddit  → playlist/streams pitch
 *   default → generic music-promo
 *
 * Plain text, 1:1 tone.
 *
 * Touch 1 is the ONLY cold email we send now, so it must say who we are. The
 * old version complimented the video and offered to "share an idea" without
 * naming PromoSound or what we sell: two artists read it as us wanting to BUY
 * their videos and quoted a price, another asked why we were pretending to want
 * a chat instead of writing the proposal. Touches 2 and 3 are kept for
 * reference but nothing calls them any more.
 */

export type RadarEmail = { subject: string; text: string };

const SIG = "\n\n--\nMax\nPromoSound";

function youtube(touch: 1 | 2 | 3, name: string, pct: number): RadarEmail {
  if (touch === 1)
    return {
      subject: `your latest upload`,
      text: `Hey ${name},\n\nCame across your latest video, the sound genuinely stood out.\n\nI'm Max from PromoSound, we run promotion campaigns for independent artists on YouTube, Spotify, SoundCloud and Beatport. How's the reach been on this one so far?\n\nIf you're pushing it, happy to tell you how we'd approach it.${SIG}`,
    };
  if (touch === 2)
    return {
      subject: `growing on YouTube`,
      text: `Hey ${name},\n\nWe run a full YouTube + Spotify promo package for independent artists, real views & algorithm traction on YouTube, plus playlist placements and streams on Spotify. The whole thing handled for you. Feels like a fit for your latest release. Want the details?${SIG}`,
    };
  return {
    subject: `idea for your next drop`,
    text: `Hey ${name},\n\nWe're opening a few spots this month for our all-in-one YouTube + Spotify package, video views + algorithm on YouTube, playlists + streams on Spotify, everything covered. ${pct}% off the first campaign. If you've got a release out or dropping soon, happy to send the full breakdown.${SIG}`,
  };
}

function reddit(touch: 1 | 2 | 3, name: string, pct: number): RadarEmail {
  if (touch === 1)
    return {
      subject: `your release`,
      text: `Hey ${name},\n\nCaught your release, the sound genuinely stood out.\n\nI'm Max from PromoSound, we run promotion campaigns for independent artists on Spotify, SoundCloud, Beatport and YouTube. How's it doing on the streaming side so far?\n\nIf you're pushing it, happy to tell you how we'd approach it.${SIG}`,
    };
  if (touch === 2)
    return {
      subject: `getting real streams`,
      text: `Hey ${name},\n\nWe run a full Spotify promo package for independent artists, playlist placements, editorial pitching and real streams from listeners in your genre. The whole thing handled for you. Feels like a fit for your latest. Want the details?${SIG}`,
    };
  return {
    subject: `idea for your next drop`,
    text: `Hey ${name},\n\nWe're opening a few spots this month for our Spotify promo package, playlists + real streams, everything covered, ${pct}% off the first campaign. If you've got a release out or dropping soon, happy to send the full breakdown.${SIG}`,
  };
}

function generic(touch: 1 | 2 | 3, name: string, pct: number): RadarEmail {
  if (touch === 1)
    return { subject: `your music`, text: `Hey ${name},\n\nFound your music recently and really dug it.\n\nI'm Max from PromoSound, we run promotion campaigns for independent artists across Spotify, SoundCloud, Beatport and YouTube. How's the promo side going for you right now?${SIG}` };
  if (touch === 2)
    return { subject: `quick idea`, text: `Hey ${name},\n\nWe help independent artists get real streams + playlist placements (Spotify/Apple/Deezer). Might be useful for your latest. Want the details?${SIG}` };
  return { subject: `spots opening up`, text: `Hey ${name},\n\nOpening a few promo spots this month, ${pct}% off the first campaign for independent artists. Want the details?${SIG}` };
}

export function buildRadarEmail(source: string, touch: 1 | 2 | 3, name: string, pct = 25): RadarEmail {
  const n = name || "there";
  switch (source) {
    case "youtube":
      return youtube(touch, n, pct); // YouTube + Spotify package
    case "reddit":
      return reddit(touch, n, pct); // Spotify package
    default:
      return generic(touch, n, pct);
  }
}
