/**
 * Outreach copy generator: every email is assembled from component pools
 * (greeting x observation x pitch x CTA x closing), so no two sends share a
 * template fingerprint. Pools rotate weekly (ISO-week seed) so the copy set
 * drifts on its own. No em-dashes anywhere by design.
 */

function weekSeed(): number {
  return Math.floor(Date.now() / (7 * 86400e3));
}

function pick<T>(pool: T[]): T {
  // Weekly offset biases which slice of the pool is "active" this week,
  // randomness inside keeps every send unique
  const offset = weekSeed() % pool.length;
  const idx = (offset + Math.floor(Math.random() * pool.length)) % pool.length;
  return pool[idx];
}

const GREETINGS = ["Hi", "Hey", "Hello"];

const T1_SUBJECTS = [
  "Congrats on your recent Beatport chart entry | Promosound",
  "Noticed your Beatport chart movement",
  "Your track is climbing, quick thought",
  "Beatport charts + a brief idea for you",
  "Saw your chart entry, wanted to reach out",
  "Quick note about your Beatport entry",
  "Your Beatport momentum caught my eye",
  "About your track in the charts",
];
const T1_OPENINGS = [
  "Saw your recent appearance in the Beatport charts. Great move.",
  "Noticed your track charting on Beatport, well deserved.",
  "Your Beatport chart entry caught my attention, impressive stuff.",
  "Congrats on the Beatport chart placement, that is a solid milestone.",
  "Just spotted your track climbing the Beatport charts, nice work.",
  "Came across your track in the Beatport charts today and wanted to reach out.",
  "Your entry in the Beatport charts stood out to me this week.",
];
const T1_PITCHES = [
  "I'm Max from PromoSound. We work with electronic artists right when momentum starts building, helping extend that visibility across platforms.",
  "I'm Max, working with PromoSound. We help artists amplify chart momentum through targeted promotion across key platforms.",
  "At PromoSound we specialize in exactly this stage: the window right after a chart entry, when extra exposure compounds.",
  "I run promotion campaigns at PromoSound and we have had good results helping artists leverage chart momentum while it is still fresh.",
  "I'm Max from PromoSound. Artists usually come to us at exactly this point, when a release starts moving and deserves a bigger push.",
];
const T1_CTAS = [
  "If you're planning to push this release further, I'd be happy to share a few ideas tailored to your current stage.",
  "Would love to share a couple of ideas if you're looking to build on this wave.",
  "Happy to outline a few options if that sounds relevant.",
  "Let me know if you'd like to hear how we approach it.",
  "Open to a quick exchange of ideas if the timing works for you.",
];

const T2_SUBJECTS = [
  "Re: chart momentum",
  "Quick follow-up on my previous note",
  "Circling back on your Beatport momentum",
  "Following up, still relevant?",
  "Re: your chart entry, brief follow-up",
  "One more thought on your chart run",
];
const T2_OPENINGS = [
  "Congrats again on charting on Beatport, genuinely a strong result. Just circling back on my note.",
  "Still think that Beatport chart run of yours deserves a shout, quick follow-up in case my last email got buried.",
  "Making the Beatport charts is no small thing, so congrats again. Wanted to nudge you on what I mentioned.",
  "Seeing your track in the Beatport charts is what made me want to follow up, momentum like that is worth acting on.",
  "Congrats on the chart placement again, a short follow-up in case my previous message slipped through.",
];
const T2_PITCHES = [
  "When a track starts moving in the charts, there is usually a short window where additional exposure can significantly amplify results.",
  "The timing window for amplifying chart momentum is usually pretty short, so wanted to make sure this landed on your radar.",
  "Your track is still in a great position to benefit from targeted promotion. We have seen similar artists extend their chart run significantly at this stage.",
  "We work with artists at exactly this stage, when there is real chart traction to build on.",
];
const T2_CTAS = [
  "If you're open to it, I can outline how we typically approach this stage for electronic releases.",
  "Happy to keep it brief if you'd like to hear the approach.",
  "Reply and I will send the details.",
  "No pressure, just wanted to make sure you saw the offer.",
  "If the timing isn't right, totally understand.",
];

const T3_SUBJECTS = [
  "Should I close the loop?",
  "Last check-in, no worries either way",
  "One final note before I step back",
  "Closing out, best of luck with the release",
  "Final follow-up from PromoSound",
];
const T3_OPENINGS = [
  "I'll keep this short. Just wanted to check once more before I step back.",
  "This will be my last note, I don't want to crowd your inbox.",
  "Just a final check-in. If this isn't the right time, I completely get it.",
  "Closing the loop on my earlier messages. No hard feelings if it's not a fit right now.",
  "Last note from me, I will step back after this.",
];
const T3_CTAS = [
  "If building on your recent chart momentum is something you'd like to explore, I'd be glad to connect. If now isn't the right time, no worries at all.",
  "If you ever want to explore promotion support for a future release, feel free to reach out anytime.",
  "The door's always open if you'd like to work together down the line. Keep up the great work.",
  "If a future release hits the charts and you'd like a promotion partner, I'm an email away.",
  "If supporting your chart momentum is something you'd like to revisit later, feel free to get in touch whenever.",
];
const T3_WISHES = [
  "Wishing you continued success with the release.",
  "Wishing you all the best with your music.",
  "Good luck with everything.",
  "All the best with the release.",
];

const CLOSINGS = ["Best,\nMax", "Cheers,\nMax", "Best regards,\nMax", "Max"];

export function buildTouchEmail(touchNum: number, artistName: string): { subject: string; text: string } {
  const g = pick(GREETINGS);
  const close = pick(CLOSINGS);
  if (touchNum === 1) {
    return {
      subject: pick(T1_SUBJECTS),
      text: `${g} ${artistName},\n\n${pick(T1_OPENINGS)}\n\n${pick(T1_PITCHES)}\n\n${pick(T1_CTAS)}\n\n${close}`,
    };
  }
  if (touchNum === 2) {
    return {
      subject: pick(T2_SUBJECTS),
      text: `${g} ${artistName},\n\n${pick(T2_OPENINGS)}\n\n${pick(T2_PITCHES)}\n\n${pick(T2_CTAS)}\n\n${close}`,
    };
  }
  return {
    subject: pick(T3_SUBJECTS),
    text: `${g} ${artistName},\n\n${pick(T3_OPENINGS)}\n\n${pick(T3_CTAS)}\n\n${pick(T3_WISHES)}\n\n${close}`,
  };
}

/** Current weekly copy-set index, for reports. */
export function copyWeekIndex(): number {
  return weekSeed();
}
