const STATE_ABBREVIATIONS: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC',
};

const STATE_CODES = new Set(Object.values(STATE_ABBREVIATIONS));
const STATE_NAMES = Object.keys(STATE_ABBREVIATIONS).sort((a, b) => b.length - a.length);
let lastRequestAt = 0;

export interface CityStateLocation {
  latitude: number;
  longitude: number;
  displayName: string;
  city: string;
  state: string;
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeState(value: string): string | null {
  const cleaned = normalizeSpaces(value).replace(/\.$/, '');
  const upper = cleaned.toUpperCase();
  if (STATE_CODES.has(upper)) return upper;
  return STATE_ABBREVIATIONS[cleaned.toLowerCase()] || null;
}

function cleanCity(value: string): string {
  return normalizeSpaces(value)
    .replace(/^(?:in|at|from|near|around|city of|located in)\s+/i, '')
    .replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, '')
    .trim();
}

export function extractCityStateHint(input: string): { city: string; state: string; query: string } | null {
  const text = normalizeSpaces(input);
  if (!text) return null;

  const direct = text.match(/^(.{2,100}?)[,\s]+([A-Za-z]{2})$/);
  if (direct) {
    const state = normalizeState(direct[2]);
    const city = cleanCity(direct[1]);
    if (state && city.length >= 2) return { city, state, query: `${city}, ${state}` };
  }

  const lower = text.toLowerCase();
  for (const stateName of STATE_NAMES) {
    const stateRegex = new RegExp(`\\b${stateName.replace(/ /g, '\\s+')}\\b`, 'i');
    const stateMatch = stateRegex.exec(text);
    if (!stateMatch) continue;

    const state = STATE_ABBREVIATIONS[stateName];
    const before = text.slice(0, stateMatch.index).trim();
    const after = text.slice(stateMatch.index + stateMatch[0].length).trim();

    // "Sanborn Iowa" / "Sanborn, Iowa" as the whole supplied hint.
    if (!after) {
      const directCity = cleanCity(before.replace(/[,;]\s*$/, ''));
      if (
        directCity.length >= 2 &&
        directCity.length <= 100 &&
        !/\b(?:phone|email|employer|company|works?|born|age)\b/i.test(directCity)
      ) {
        return { city: directCity, state, query: `${directCity}, ${state}` };
      }
    }

    // Within a longer sentence, require explicit location language so a state
    // name used in an employer/person name is not mistaken for geography.
    const cityMatch = before.match(
      /(?:^|[,;.]|\b(?:in|at|from|near|around|city(?:\s+of)?)\s+)([A-Za-z][A-Za-z.'\-]*(?:\s+[A-Za-z][A-Za-z.'\-]*){0,3})\s*$/i,
    );
    const city = cleanCity(cityMatch?.[1] || '');
    if (city.length >= 2 && city.length <= 100) {
      return { city, state, query: `${city}, ${state}` };
    }
  }

  const codePattern = /\b([A-Z]{2})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = codePattern.exec(text))) {
    const state = normalizeState(match[1]);
    if (!state) continue;
    const before = text.slice(0, match.index).trim();
    const cityMatch = before.match(/(?:^|[,;.]|\b(?:in|at|from|near|around|city(?:\s+of)?)\s+)([A-Za-z][A-Za-z.'\-]*(?:\s+[A-Za-z][A-Za-z.'\-]*){0,3})\s*$/i);
    const city = cleanCity(cityMatch?.[1] || '');
    if (city.length >= 2 && city.length <= 100) return { city, state, query: `${city}, ${state}` };
  }

  return null;
}

export async function geocodeCityState(input: string): Promise<CityStateLocation | null> {
  const hint = extractCityStateHint(input);
  if (!hint) throw new Error('A city and state could not be identified.');

  const elapsed = Date.now() - lastRequestAt;
  if (lastRequestAt && elapsed < 1000) {
    await new Promise(resolve => setTimeout(resolve, 1000 - elapsed));
  }

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('city', hint.city);
  url.searchParams.set('state', hint.state);
  url.searchParams.set('country', 'United States');

  lastRequestAt = Date.now();
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'LegalWhat-SPECTRA-Geocoder/1.0',
    },
  });
  if (!response.ok) throw new Error('Location service is unavailable.');

  const results = await response.json() as Array<{ lat?: string; lon?: string; display_name?: string }>;
  const result = results[0];
  const latitude = Number(result?.lat);
  const longitude = Number(result?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    latitude,
    longitude,
    displayName: result?.display_name || hint.query,
    city: hint.city,
    state: hint.state,
  };
}
