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
      text: `Hey ${name},\n\nCame across your latest video — the sound genuinely stood out. How's it doing so far, are you happy with the reach?${SIG}`,
    };
  if (touch === 2)
    return {
      subject: `growing on YouTube`,
      text: `Hey ${name},\n\nQuick one — we help independent artists push their music videos on YouTube (real views + algorithm traction) alongside Spotify. Figured it might fit where you're at with your latest release. Worth a chat?${SIG}`,
    };
  return {
    subject: `idea for your next drop`,
    text: `Hey ${name},\n\nWe're opening a few spots this month for a YouTube + Spotify promo push for independent artists — ${pct}% off for the first release. If you've got something dropping, happy to send details.${SIG}`,
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
      return youtube(touch, n, pct);
    default:
      return generic(touch, n, pct);
  }
}
