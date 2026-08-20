const CITY_STATE_PATTERN = /^\s*([^,]{2,100})\s*,\s*([A-Za-z]{2})\s*$/;
let lastRequestAt = 0;

export interface CityStateLocation {
  latitude: number;
  longitude: number;
  displayName: string;
}

export async function geocodeCityState(input: string): Promise<CityStateLocation | null> {
  const match = input.match(CITY_STATE_PATTERN);
  if (!match) throw new Error('Enter the last known location as City, ST.');

  const city = match[1].trim();
  const state = match[2].toUpperCase();
  const elapsed = Date.now() - lastRequestAt;
  if (lastRequestAt && elapsed < 1000) {
    await new Promise(resolve => setTimeout(resolve, 1000 - elapsed));
  }

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('city', city);
  url.searchParams.set('state', state);
  url.searchParams.set('country', 'United States');

  lastRequestAt = Date.now();
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'LegalWhat-CityStateGeocoder/1.0',
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
    displayName: result?.display_name || `${city}, ${state}`,
  };
}