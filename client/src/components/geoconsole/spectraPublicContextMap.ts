import type { SpectraGeographicContextEvidence, SpectraPhotoScene } from './SpectraGeographicContext';

function coordinate(lat: unknown, lon: unknown): [number, number] | null {
  if (typeof lat !== 'number' || typeof lon !== 'number'
    || !Number.isFinite(lat) || !Number.isFinite(lon)
    || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lon, lat];
}

interface ContextProperties {
  kind: 'photo_capture' | 'catalogued_media' | 'public_camera' | 'weather_station' | 'satellite_footprint';
  label: string;
  provider: string;
  observedAt: string;
  sourceUrl: string;
}

type Point = {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: ContextProperties;
};
type Footprint = {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: number[][][] };
  properties: ContextProperties;
};

/** Geographic context is NEVER part of the subject position or trajectory GeoJSON. */
export function spectraPublicContextGeoJson(
  context?: SpectraGeographicContextEvidence | null,
  scenes: readonly SpectraPhotoScene[] = [],
): { type: 'FeatureCollection'; features: Array<Point | Footprint> } {
  const features: Array<Point | Footprint> = [];
  const seen = new Set<string>();
  const point = (lat: unknown, lon: unknown, properties: ContextProperties) => {
    const coordinates = coordinate(lat, lon);
    if (!coordinates) return;
    const id = [properties.kind, properties.sourceUrl, ...coordinates].join('|');
    if (seen.has(id)) return;
    seen.add(id);
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties });
  };
  for (const scene of scenes.slice(0, 24)) {
    if (!scene.captureGps || scene.currentPositionVerified !== false) continue;
    point(scene.captureGps.latitude, scene.captureGps.longitude, {
      kind: 'photo_capture',
      label: 'Photograph taken here (not a person location)',
      provider: scene.sourcePlatform,
      observedAt: scene.capturedAt || '',
      sourceUrl: scene.sourcePostUrl,
    });
  }
  for (const camera of (context?.cameras || []).slice(0, 80)) {
    point(camera.latitude, camera.longitude, {
      kind: 'public_camera',
      label: 'Public camera location (not a person sighting)',
      provider: camera.provider || 'Camera directory',
      observedAt: camera.observedAt || '',
      sourceUrl: camera.imageUrl || '',
    });
  }
  for (const media of (context?.geotaggedMedia || []).slice(0, 40)) {
    point(media.latitude, media.longitude, {
      kind: 'catalogued_media',
      label: 'Public catalogue scene (not a person location)',
      provider: media.provider || 'Public media',
      observedAt: media.capturedAt || '',
      sourceUrl: media.pageUrl || '',
    });
  }
  if (context?.weather) {
    point(context.weather.latitude, context.weather.longitude, {
      kind: 'weather_station',
      label: 'Weather station measurement (not a person location)',
      provider: context.weather.provider || 'National Weather Service',
      observedAt: context.weather.observedAt || '',
      sourceUrl: '',
    });
  }
  for (const satellite of (context?.earthObservation || []).slice(0, 15)) {
    const bbox = satellite.bbox;
    if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) continue;
    const [west, south, east, north] = bbox;
    if (west < -180 || east > 180 || south < -90 || north > 90
      || east <= west || north <= south || east - west > 10 || north - south > 10) continue;
    const id = 'satellite:' + satellite.id;
    if (seen.has(id)) continue;
    seen.add(id);
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[
        [west, south], [east, south], [east, north], [west, north], [west, south],
      ]] },
      properties: {
        kind: 'satellite_footprint',
        label: 'Satellite acquisition footprint (not a person location)',
        provider: satellite.provider || 'Copernicus',
        observedAt: satellite.observedAt || '',
        sourceUrl: satellite.links?.find(link => link.rel === 'self')?.href || '',
      },
    });
  }
  return { type: 'FeatureCollection', features: features.slice(0, 160) };
}
