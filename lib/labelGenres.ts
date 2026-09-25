/**
 * Main genre groups for the label database. Beatport (BPTT slugs) and
 * SoundCloud (free-text genre tags) name genres differently; both are folded
 * into one short list so the Labels tab filters the same way for every source.
 * Order matters: the first matching rule wins, so specific ones come first.
 */
export const GENRE_GROUPS = [
  "Techno", "Hard Techno & Hard Dance", "Tech House", "House", "Melodic & Progressive", "Deep & Organic House",
  "Afro House & Amapiano", "Drum & Bass", "Trance", "Bass & Dubstep", "UK Garage & Breaks", "Indie Dance & Electronica",
  "Downtempo & Ambient", "Hip-Hop & Trap", "Pop & Dance-Pop", "R&B", "Latin", "Other",
] as const;

const RULES: [RegExp, (typeof GENRE_GROUPS)[number]][] = [
  [/hard-?techno|hard[- ]?dance|hardcore|hardstyle|neo-?rave|gabber/i, "Hard Techno & Hard Dance"],
  [/tech-?house|jackin|minimal|deep-?tech/i, "Tech House"],
  [/melodic|progressive|mainstage|big room|electro house/i, "Melodic & Progressive"],
  [/organic|deep-?house|lo-?fi house/i, "Deep & Organic House"],
  [/afro|amapiano|african/i, "Afro House & Amapiano"],
  [/techno/i, "Techno"],
  [/drum-?(and|&|-)?-?bass|dnb|d&b|jungle|liquid/i, "Drum & Bass"],
  [/trance|psy/i, "Trance"],
  [/dubstep|bass-?(house|club)|140|grime|riddim|future bass|trap-future|bass music/i, "Bass & Dubstep"],
  [/garage|bassline|breaks|breakbeat|uk-?bass/i, "UK Garage & Breaks"],
  [/indie-?dance|electronica|nu-?disco|disco|electro-classic|funky/i, "Indie Dance & Electronica"],
  [/ambient|downtempo|experimental|chill/i, "Downtempo & Ambient"],
  [/hip-?hop|rap|trap|drill|phonk/i, "Hip-Hop & Trap"],
  [/r-?&?-?b|^rb$|soul/i, "R&B"],
  [/latin|reggaeton|brazilian|funk carioca|baile/i, "Latin"],
  [/pop|dance/i, "Pop & Dance-Pop"],
  [/house/i, "House"],
];

export function genreGroups(raw: string[]): string[] {
  const out = new Set<string>();
  for (const g of raw) {
    if (!g) continue;
    const hit = RULES.find(([re]) => re.test(g));
    out.add(hit ? hit[1] : "Other");
  }
  if (out.size > 1) out.delete("Other");
  return [...out];
}
