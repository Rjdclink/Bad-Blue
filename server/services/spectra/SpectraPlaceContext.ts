import { acquireSpectraPublicInfrastructureContext } from './SpectraPublicInfrastructureContext';
import { acquireSpectraHootenannyContext } from './SpectraHootenannyContext';

export interface SpectraPlaceContextItem {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  provider:
    | 'OpenStreetMap Overpass'
    | 'GeoNames'
    | 'FCC Antenna Structure Registration'
    | 'NOAA CORS Network'
    | 'Hootenanny';
  category?: string;
  metadata?: Record<string, unknown>;
}

function validCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

async function overpassNearbyPlaces(
  latitude: number,
  longitude: number,
  radiusMeters: number,
): Promise<SpectraPlaceContextItem[]> {
  const radius = Math.round(Math.max(50, Math.min(3_000, radiusMeters)));
  const query = [
    '[out:json][timeout:5];',
    '(',
    `nwr(around:${radius},${latitude},${longitude})["name"];`,
    ');',
    'out center tags 100;',
  ].join('');

  const endpoint = new URL('https://overpass-api.de/api/interpreter');
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': 'LegalWhat-SPECTRA/1.0',
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok) return [];

    const payload: any = await response.json();
    const elements = Array.isArray(payload?.elements) ? payload.elements : [];
    return elements.flatMap((element: any) => {
      const lat = Number(element?.lat ?? element?.center?.lat);
      const lon = Number(element?.lon ?? element?.center?.lon);
      if (!validCoordinate(lat, lon)) return [];

      const tags = element?.tags && typeof element.tags === 'object' ? element.tags : {};
      return [{
        id: `${String(element?.type || 'osm')}:${String(element?.id || '')}`,
        name: String(tags.name || tags.ref || 'OpenStreetMap feature'),
        latitude: lat,
        longitude: lon,
        provider: 'OpenStreetMap Overpass' as const,
        category: String(
          tags.amenity
          || tags.shop
          || tags.tourism
          || tags.leisure
          || tags.highway
          || tags.building
          || tags.place
          || ''
        ) || undefined,
        metadata: {
          osmType: element?.type,
          tags,
        },
      }];
    });
  } catch {
    return [];
  }
}

async function geoNamesNearbyPlaces(
  latitude: number,
  longitude: number,
  radiusMeters: number,
): Promise<SpectraPlaceContextItem[]> {
  const username = String(process.env.GEONAMES_USERNAME || '').trim();
  if (!username) return [];

  const endpoint = new URL('https://secure.geonames.org/findNearbyJSON');
  endpoint.searchParams.set('lat', String(latitude));
  endpoint.searchParams.set('lng', String(longitude));
  endpoint.searchParams.set('radius', String(Math.max(0.1, Math.min(30, radiusMeters / 1000))));
  endpoint.searchParams.set('maxRows', '80');
  endpoint.searchParams.set('style', 'FULL');
  endpoint.searchParams.set('username', username);

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'LegalWhat-SPECTRA/1.0',
      },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return [];

    const payload: any = await response.json();
    const rows = Array.isArray(payload?.geonames) ? payload.geonames : [];
    return rows.flatMap((row: any) => {
      const lat = Number(row?.lat);
      const lon = Number(row?.lng);
      if (!validCoordinate(lat, lon)) return [];
      return [{
        id: String(row?.geonameId || `${lat},${lon}`),
        name: String(row?.name || row?.toponymName || 'GeoNames place'),
        latitude: lat,
        longitude: lon,
        provider: 'GeoNames' as const,
        category: String(row?.fcode || row?.fcl || '') || undefined,
        metadata: {
          countryCode: row?.countryCode,
          adminName1: row?.adminName1,
          population: row?.population,
          distanceKm: Number.isFinite(Number(row?.distance)) ? Number(row.distance) : undefined,
        },
      }];
    });
  } catch {
    return [];
  }
}

export async function acquireSpectraPlaceContext(
  latitude: number,
  longitude: number,
  radiusMeters = 2_000,
): Promise<SpectraPlaceContextItem[]> {
  const [osmOutcome, geoNamesOutcome, infrastructureOutcome, hootenannyOutcome] = await Promise.allSettled([
    overpassNearbyPlaces(latitude, longitude, radiusMeters),
    geoNamesNearbyPlaces(latitude, longitude, radiusMeters),
    acquireSpectraPublicInfrastructureContext(latitude, longitude),
    acquireSpectraHootenannyContext(latitude, longitude, radiusMeters),
  ]);

  const seen = new Set<string>();
  return [
    ...(osmOutcome.status === 'fulfilled' ? osmOutcome.value : []),
    ...(geoNamesOutcome.status === 'fulfilled' ? geoNamesOutcome.value : []),
    ...(infrastructureOutcome.status === 'fulfilled' ? infrastructureOutcome.value : []),
    ...(hootenannyOutcome.status === 'fulfilled' ? hootenannyOutcome.value.flatMap(feature => {
      const featureLatitude = Number(feature.latitude);
      const featureLongitude = Number(feature.longitude);
      if (!validCoordinate(featureLatitude, featureLongitude)) return [];

      return [{
        id: `hoot:${feature.type}:${feature.id}`,
        name: feature.tags.name || feature.tags.amenity || feature.tags.building || feature.tags.highway || 'Hootenanny map feature',
        latitude: featureLatitude,
        longitude: featureLongitude,
        provider: 'Hootenanny' as const,
        category: feature.tags.building
          ? 'building'
          : feature.tags.highway
            ? 'road'
            : feature.tags.amenity || feature.tags.shop || feature.tags.office
              ? 'poi'
              : 'map_feature',
        metadata: {
          tags: feature.tags,
          contextOnly: true,
          conflatedMap: true,
        },
      }];
    }) : []),
  ].filter(item => {
    const key = `${item.provider}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 160);
}
