/**
 * Список жанрів з BP Top Tracker (Beatport). Slug = URL на bptoptracker.com: /top/track/{slug}/{date}.
 * Оновлено за повним списком жанрів з сайту.
 */

export const BPTOPTRACKER_GENRES: { value: string; label: string }[] = [
  { value: "140-deep-dubstep-grime", label: "140 / Deep Dubstep / Grime" },
  { value: "african", label: "African" },
  { value: "afro-house", label: "Afro House" },
  { value: "ambient-experimental", label: "Ambient / Experimental" },
  { value: "amapiano", label: "Amapiano" },
  { value: "bass-club", label: "Bass / Club" },
  { value: "bass-house", label: "Bass House" },
  { value: "brazilian-funk", label: "Brazilian Funk" },
  { value: "breaks-breakbeat-uk-bass", label: "Breaks / Breakbeat / UK Bass" },
  { value: "caribbean", label: "Caribbean" },
  { value: "country", label: "Country" },
  { value: "dance-pop", label: "Dance / Pop" },
  { value: "deep-house", label: "Deep House" },
  { value: "dj-tools-acapellas", label: "DJ Tools / Acapellas" },
  { value: "downtempo", label: "Downtempo" },
  { value: "drum-bass", label: "Drum & Bass" },
  { value: "dubstep", label: "Dubstep" },
  { value: "electro-classic-detroit-modern", label: "Electro (Classic / Detroit / Modern)" },
  { value: "electronica", label: "Electronica" },
  { value: "funky-house", label: "Funky House" },
  { value: "global", label: "Global" },
  { value: "hard-dance-hardcore-neo-rave", label: "Hard Dance / Hardcore / Neo Rave" },
  { value: "hard-techno", label: "Hard Techno" },
  { value: "hip-hop", label: "Hip-Hop" },
  { value: "house", label: "House" },
  { value: "indie-dance", label: "Indie Dance" },
  { value: "jackin-house", label: "Jackin House" },
  { value: "latin", label: "Latin" },
  { value: "mainstage", label: "Mainstage" },
  { value: "melodic-house-and-techno", label: "Melodic House & Techno" },
  { value: "minimal-deep-tech", label: "Minimal / Deep Tech" },
  { value: "nu-disco-disco", label: "Nu Disco / Disco" },
  { value: "organic-house", label: "Organic House" },
  { value: "pop", label: "Pop" },
  { value: "progressive-house", label: "Progressive House" },
  { value: "psy-trance", label: "Psy-Trance" },
  { value: "r-b", label: "R&B" },
  { value: "rock", label: "Rock" },
  { value: "tech-house", label: "Tech House" },
  { value: "techno-peak-time-driving", label: "Techno (Peak Time / Driving)" },
  { value: "techno-raw-deep-hypnotic", label: "Techno (Raw / Deep / Hypnotic)" },
  { value: "trance-main-floor", label: "Trance (Main Floor)" },
  { value: "trance-raw-deep-hypnotic", label: "Trance (Raw / Deep / Hypnotic)" },
  { value: "trap-future-bass", label: "Trap / Future Bass" },
  { value: "uk-garage-bassline", label: "UK Garage / Bassline" },
];

export function getBptoptrackerGenreSlugs(): string[] {
  return BPTOPTRACKER_GENRES.map((g) => g.value);
}
