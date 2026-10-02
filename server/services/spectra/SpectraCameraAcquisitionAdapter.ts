export interface SpectraCameraRecord {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  imageUrl?: string;
  videoUrl?: string;
  observedAt?: string;
  provider: string;
  sourceUrl: string;
  metadata?: Record<string, unknown>;
}

interface CameraFeed {
  id: string;
  provider: string;
  layerUrl: string;
}

const IOWA_DOT_CAMERA_LAYER =
  'https://services.arcgis.com/8lRhdTsQyJpO52F1/ArcGIS/rest/services/Traffic_Cameras_View/FeatureServer/0';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function configuredFeeds(): CameraFeed[] {
  const feeds: CameraFeed[] = [{
    id: 'iowa-dot-cctv',
    provider: 'Iowa DOT',
    layerUrl: IOWA_DOT_CAMERA_LAYER,
  }];

  const raw = String(process.env.SPECTRA_CAMERA_ARCGIS_FEEDS || '').trim();
  if (!raw) return feeds;
  for (const [index, item] of raw.split(',').map(value => value.trim()).filter(Boolean).entries()) {
    const pieces = item.split('|').map(value => value.trim());
    const layerUrl = pieces[0] || '';
    if (!/^https:\/\//i.test(layerUrl)) continue;
    feeds.push({
      id: pieces[1] || `configured-camera-feed-${index + 1}`,
      provider: pieces[2] || new URL(layerUrl).hostname,
      layerUrl: layerUrl.replace(/\/$/, ''),
    });
  }
  return feeds;
}

function boundingBox(latitude: number, longitude: number, radiusMeters: number) {
  const radius = clamp(radiusMeters, 250, 100_000);
  const latDelta = radius / 111_320;
  const cos = Math.max(0.15, Math.cos(latitude * Math.PI / 180));
  const lngDelta = radius / (111_320 * cos);
  return {
    minLat: latitude - latDelta,
    maxLat: latitude + latDelta,
    minLng: longitude - lngDelta,
    maxLng: longitude + lngDelta,
  };
}

function firstString(attributes: Record<string, unknown>, patterns: RegExp[]): string | undefined {
  for (const [key, value] of Object.entries(attributes)) {
    if (!patterns.some(pattern => pattern.test(key))) continue;
    const text = String(value || '').trim();
    if (text) return text;
  }
  return undefined;
}

function firstNumber(attributes: Record<string, unknown>, patterns: RegExp[]): number | undefined {
  for (const [key, value] of Object.entries(attributes)) {
    if (!patterns.some(pattern => pattern.test(key))) continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function parseObservedAt(attributes: Record<string, unknown>): string | undefined {
  const raw = firstString(attributes, [
    /^observed/i, /^timestamp/i, /^updated?/i, /^update_date/i, /^last_?update/i,
  ]);
  if (raw) {
    const numeric = Number(raw);
    const date = Number.isFinite(numeric)
      ? new Date(numeric < 100_000_000_000 ? numeric * 1000 : numeric)
      : new Date(raw);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }

  const updateDate = firstNumber(attributes, [/^UpdateDate$/i]);
  const updateTime = firstNumber(attributes, [/^UpdateTime$/i]);
  if (Number.isFinite(updateDate) && Number.isFinite(updateTime)) {
    // Some 511 feeds expose compact date/time integers rather than epochs.
    // Preserve those raw values in metadata instead of guessing a timestamp.
    return undefined;
  }
  return undefined;
}

function validCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180;
}

async function queryArcGisFeed(
  feed: CameraFeed,
  latitude: number,
  longitude: number,
  radiusMeters: number,
  signal?: AbortSignal,
): Promise<SpectraCameraRecord[]> {
  const box = boundingBox(latitude, longitude, radiusMeters);
  const endpoint = new URL(`${feed.layerUrl}/query`);
  endpoint.searchParams.set('f', 'json');
  endpoint.searchParams.set('where', '1=1');
  endpoint.searchParams.set('outFields', '*');
  endpoint.searchParams.set('returnGeometry', 'true');
  endpoint.searchParams.set('geometryType', 'esriGeometryEnvelope');
  endpoint.searchParams.set('geometry', `${box.minLng},${box.minLat},${box.maxLng},${box.maxLat}`);
  endpoint.searchParams.set('inSR', '4326');
  endpoint.searchParams.set('outSR', '4326');
  endpoint.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  endpoint.searchParams.set('resultRecordCount', '200');

  const controller = new AbortController();
  const relayAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', relayAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('SPECTRA camera feed timeout')), 5_000);

  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return [];
    const payload: any = await response.json();
    const features = Array.isArray(payload?.features) ? payload.features : [];

    return features.flatMap((feature: any, index: number) => {
      const attributes = feature?.attributes && typeof feature.attributes === 'object'
        ? feature.attributes as Record<string, unknown>
        : {};
      const geometry = feature?.geometry || {};
      const lat = Number(
        firstNumber(attributes, [/^latitude$/i, /^lat$/i])
        ?? geometry.y
      );
      const lng = Number(
        firstNumber(attributes, [/^longitude$/i, /^lon$/i, /^lng$/i])
        ?? geometry.x
      );
      if (!validCoordinate(lat, lng)) return [];

      const imageUrl = firstString(attributes, [
        /^ImageURL$/i, /snapshot/i, /still.*image/i, /^image$/i, /image.*url/i,
      ]);
      const videoUrl = firstString(attributes, [
        /^VideoURL$/i, /stream/i, /video.*url/i, /^video$/i,
      ]);
      const id = String(
        firstString(attributes, [/^COMMON_ID$/i, /^device_id$/i, /^camera_?id$/i, /^id$/i])
        || firstNumber(attributes, [/^FID$/i, /^OBJECTID$/i])
        || `${feed.id}-${index + 1}`
      );
      const name = firstString(attributes, [
        /^Desc_$/i, /description/i, /intersection/i, /location/i, /^name$/i, /^Route$/i,
      ]) || `${feed.provider} camera ${id}`;

      return [{
        id,
        name,
        latitude: lat,
        longitude: lng,
        imageUrl: imageUrl && /^https?:\/\//i.test(imageUrl) ? imageUrl : undefined,
        videoUrl: videoUrl && /^https?:\/\//i.test(videoUrl) ? videoUrl : undefined,
        observedAt: parseObservedAt(attributes),
        provider: feed.provider,
        sourceUrl: feed.layerUrl,
        metadata: attributes,
      } satisfies SpectraCameraRecord];
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relayAbort);
  }
}

export async function acquireNearbyTrafficCameras(input: {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  signal?: AbortSignal;
}): Promise<SpectraCameraRecord[]> {
  if (!validCoordinate(input.latitude, input.longitude)) return [];
  const feeds = configuredFeeds();
  const settled = await Promise.allSettled(
    feeds.map(feed => queryArcGisFeed(
      feed,
      input.latitude,
      input.longitude,
      input.radiusMeters ?? 15_000,
      input.signal,
    )),
  );

  const seen = new Set<string>();
  return settled.flatMap(result => result.status === 'fulfilled' ? result.value : [])
    .filter(camera => {
      const key = `${camera.provider}:${camera.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 100);
}
