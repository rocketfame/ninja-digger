/**
 * Radar outreach copy — SOURCE-AWARE. Each Radar segment gets a tailored offer:
 *   youtube → YouTube-promo pitch (they're actively uploading videos)
 *   reddit  → playlist/streams pitch
 *   default → generic music-promo
 *
 * ⚠️ DRAFT copy — pending the user's exact offer + language choice. The cron is
 * PAUSED (app_settings radar_outreach_paused='1') so nothing sends until approved.
 * Plain text, 1:1 tone. Touch 1 has NO offer (genuine), 2 = value, 3 = offer.
 */

export type RadarEmail = { subject: string; text: string };

const SIG = "\n\n--\nMax\nPromoSound";

function youtube(touch: 1 | 2 | 3, name: string, pct: number): RadarEmail {
  if (touch === 1)
    return {
      subject: `your latest upload`,
      text: `Hey ${name},\n\nCame across your latest video — the sound genuinely stood out. How's the reach been so far? We've actually got an idea that could get it in front of a lot more people — happy to share if you're up for it.${SIG}`,
    };
  if (touch === 2)
    return {
      subject: `growing on YouTube`,
      text: `Hey ${name},\n\nWe run a full YouTube + Spotify promo package for independent artists — real views & algorithm traction on YouTube, plus playlist placements and streams on Spotify. The whole thing handled for you. Feels like a fit for your latest release — open to a quick chat?${SIG}`,
    };
  return {
    subject: `idea for your next drop`,
    text: `Hey ${name},\n\nWe're opening a few spots this month for our all-in-one YouTube + Spotify package — video views + algorithm on YouTube, playlists + streams on Spotify, everything covered. ${pct}% off the first campaign. If you've got a release out or dropping soon, happy to send the full breakdown.${SIG}`,
  };
}

function reddit(touch: 1 | 2 | 3, name: string, pct: number): RadarEmail {
  if (touch === 1)
    return {
      subject: `your release`,
      text: `Hey ${name},\n\nCaught your release — the sound genuinely stood out. How's it doing on the streaming side so far? We've actually got an idea that could get it in front of a lot more listeners — happy to share if you're up for it.${SIG}`,
    };
  if (touch === 2)
    return {
      subject: `getting real streams`,
      text: `Hey ${name},\n\nWe run a full Spotify promo package for independent artists — playlist placements, editorial pitching and real streams from listeners in your genre. The whole thing handled for you. Feels like a fit for your latest — open to a quick chat?${SIG}`,
    };
  return {
    subject: `idea for your next drop`,
    text: `Hey ${name},\n\nWe're opening a few spots this month for our Spotify promo package — playlists + real streams, everything covered, ${pct}% off the first campaign. If you've got a release out or dropping soon, happy to send the full breakdown.${SIG}`,
  };
}

function generic(touch: 1 | 2 | 3, name: string, pct: number): RadarEmail {
  if (touch === 1)
    return { subject: `your music`, text: `Hey ${name},\n\nFound your music recently and really dug it. How's the promo side going for you right now?${SIG}` };
  if (touch === 2)
    return { subject: `quick idea`, text: `Hey ${name},\n\nWe help independent artists get real streams + playlist placements (Spotify/Apple/Deezer). Might be useful for your latest — open to a quick chat?${SIG}` };
  return { subject: `spots opening up`, text: `Hey ${name},\n\nOpening a few promo spots this month — ${pct}% off the first campaign for independent artists. Want the details?${SIG}` };
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
