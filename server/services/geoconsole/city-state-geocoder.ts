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
  resolution?: 'address' | 'city_state' | 'freeform';
}

export interface AddressHint {
  street: string;
  city?: string;
  state?: string;
  postalcode?: string;
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeLocationLanguage(value: string): string {
  return normalizeSpaces(value).replace(
    /\b(?:(?:my|his|her|their|our|the)\s+)?(?:(?:last(?:\s+known)?|previous|current)\s+location|last\s+seen)\s*(?:(?:was|is|in|at)\s+|[:=]\s*)/gi,
    'located in ',
  );
}

function normalizeState(value: string): string | null {
  const cleaned = normalizeSpaces(value).replace(/\.$/, '');
  const upper = cleaned.toUpperCase();
  if (STATE_CODES.has(upper)) return upper;
  return STATE_ABBREVIATIONS[cleaned.toLowerCase()] || null;
}

function cleanCity(value: string): string {
  return normalizeSpaces(value)
    .replace(/^(?:in|at|from|near|around|city of|located in|last known (?:in|at))\s+/i, '')
    .replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, '')
    .trim();
}

const STREET_SUFFIX_RE = '(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|circle|cir|parkway|pkwy|highway|hwy|way|place|pl|terrace|ter|trail|trl)';
const STREET_ADDRESS_RE = new RegExp(
  '\\b(\\d{1,7}[A-Za-z]?(?:[-/]\\d{1,7}[A-Za-z]?)?\\s+(?:[NSEW]\\.?\\s+)?[A-Za-z0-9][A-Za-z0-9 .\'’-]{0,70}?\\s+' + STREET_SUFFIX_RE + '\\.?)(?:\\s+(?:apt|apartment|unit|suite|ste|#)\\s*[A-Za-z0-9-]+)?\\b',
  'i',
);

export function extractStreetAddressHint(input: string): AddressHint | null {
  const text = normalizeSpaces(input);
  const streetMatch = STREET_ADDRESS_RE.exec(text);
  const street = streetMatch?.[1]?.trim();
  if (!streetMatch || !street) return null;
  const streetStart = streetMatch.index;
  const afterStreet = text.slice(streetStart + streetMatch[0].length)
    .replace(/^[,;\s]+/, '')
    .replace(/^(?:apt|apartment|unit|suite|ste|#)\s*[A-Za-z0-9-]+\s*[,;]\s*/i, '');
  const regional = extractCityStateHint(afterStreet) || extractCityStateHint(text.slice(0, streetStart));
  const zip = text.match(/\b\d{5}(?:-\d{4})?\b/)?.[0];
  return {
    street,
    city: regional?.city,
    state: regional?.state,
    postalcode: zip,
  };
}

export function extractLocationClues(input: string): string[] {
  const text = normalizeSpaces(input);
  if (!text) return [];
  const clues: string[] = [];
  const address = extractStreetAddressHint(text);
  const regional = extractCityStateHint(text);
  if (address) {
    clues.push([address.street, address.city, address.state, address.postalcode].filter(Boolean).join(', '));
    clues.push(address.street);
  }
  if (regional) clues.push(regional.query);
  const contextual = extractFreeformLocationHint(text);
  if (contextual) clues.push(contextual);
  return [...new Set(clues.map(value => normalizeSpaces(value)).filter(Boolean))];
}

export function extractCityStateHint(input: string): { city: string; state: string; query: string } | null {
  const text = normalizeLocationLanguage(input);
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

    // Prefer an explicit place clause over treating preceding conversation
    // text as part of the city, including when the state ends the message.
    const explicitLocation = before.match(
      /\b(?:located\s+in|last\s+known\s+(?:in|at)|in|at|from|near|around|city(?:\s+of)?)\s+([A-Za-z][A-Za-z.'\-]*(?:\s+[A-Za-z][A-Za-z.'\-]*){0,3})\s*,?\s*$/i,
    );
    if (explicitLocation) {
      const city = cleanCity(explicitLocation[1]);
      if (city.length >= 2 && city.length <= 100) return { city, state, query: `${city}, ${state}` };
    }

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
      /(?:^|[,;.])\s*([A-Za-z][A-Za-z.'\-]*(?:\s+[A-Za-z][A-Za-z.'\-]*){0,3})\s*$/i,
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
    // In conversation these codes are also ordinary words. Require geographic
    // context instead of interpreting "Show me" as the city "Show" in Maine.
    // Whole city/state hints have already been handled above.
    if (
      /^(?:IN|ME|OR|HI|OK)$/i.test(match[1]) &&
      !/(?:[,;.]|\b(?:located\s+in|last\s+known\s+(?:in|at)|in|at|from|near|around|city(?:\s+of)?)\s+[A-Za-z][A-Za-z.'\-]*(?:\s+[A-Za-z][A-Za-z.'\-]*){0,3})\s*$/i.test(before)
    ) continue;
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
      !/\d{7,}/.test(phrase) &&
      !/^(?:(?:my|your|his|her|their|our|the)\s+)?(?:contacts|emails?|inbox|files?|photos?|pictures?|browser|history|accounts?|messages|records|documents)\b/i.test(phrase)
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

// Provider data is untrusted. Number(null) and Number('') both produce zero,
// which would invent a coordinate even when the response contains no fix.
function parseGeocoderCoordinates(
  rawLatitude: unknown,
  rawLongitude: unknown,
): { latitude: number; longitude: number } | null {
  const coordinate = (value: unknown): number | null => {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const latitude = coordinate(rawLatitude);
  const longitude = coordinate(rawLongitude);
  if (
    latitude === null || Math.abs(latitude) > 90 ||
    longitude === null || Math.abs(longitude) > 180
  ) return null;
  return { latitude, longitude };
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
  if (
    ![south, north, west, east].every(Number.isFinite) ||
    Math.abs(south) > 90 || Math.abs(north) > 90 ||
    Math.abs(west) > 180 || Math.abs(east) > 180 ||
    south > north
  ) return 25_000;

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

const geocoderCache = new Map<string, { expiresAt: number; results: Array<{ lat?: string; lon?: string; display_name?: string; boundingbox?: string[] }> }>();

async function queryGeocoder(url: URL, strategy = 'unknown'): Promise<Array<{
  lat?: string;
  lon?: string;
  display_name?: string;
  boundingbox?: string[];
}>> {
  const cacheKey = url.toString();
  const cached = geocoderCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.results;
  await waitForGeocoderSlot();
  let response: Response;
  try {
    response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'LegalWhat-SPECTRA-Geocoder/1.0',
    },
      signal: AbortSignal.timeout(7000),
    });
  } catch (error) {
    const errorType = error instanceof Error ? error.name : 'unknown';
    console.warn('[SPECTRA_GEOCODER] request_failed', { strategy, errorType });
    throw error;
  }
  if (!response.ok) {
    console.warn('[SPECTRA_GEOCODER] http_error', { strategy, status: response.status });
    throw new Error('Location service is unavailable.');
  }
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    console.warn('[SPECTRA_GEOCODER] invalid_payload', { strategy });
    throw new Error('Location service returned invalid data.');
  }
  const results = payload as Array<{
    lat?: string;
    lon?: string;
    display_name?: string;
    boundingbox?: string[];
  }>;
  // Malformed provider payloads must never enter the response cache.
  geocoderCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, results });
  if (results.length === 0) console.info('[SPECTRA_GEOCODER] no_match', { strategy });
  else console.info('[SPECTRA_GEOCODER] matched', { strategy, resultCount: results.length });
  return results;
}

export async function geocodeFreeformLocation(input: string): Promise<CityStateLocation | null> {
  const query = extractFreeformLocationHint(input);
  if (!query) return null;

  const url = new URL('/search', GEOCODER_BASE_URL);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('q', query);

  const results = await queryGeocoder(url, 'freeform');
  const result = results[0];
  const coordinates = parseGeocoderCoordinates(result?.lat, result?.lon);
  if (!coordinates) return null;
  const { latitude, longitude } = coordinates;

  return {
    latitude,
    longitude,
    displayName: result?.display_name || query,
    city: query,
    state: '',
    accuracyMeters: geocoderAccuracyMeters(latitude, longitude, result?.boundingbox),
    resolution: 'freeform',
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

  const results = await queryGeocoder(url, 'city_state');
  const result = results[0];
  const coordinates = parseGeocoderCoordinates(result?.lat, result?.lon);
  if (!coordinates) return null;
  const { latitude, longitude } = coordinates;

  return {
    latitude,
    longitude,
    displayName: result?.display_name || hint.query,
    city: hint.city,
    state: hint.state,
    accuracyMeters: geocoderAccuracyMeters(latitude, longitude, result?.boundingbox),
    resolution: 'city_state',
  };
}


async function queryCensusAddressGeocoder(address: AddressHint): Promise<CityStateLocation | null> {
  const oneLine = [
    address.street,
    address.city,
    address.state,
    address.postalcode,
  ].filter(Boolean).join(', ');
  if (!oneLine) return null;

  const endpoint = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
  endpoint.searchParams.set('address', oneLine);
  endpoint.searchParams.set('benchmark', 'Public_AR_Current');
  endpoint.searchParams.set('format', 'json');

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'LegalWhat-SPECTRA-Geocoder/1.0',
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return null;
    const payload: any = await response.json();
    const match = payload?.result?.addressMatches?.[0];
    const coordinates = parseGeocoderCoordinates(
      match?.coordinates?.y,
      match?.coordinates?.x,
    );
    if (!coordinates) return null;
    const { latitude, longitude } = coordinates;

    return {
      latitude,
      longitude,
      displayName: String(match?.matchedAddress || oneLine),
      city: address.city || '',
      state: address.state || '',
      // Census street coordinates are address-range interpolations. Preserve
      // uncertainty instead of presenting them as device-level point fixes.
      accuracyMeters: 250,
      resolution: 'address',
    };
  } catch {
    return null;
  }
}

export async function geocodeBestLocation(input: string): Promise<CityStateLocation | null> {
  const text = normalizeSpaces(input);
  if (!text) return null;

  const address = extractStreetAddressHint(text);
  if (address) {
    const structured = new URL('/search', GEOCODER_BASE_URL);
    structured.searchParams.set('format', 'jsonv2');
    structured.searchParams.set('limit', '1');
    structured.searchParams.set('addressdetails', '1');
    structured.searchParams.set('street', address.street);
    if (address.city) structured.searchParams.set('city', address.city);
    if (address.state) structured.searchParams.set('state', address.state);
    if (address.postalcode) structured.searchParams.set('postalcode', address.postalcode);
    structured.searchParams.set('country', 'United States');

    try {
      const results = await queryGeocoder(structured, 'structured_address');
      const result = results[0];
      const coordinates = parseGeocoderCoordinates(result?.lat, result?.lon);
      if (coordinates) {
        const { latitude, longitude } = coordinates;
        return {
          latitude,
          longitude,
          displayName: result?.display_name || [address.street, address.city, address.state].filter(Boolean).join(', '),
          city: address.city || '',
          state: address.state || '',
          accuracyMeters: geocoderAccuracyMeters(latitude, longitude, result?.boundingbox),
          resolution: 'address',
        };
      }
    } catch {
      // Failure is isolated; the independent Census address lane remains available.
    }

    const censusAddress = await queryCensusAddressGeocoder(address);
    if (censusAddress) return censusAddress;
  }

  try {
    const regional = await geocodeCityState(text);
    if (regional) return regional;
  } catch {
    // Not every clue contains city/state. Continue to free-form interpretation.
  }

  for (const clue of extractLocationClues(text)) {
    try {
      const direct = new URL('/search', GEOCODER_BASE_URL);
      direct.searchParams.set('format', 'jsonv2');
      direct.searchParams.set('limit', '1');
      direct.searchParams.set('addressdetails', '1');
      direct.searchParams.set('q', clue);
      const results = await queryGeocoder(direct, 'normalized_freeform');
      const result = results[0];
      const coordinates = parseGeocoderCoordinates(result?.lat, result?.lon);
      if (coordinates) {
        const { latitude, longitude } = coordinates;
        return {
          latitude,
          longitude,
          displayName: result?.display_name || clue,
          city: '',
          state: '',
          accuracyMeters: geocoderAccuracyMeters(latitude, longitude, result?.boundingbox),
          resolution: 'freeform',
        };
      }
    } catch {
      // One interpretation/provider attempt must not discard the clue.
    }
  }

  console.info('[SPECTRA_GEOCODER] clue_unresolved', {
    hasStreetAddress: Boolean(address),
    clueCount: extractLocationClues(text).length,
  });
  return null;
}
