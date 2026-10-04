export interface SpectraInfrastructureContextItem {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  provider: 'FCC Antenna Structure Registration' | 'NOAA CORS Network';
  category: 'fcc_antenna_structure' | 'noaa_cors_station';
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

async function arcGisNearby(input: {
  url: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  provider: SpectraInfrastructureContextItem['provider'];
  category: SpectraInfrastructureContextItem['category'];
}): Promise<SpectraInfrastructureContextItem[]> {
  const endpoint = new URL(input.url);
  endpoint.searchParams.set('where', '1=1');
  endpoint.searchParams.set('geometry', String(input.longitude) + ',' + String(input.latitude));
  endpoint.searchParams.set('geometryType', 'esriGeometryPoint');
  endpoint.searchParams.set('inSR', '4326');
  endpoint.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  endpoint.searchParams.set('distance', String(Math.round(Math.max(100, Math.min(100_000, input.radiusMeters)))));
  endpoint.searchParams.set('units', 'esriSRUnit_Meter');
  endpoint.searchParams.set('outFields', '*');
  endpoint.searchParams.set('returnGeometry', 'true');
  endpoint.searchParams.set('outSR', '4326');
  endpoint.searchParams.set('resultRecordCount', '100');
  endpoint.searchParams.set('f', 'json');

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'LegalWhat-SPECTRA/1.0',
      },
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok) return [];
    const payload: any = await response.json();
    const features = Array.isArray(payload?.features) ? payload.features : [];

    return features.flatMap((feature: any, index: number) => {
      const attributes = feature?.attributes && typeof feature.attributes === 'object'
        ? feature.attributes
        : {};
      const geometry = feature?.geometry && typeof feature.geometry === 'object'
        ? feature.geometry
        : {};

      const latitude = Number(
        attributes.Latitude
        ?? attributes.latitude
        ?? attributes.LATITUDE
        ?? geometry.y
      );
      const longitude = Number(
        attributes.Longitude
        ?? attributes.longitude
        ?? attributes.LONGITUDE
        ?? geometry.x
      );
      if (!validCoordinate(latitude, longitude)) return [];

      const id = String(
        attributes.OBJECTID
        ?? attributes.objectid
        ?? attributes.GlobalID
        ?? attributes.globalid
        ?? attributes.RegNum
        ?? attributes.SITEID
        ?? attributes.SiteID
        ?? String(index) + ':' + String(latitude) + ':' + String(longitude)
      );
      const name = String(
        attributes.OwnerName
        ?? attributes.OWNER
        ?? attributes.SITE_NAME
        ?? attributes.Site_Name
        ?? attributes.SITEID
        ?? attributes.SiteID
        ?? attributes.STATION
        ?? attributes.Station
        ?? input.provider
      );

      return [{
        id,
        name,
        latitude,
        longitude,
        provider: input.provider,
        category: input.category,
        metadata: {
          ...attributes,
          contextOnly: true,
          sourceUrl: input.url,
        },
      }];
    });
  } catch {
    return [];
  }
}

export async function acquireFccAntennaContext(
  latitude: number,
  longitude: number,
  radiusMeters = 25_000,
): Promise<SpectraInfrastructureContextItem[]> {
  if (!validCoordinate(latitude, longitude)) return [];
  return arcGisNearby({
    url: 'https://maps.pasda.psu.edu/ArcGIS/rest/services/pasda/HIFLD_FEMA/MapServer/12/query',
    latitude,
    longitude,
    radiusMeters,
    provider: 'FCC Antenna Structure Registration',
    category: 'fcc_antenna_structure',
  });
}

export async function acquireNoaaCorsContext(
  latitude: number,
  longitude: number,
  radiusMeters = 100_000,
): Promise<SpectraInfrastructureContextItem[]> {
  if (!validCoordinate(latitude, longitude)) return [];
  return arcGisNearby({
    url: 'https://services2.arcgis.com/C8EMgrsFcRFL6LrL/ArcGIS/rest/services/NOAA_CORS_Network_view/FeatureServer/2/query',
    latitude,
    longitude,
    radiusMeters,
    provider: 'NOAA CORS Network',
    category: 'noaa_cors_station',
  });
}

export async function acquireSpectraPublicInfrastructureContext(
  latitude: number,
  longitude: number,
): Promise<SpectraInfrastructureContextItem[]> {
  const [fcc, cors] = await Promise.allSettled([
    acquireFccAntennaContext(latitude, longitude),
    acquireNoaaCorsContext(latitude, longitude),
  ]);

  const seen = new Set<string>();
  return [
    ...(fcc.status === 'fulfilled' ? fcc.value : []),
    ...(cors.status === 'fulfilled' ? cors.value : []),
  ].filter(item => {
    const key = item.provider + ':' + item.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 160);
}
