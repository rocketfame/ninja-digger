/**
 * RA Outreach — email templates for event promoter groups.
 * Focus: boost "attending/interested" on RA → higher ranking → organic discovery.
 * 5 variants per touch, deterministic selection per promoter.
 */

export const RA_SIGNATURE = `\n\n--\nWith Regards, your Promosound.\nhttps://promosoundgroup.net/`;

export const RA_TOUCH1 = {
  subjects: [
    "Your upcoming event on RA",
    "Quick idea for your RA listing",
    "Boost your event visibility on RA",
    "Stand out on Resident Advisor",
    "Your event on RA",
  ],
  bodies: [
    (name: string, _event: string, city: string) =>
      `Hi ${name},\n\nNoticed your event in ${city || "your city"} on Resident Advisor.\n\nWe help promoters boost the number of "attending" and "interested" on their RA listings. More engagement means your event ranks higher, gets seen by more people, and looks significantly stronger next to competing events.\n\nHappy to share how it works if you're interested.\n\nBest,\nMax`,
    (name: string, _event: string, city: string) =>
      `Hi ${name},\n\nSaw your event coming up in ${city || "your area"}.\n\nI'm Max from PromoSound. We run campaigns that increase the "interested" count on RA event pages, which pushes your event higher in search results and makes it stand out to new audiences browsing the platform.\n\nLet me know if you'd like to hear more.\n\nCheers,\nMax`,
    (name: string, _event: string, city: string) =>
      `Hey ${name},\n\nYour event in ${city || "your city"} caught my eye on RA.\n\nWe help promoters grow their event's engagement metrics on Resident Advisor. More "attending" signals means better ranking, more organic discovery, and a much stronger impression compared to other events in your area.\n\nWant me to outline how this works?\n\nMax`,
    (name: string, _event: string, city: string) =>
      `Hi ${name},\n\nCame across your upcoming event in ${city || "your area"}.\n\nAt PromoSound, we specialize in boosting RA event engagement, driving up the "attending/interested" numbers so your event climbs in rankings and catches more eyes organically.\n\nIf that sounds relevant, I'd be happy to explain the approach.\n\nBest regards,\nMax`,
    (name: string, _event: string, city: string) =>
      `Hi ${name},\n\nSpotted your event listing in ${city || "your area"} on RA.\n\nWe work with promoters to amplify their event's visibility on Resident Advisor by increasing engagement metrics. Higher numbers, better ranking, more organic reach from people browsing events in your area.\n\nInterested in learning more?\n\nBest,\nMax`,
  ],
};

export const RA_TOUCH2 = {
  subjects: [
    "Re: your RA event",
    "Quick follow-up",
    "Circling back on your event",
    "Following up",
    "Re: RA event visibility",
  ],
  bodies: [
    (name: string) =>
      `Hi ${name},\n\nJust wanted to follow up briefly in case my previous message got lost.\n\nThe window before an event is when RA engagement matters most. Higher "attending" numbers now means better visibility when people are making weekend plans.\n\nIf you're open to it, I can quickly outline how it works.\n\nBest,\nMax`,
    (name: string) =>
      `Hi ${name},\n\nFollowing up quickly. We've helped promoters significantly increase their RA event rankings by boosting engagement metrics in the weeks before the event.\n\nHappy to keep it brief if you'd like to hear the approach.\n\nMax`,
    (name: string) =>
      `Hey ${name},\n\nJust a quick nudge in case my last email slipped through.\n\nYour event is approaching and there's still a good window to boost your RA visibility.\n\nLet me know if worth a quick chat.\n\nBest,\nMax`,
    (name: string) =>
      `Hi ${name},\n\nWanted to circle back briefly. I wrote to you recently about boosting your event's RA engagement.\n\nNo pressure at all, just wanted to make sure you saw the offer.\n\nCheers,\nMax`,
    (name: string) =>
      `Hi ${name},\n\nShort follow-up. If you're still looking to push visibility for your event on RA, we could help. If the timing isn't right, totally understand.\n\nBest,\nMax`,
  ],
};

export const RA_TOUCH3 = {
  subjects: [
    "Should I close the loop?",
    "Last check-in",
    "One final note",
    "Closing out",
    "Final follow-up",
  ],
  bodies: [
    (name: string) =>
      `Hi ${name},\n\nI'll keep this short. Just wanted to check once more before I step back.\n\nIf boosting your RA event visibility is something you'd like to explore for this or future events, I'd be glad to connect.\n\nIf now isn't the right time, no worries. Wishing you a packed house.\n\nBest,\nMax`,
    (name: string) =>
      `Hi ${name},\n\nThis will be my last note. Don't want to crowd your inbox.\n\nIf you ever want to boost engagement on your RA listings, feel free to reach out anytime.\n\nAll the best.\n\nMax`,
    (name: string) =>
      `Hey ${name},\n\nFinal check-in. If this isn't the right time, I completely get it.\n\nThe door's always open for future events.\n\nCheers,\nMax`,
    (name: string) =>
      `Hi ${name},\n\nClosing the loop on my earlier messages. No hard feelings if it's not a fit.\n\nFor future events, I'm an email away.\n\nAll the best,\nMax`,
    (name: string) =>
      `Hi ${name},\n\nLast note from me. Feel free to get in touch whenever you have an event that could use a visibility boost on RA.\n\nGood luck with everything.\n\nBest,\nMax`,
  ],
};

export function hashPromoterId(id: number): number {
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
