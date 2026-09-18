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
const GEOCODER_BASE_URL =
  process.env.SPECTRA_GEOCODER_BASE_URL ||
  'https://nominatim.openstreetmap.org';

export interface CityStateLocation {
  latitude: number;
  longitude: number;
  displayName: string;
  city: string;
  state: string;
  accuracyMeters: number;
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

  const commaSeparated = text.match(/^(.{2,100}?),\s*([A-Za-z]{2})$/);
  if (commaSeparated) {
    const state = normalizeState(commaSeparated[2]);
    const city = cleanCity(commaSeparated[1]);
    if (state && city.length >= 2) return { city, state, query: `${city}, ${state}` };
  }

  const compactCode = text.match(/^([A-Za-z][A-Za-z.'\-]*(?:\s+[A-Za-z][A-Za-z.'\-]*){0,2})\s+([A-Za-z]{2})$/);
  if (compactCode && !/\b(?:phone|email|employer|company|works?|born|age)\b/i.test(text)) {
    const state = normalizeState(compactCode[2]);
    const city = cleanCity(compactCode[1]);
    if (state && city.length >= 2) return { city, state, query: `${city}, ${state}` };
  }

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

export function extractFreeformLocationHint(input: string): string | null {
  const text = normalizeSpaces(input);
  if (!text || /https?:\/\//i.test(text) || /@/.test(text)) return null;

  const labeledCity = text.match(
    /\bcity\s*[:=]?\s*([A-Za-z][A-Za-z.'\- ]{1,80}?)(?=\s+(?:state|province|country)\b|[,;]|$)/i,
  );
  const labeledState = text.match(
    /\b(?:state|province)\s*[:=]?\s*([A-Za-z][A-Za-z.'\- ]{1,60}?)(?=\s+country\b|[,;]|$)/i,
  );
  const labeledCountry = text.match(
    /\bcountry\s*[:=]?\s*([A-Za-z][A-Za-z.'\- ]{1,60}?)(?=[,;]|$)/i,
  );
  if (labeledCity) {
    return [
      normalizeSpaces(labeledCity[1]),
      labeledState ? normalizeSpaces(labeledState[1]) : '',
      labeledCountry ? normalizeSpaces(labeledCountry[1]) : '',
    ].filter(Boolean).join(', ');
  }

  const contextual = text.match(
    /\b(?:located\s+in|last\s+known\s+(?:in|at)|in|near|around)\s+([^;|]+?)(?=\s+(?:phone|email|employer|works?|age|born)\b|[;|]|$)/i,
  );
  if (contextual) {
    const phrase = normalizeSpaces(contextual[1])
      .replace(/[,.!?]+$/g, '')
      .trim();
    if (
      phrase.length >= 2 &&
      phrase.length <= 120 &&
      !/\d{7,}/.test(phrase)
    ) {
      return phrase;
    }
  }

  return null;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radius = 6_371_000;
  const toRad = Math.PI / 180;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const dPhi = (lat2 - lat1) * toRad;
  const dLambda = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function geocoderAccuracyMeters(
  latitude: number,
  longitude: number,
  boundingbox?: string[],
): number {
  if (!Array.isArray(boundingbox) || boundingbox.length < 4) return 25_000;
  const south = Number(boundingbox[0]);
  const north = Number(boundingbox[1]);
  const west = Number(boundingbox[2]);
  const east = Number(boundingbox[3]);
  if (![south, north, west, east].every(Number.isFinite)) return 25_000;

  const corners = [
    [south, west],
    [south, east],
    [north, west],
    [north, east],
  ] as const;
  const radius = Math.max(
    ...corners.map(([lat, lon]) => haversineMeters(latitude, longitude, lat, lon)),
  );

  // A regional candidate must never visually imply point precision. The
  // geocoder's bounding box becomes its uncertainty radius, with a 1 km floor.
  return Math.max(1_000, Math.min(500_000, radius || 25_000));
}

async function waitForGeocoderSlot(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (lastRequestAt && elapsed < 1000) {
    await new Promise(resolve => setTimeout(resolve, 1000 - elapsed));
  }
  lastRequestAt = Date.now();
}

async function queryGeocoder(url: URL): Promise<Array<{
  lat?: string;
  lon?: string;
  display_name?: string;
  boundingbox?: string[];
}>> {
  await waitForGeocoderSlot();
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'LegalWhat-SPECTRA-Geocoder/1.0',
    },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error('Location service is unavailable.');
  return response.json() as Promise<Array<{
    lat?: string;
    lon?: string;
    display_name?: string;
    boundingbox?: string[];
  }>>;
}

export async function geocodeFreeformLocation(input: string): Promise<CityStateLocation | null> {
  const query = extractFreeformLocationHint(input);
  if (!query) return null;

  const url = new URL('/search', GEOCODER_BASE_URL);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('q', query);

  const results = await queryGeocoder(url);
  const result = results[0];
  const latitude = Number(result?.lat);
  const longitude = Number(result?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    latitude,
    longitude,
    displayName: result?.display_name || query,
    city: query,
    state: '',
    accuracyMeters: geocoderAccuracyMeters(latitude, longitude, result?.boundingbox),
  };
}

export async function geocodeCityState(input: string): Promise<CityStateLocation | null> {
  const hint = extractCityStateHint(input);
  if (!hint) throw new Error('A city and state could not be identified.');

  const url = new URL('/search', GEOCODER_BASE_URL);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('city', hint.city);
  url.searchParams.set('state', hint.state);
  url.searchParams.set('country', 'United States');

  const results = await queryGeocoder(url);
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
    accuracyMeters: geocoderAccuracyMeters(latitude, longitude, result?.boundingbox),
  };
}
