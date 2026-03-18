/**
 * RA Outreach — email templates for event promoter groups.
 * 5 variants per touch to avoid spam patterns.
 * Personalized with promoter name + event name + city.
 */

export const RA_SIGNATURE = `\n\n--\nWith Regards, your Promosound.\nEVENT PROMO: https://promosoundgroup.net/\nSPOTIFY PROMO: https://promosoundgroup.net/collections/spotify-promotion\nBEATPORT PROMO: https://promosoundgroup.net/collections/beatport-top-100-promotion`;

export const RA_TOUCH1 = {
  subjects: [
    "Promo support for your upcoming event",
    "Boost visibility for your next event",
    "Quick idea for your upcoming party",
    "Event promotion — a brief thought",
    "Saw your event listing — wanted to reach out",
  ],
  bodies: [
    (name: string, event: string, city: string) =>
      `Hi ${name},\n\nNoticed your upcoming event${event ? ` "${event}"` : ""} in ${city || "your city"} — looks like a solid lineup.\n\nI'm Max from PromoSound. We help promoters amplify event visibility across platforms — Spotify playlists, Beatport charts, RA features, and social channels — timed to build momentum before the door opens.\n\nIf you're looking to push ticket sales or grow your audience for this one, I'd be happy to share a few options.\n\nBest,\nMax`,
    (name: string, event: string, city: string) =>
      `Hi ${name},\n\nSaw your event${event ? ` "${event}"` : ""} coming up in ${city || "the area"} — great lineup.\n\nWe work with promoters to extend event reach through targeted music promotion. The idea is simple: boost the artists on your bill across streaming and social platforms, which drives attention back to your event.\n\nHappy to outline how this typically works if you're interested.\n\nCheers,\nMax`,
    (name: string, event: string, city: string) =>
      `Hey ${name},\n\nYour upcoming event${event ? ` "${event}"` : ""} in ${city || "your area"} caught my eye.\n\nAt PromoSound, we specialize in pre-event promotion — getting the artists on your lineup more visible across Spotify, Beatport, and social channels right before the event. This drives ticket interest and builds hype.\n\nWant me to share some ideas tailored to your lineup?\n\nMax`,
    (name: string, event: string, city: string) =>
      `Hi ${name},\n\nI came across your event listing${event ? ` for "${event}"` : ""} in ${city || "your city"} on RA.\n\nI'm Max, working with PromoSound. We help event promoters by running targeted campaigns for the artists on their lineup — think Spotify playlist pushes, Beatport chart support, and social media amplification.\n\nThe timing window before an event is key. Let me know if you'd like to hear more.\n\nBest regards,\nMax`,
    (name: string, event: string, city: string) =>
      `Hi ${name},\n\nNoticed you have${event ? ` "${event}"` : " an event"} coming up in ${city || "your area"}.\n\nWe run promotion campaigns at PromoSound that help event promoters maximize visibility. By boosting the artists on your bill across key platforms in the weeks before, we help drive awareness and ticket sales.\n\nIf that sounds relevant, I'd be happy to outline a few approaches.\n\nBest,\nMax`,
  ],
};

export const RA_TOUCH2 = {
  subjects: [
    "Re: event promotion",
    "Quick follow-up — your upcoming event",
    "Circling back on promotion support",
    "Following up — still relevant?",
    "Re: your event listing — brief note",
  ],
  bodies: [
    (name: string) =>
      `Hi ${name},\n\nJust wanted to follow up briefly in case my previous message got lost.\n\nThe pre-event window is usually the most effective time for promotion — when audiences are making plans and buying tickets.\n\nIf you're open to it, I can quickly outline how we typically support promoters at this stage.\n\nBest,\nMax`,
    (name: string) =>
      `Hi ${name},\n\nFollowing up quickly — I reached out recently about event promotion support.\n\nWe've helped promoters increase event visibility significantly by running targeted campaigns for their lineup artists in the 2-4 weeks before doors open.\n\nHappy to keep it brief if you'd like to hear the approach.\n\nMax`,
    (name: string) =>
      `Hey ${name},\n\nJust a quick nudge in case my last email slipped through.\n\nYour event is approaching and there's still a good window to boost visibility. We work with promoters at exactly this stage.\n\nLet me know if worth a quick chat.\n\nBest,\nMax`,
    (name: string) =>
      `Hi ${name},\n\nWanted to circle back briefly. I wrote to you recently about pre-event promotion.\n\nNo pressure at all — just wanted to make sure you saw the offer.\n\nCheers,\nMax`,
    (name: string) =>
      `Hi ${name},\n\nShort follow-up — I mentioned PromoSound a few days back regarding your event.\n\nIf you're still looking to push visibility, we could potentially help. If the timing isn't right, totally understand.\n\nBest,\nMax`,
  ],
};

export const RA_TOUCH3 = {
  subjects: [
    "Should I close the loop?",
    "Last check-in — no worries either way",
    "One final note",
    "Closing out — best of luck with the event",
    "Final follow-up from PromoSound",
  ],
  bodies: [
    (name: string) =>
      `Hi ${name},\n\nI'll keep this short — just wanted to check once more before I step back.\n\nIf event promotion is something you'd like to explore for this or future events, I'd be glad to connect.\n\nIf now isn't the right time, no worries — wishing you a packed house.\n\nBest,\nMax`,
    (name: string) =>
      `Hi ${name},\n\nThis will be my last note — don't want to crowd your inbox.\n\nIf you ever want promotion support for future events, feel free to reach out anytime.\n\nWishing you all the best.\n\nMax`,
    (name: string) =>
      `Hey ${name},\n\nFinal check-in. If this isn't the right time, I completely get it.\n\nThe door's always open for future events. Keep up the great work.\n\nCheers,\nMax`,
    (name: string) =>
      `Hi ${name},\n\nClosing the loop on my earlier messages. No hard feelings if it's not a fit.\n\nFor future events — I'm an email away.\n\nAll the best,\nMax`,
    (name: string) =>
      `Hi ${name},\n\nLast note from me. Feel free to get in touch whenever you have an event that could use a promotion boost.\n\nGood luck with everything.\n\nBest,\nMax`,
  ],
};

/** Hash promoter ID for deterministic variant selection */
export function hashPromoterId(id: number): number {
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
