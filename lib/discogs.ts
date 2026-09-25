/**
 * Discogs API client for the label database (DISCOGS_TOKEN, a personal access
 * token). Authenticated limit is 60 requests/minute, so calls are spaced.
 * A Discogs label has no country field: the country comes from its contact
 * block (a postal address), matched against country names.
 */
const API = "https://api.discogs.com";
const UA = "NinjaDigger/1.0 +https://ninja-digger.vercel.app";
let lastCall = 0;

async function call<T>(path: string): Promise<T | null> {
  const token = process.env.DISCOGS_TOKEN;
  if (!token) return null;
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  try {
    const r = await fetch(`${API}${path}`, { headers: { "User-Agent": UA, Authorization: `Discogs token=${token}` } });
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 30_000)); return null; }
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch { return null; }
}

export function discogsEnabled(): boolean {
  return !!process.env.DISCOGS_TOKEN;
}

export type DiscogsLabel = {
  id: number; name: string; profile: string; contact_info: string; urls: string[]; uri: string;
  parent_label?: { name: string } | null; sublabels?: { name: string }[];
};

/** Find a label by name; `match` decides whether a search hit is the same label. */
export async function findLabel(name: string, match: (title: string) => boolean): Promise<DiscogsLabel | null> {
  const s = await call<{ results: { id: number; title: string; type: string }[] }>(
    `/database/search?type=label&per_page=10&q=${encodeURIComponent(name)}`
  );
  const hit = s?.results?.find((r) => r.type === "label" && match(r.title));
  if (!hit) return null;
  return call<DiscogsLabel>(`/labels/${hit.id}`);
}

// Country names as they appear in label addresses → ISO code.
const COUNTRY_NAMES: [RegExp, string][] = [
  [/\b(united states|usa|u\.s\.a\.)\b/i, "US"], [/\b(united kingdom|england|scotland|wales|northern ireland|uk|london|glasgow|manchester|bristol)\b/i, "GB"],
  [/\b(germany|deutschland|berlin)\b/i, "DE"], [/\b(netherlands|holland|nederland)\b/i, "NL"], [/\b(belgium|belgique|belgië)\b/i, "BE"],
  [/\bfrance\b/i, "FR"], [/\b(switzerland|schweiz|suisse)\b/i, "CH"], [/\b(austria|österreich)\b/i, "AT"], [/\b(denmark|danmark)\b/i, "DK"],
  [/\b(sweden|sverige)\b/i, "SE"], [/\b(norway|norge)\b/i, "NO"], [/\b(finland|suomi)\b/i, "FI"], [/\biceland\b/i, "IS"],
  [/\bireland\b/i, "IE"], [/\baustralia\b/i, "AU"], [/\bnew zealand\b/i, "NZ"], [/\bcanada\b/i, "CA"], [/\bluxembourg\b/i, "LU"],
  [/\b(spain|españa)\b/i, "ES"], [/\b(italy|italia)\b/i, "IT"], [/\bportugal\b/i, "PT"], [/\bjapan\b/i, "JP"], [/\b(south korea|korea)\b/i, "KR"],
  [/\bsingapore\b/i, "SG"], [/\bisrael\b/i, "IL"], [/\b(united arab emirates|uae|dubai)\b/i, "AE"], [/\b(poland|polska)\b/i, "PL"],
  [/\b(czech republic|czechia)\b/i, "CZ"], [/\bslovakia\b/i, "SK"], [/\bslovenia\b/i, "SI"], [/\bestonia\b/i, "EE"], [/\blatvia\b/i, "LV"],
  [/\blithuania\b/i, "LT"], [/\bcroatia\b/i, "HR"], [/\bgreece\b/i, "GR"], [/\bcyprus\b/i, "CY"], [/\bmalta\b/i, "MT"], [/\bhungary\b/i, "HU"],
  [/\bhong kong\b/i, "HK"], [/\btaiwan\b/i, "TW"], [/\b(brazil|brasil)\b/i, "BR"], [/\b(mexico|méxico)\b/i, "MX"], [/\bargentina\b/i, "AR"],
  [/\bchile\b/i, "CL"], [/\bcolombia\b/i, "CO"], [/\bperu\b/i, "PE"], [/\buruguay\b/i, "UY"], [/\bsouth africa\b/i, "ZA"], [/\bromania\b/i, "RO"],
  [/\bbulgaria\b/i, "BG"], [/\b(turkey|türkiye)\b/i, "TR"], [/\bindia\b/i, "IN"], [/\bthailand\b/i, "TH"], [/\bmalaysia\b/i, "MY"],
  [/\bphilippines\b/i, "PH"], [/\bindonesia\b/i, "ID"], [/\b(ukraine|україна)\b/i, "UA"], [/\b(russia|russian federation|россия)\b/i, "RU"],
  [/\b(belarus|беларусь)\b/i, "BY"], [/\biran\b/i, "IR"], [/\bserbia\b/i, "RS"],
];

/** The country named FIRST in the text: a label lists its head office first (Ninja Tune: London, then its US office). */
export function countryFromAddress(text: string | null | undefined): string | null {
  if (!text) return null;
  let best: { at: number; cc: string } | null = null;
  for (const [re, cc] of COUNTRY_NAMES) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.at)) best = { at: m.index, cc };
  }
  return best?.cc ?? null;
}
