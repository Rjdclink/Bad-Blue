import {
  loadSpectraWzdxRegistry,
  type SpectraWzdxFeed,
} from './SpectraWzdxRegistry';

export interface SpectraWzdxContextItem {
  id: string;
  feedName: string;
  issuingOrganization?: string;
  state?: string;
  eventType?: string;
  deviceType?: string;
  deviceStatus?: string;
  name?: string;
  roadNames: string[];
  latitude: number;
  longitude: number;
  observedAt?: string;
  startDate?: string;
  endDate?: string;
  sourceUrl: string;
  source: 'USDOT WZDx';
  contextOnly: true;
  metadata: Record<string, unknown>;
}

function finite(value: unknown): number | null {
  if (
    value === null
    || value === undefined
    || value === ''
    || typeof value === 'boolean'
  ) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180;
}

function clean(value: unknown, max = 500): string | undefined {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

function isoDate(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = new Date(value as any);
  return Number.isFinite(date.getTime())
    ? date.toISOString()
    : undefined;
}

function haversineMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const radius = 6_371_008.8;
  const phi1 = latitudeA * Math.PI / 180;
  const phi2 = latitudeB * Math.PI / 180;
  const deltaPhi = (latitudeB - latitudeA) * Math.PI / 180;
  const deltaLambda = (longitudeB - longitudeA) * Math.PI / 180;
  const a =
    Math.sin(deltaPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
}

function flattenCoordinates(value: unknown, depth = 0): Array<[number, number]> {
  if (depth > 5 || !Array.isArray(value)) return [];

  if (
    value.length >= 2
    && finite(value[0]) !== null
    && finite(value[1]) !== null
  ) {
    const longitude = Number(value[0]);
    const latitude = Number(value[1]);
    return validCoordinate(latitude, longitude)
      ? [[latitude, longitude]]
      : [];
  }

  return value
    .slice(0, 20_000)
    .flatMap(child => flattenCoordinates(child, depth + 1));
}

function representativeCoordinate(geometry: unknown): {
  latitude: number;
  longitude: number;
} | null {
  if (!geometry || typeof geometry !== 'object') return null;
  const source = geometry as Record<string, unknown>;
  const coordinates = flattenCoordinates(source.coordinates);
  if (!coordinates.length) return null;

  const latitude =
    coordinates.reduce((sum, point) => sum + point[0], 0) / coordinates.length;
  const longitude =
    coordinates.reduce((sum, point) => sum + point[1], 0) / coordinates.length;

  return validCoordinate(latitude, longitude)
    ? { latitude, longitude }
    : null;
}

function feedDistanceMeters(
  feed: SpectraWzdxFeed,
  latitude: number,
  longitude: number,
): number {
  if (!feed.stateCoordinate) return Number.POSITIVE_INFINITY;
  return haversineMeters(
    latitude,
    longitude,
    feed.stateCoordinate.latitude,
    feed.stateCoordinate.longitude,
  );
}

function selectCandidateFeeds(
  feeds: SpectraWzdxFeed[],
  latitude: number,
  longitude: number,
): SpectraWzdxFeed[] {
  const supported = feeds.filter(feed =>
    !feed.format
    || /json|geojson/i.test(feed.format)
  );

  const withCoordinates = supported
    .filter(feed => feed.stateCoordinate)
    .sort((left, right) =>
      feedDistanceMeters(left, latitude, longitude)
      - feedDistanceMeters(right, latitude, longitude)
    );

  const withoutCoordinates = supported.filter(feed => !feed.stateCoordinate);

  const seen = new Set<string>();
  return [...withCoordinates.slice(0, 8), ...withoutCoordinates.slice(0, 2)]
    .filter(feed => {
      const key = feed.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function roadNames(core: Record<string, any>): string[] {
  const raw = Array.isArray(core.road_names)
    ? core.road_names
    : Array.isArray(core.roadNames)
      ? core.roadNames
      : [];
  return raw
    .map(value => clean(value, 120))
    .filter((value): value is string => Boolean(value))
    .slice(0, 20);
}

function featureToContext(
  feed: SpectraWzdxFeed,
  feature: unknown,
  index: number,
  latitude: number,
  longitude: number,
  radiusMeters: number,
): SpectraWzdxContextItem | null {
  if (!feature || typeof feature !== 'object') return null;
  const row = feature as Record<string, any>;
  const properties =
    row.properties && typeof row.properties === 'object'
      ? row.properties as Record<string, any>
      : {};
  const core =
    properties.core_details && typeof properties.core_details === 'object'
      ? properties.core_details as Record<string, any>
      : properties.coreDetails && typeof properties.coreDetails === 'object'
        ? properties.coreDetails as Record<string, any>
        : {};

  const representative = representativeCoordinate(row.geometry);
  if (!representative) return null;

  const distance = haversineMeters(
    latitude,
    longitude,
    representative.latitude,
    representative.longitude,
  );
  if (distance > radiusMeters) return null;

  const eventType = clean(core.event_type ?? core.eventType, 80);
  const deviceType = clean(core.device_type ?? core.deviceType, 80);
  const updateDate = isoDate(core.update_date ?? core.updateDate);
  const startDate = isoDate(
    core.start_date
    ?? core.startDate
    ?? properties.start_date
    ?? properties.startDate,
  );
  const endDate = isoDate(
    core.end_date
    ?? core.endDate
    ?? properties.end_date
    ?? properties.endDate,
  );

  const id = clean(row.id, 240)
    || `${feed.feedName}:${index}:${representative.latitude.toFixed(6)}:${representative.longitude.toFixed(6)}`;

  return {
    id,
    feedName: feed.feedName,
    issuingOrganization: feed.issuingOrganization,
    state: feed.state,
    eventType,
    deviceType,
    deviceStatus: clean(core.device_status ?? core.deviceStatus, 80),
    name: clean(core.name ?? properties.name, 300),
    roadNames: roadNames(core),
    latitude: representative.latitude,
    longitude: representative.longitude,
    observedAt: updateDate,
    startDate,
    endDate,
    sourceUrl: feed.url,
    source: 'USDOT WZDx',
    contextOnly: true,
    metadata: {
      contextKind: 'public-road-work-zone',
      distanceMeters: Math.round(distance),
      geometryType: clean(row.geometry?.type, 80),
      hasAutomaticLocation:
        typeof core.has_automatic_location === 'boolean'
          ? core.has_automatic_location
          : typeof core.hasAutomaticLocation === 'boolean'
            ? core.hasAutomaticLocation
            : undefined,
      isMoving:
        typeof core.is_moving === 'boolean'
          ? core.is_moving
          : typeof core.isMoving === 'boolean'
            ? core.isMoving
            : undefined,
      roadDirection: clean(core.road_direction ?? core.roadDirection, 80),
      roadEventIds: Array.isArray(core.road_event_ids)
        ? core.road_event_ids.slice(0, 50)
        : Array.isArray(core.roadEventIds)
          ? core.roadEventIds.slice(0, 50)
          : undefined,
      milepost: finite(core.milepost) ?? undefined,
      velocityKph: finite(core.velocity_kph ?? core.velocityKph) ?? undefined,
      averageSpeedKph: finite(
        properties.average_speed_kph
        ?? properties.averageSpeedKph
      ) ?? undefined,
      volumeVph: finite(properties.volume_vph ?? properties.volumeVph) ?? undefined,
      occupancyPercent: finite(
        properties.occupancy_percent
        ?? properties.occupancyPercent
      ) ?? undefined,
      feedVersion: feed.version,
      updateFrequency: feed.updateFrequency,
    },
  };
}

async function fetchFeedContext(
  feed: SpectraWzdxFeed,
  latitude: number,
  longitude: number,
  radiusMeters: number,
): Promise<SpectraWzdxContextItem[]> {
  try {
    const response = await fetch(feed.url, {
      headers: {
        Accept: 'application/geo+json,application/json;q=0.9,*/*;q=0.1',
        'User-Agent': 'LegalWhat-SPECTRA/1.0',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok) return [];

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > 12_000_000) return [];

    const text = await response.text();
    if (!text || text.length > 12_000_000) return [];

    const payload = JSON.parse(text);
    const features = Array.isArray(payload?.features)
      ? payload.features
      : [];

    return features
      .slice(0, 5_000)
      .map((feature: unknown, index: number) =>
        featureToContext(
          feed,
          feature,
          index,
          latitude,
          longitude,
          radiusMeters,
        )
      )
      .filter((item: SpectraWzdxContextItem | null): item is SpectraWzdxContextItem =>
        Boolean(item)
      )
      .slice(0, 500);
  } catch {
    return [];
  }
}

export async function acquireSpectraWzdxContext(
  latitude: number,
  longitude: number,
  radiusMeters = 50_000,
): Promise<SpectraWzdxContextItem[]> {
  if (!validCoordinate(latitude, longitude)) return [];

  const boundedRadius = Math.max(1_000, Math.min(100_000, radiusMeters));
  const feeds = selectCandidateFeeds(
    await loadSpectraWzdxRegistry(),
    latitude,
    longitude,
  );

  const outcomes = await Promise.allSettled(
    feeds.map(feed =>
      fetchFeedContext(feed, latitude, longitude, boundedRadius)
    ),
  );

  const seen = new Set<string>();
  return outcomes
    .flatMap(outcome =>
      outcome.status === 'fulfilled' ? outcome.value : []
    )
    .filter(item => {
      const key = `${item.sourceUrl}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) =>
      Number(left.metadata.distanceMeters || Number.MAX_SAFE_INTEGER)
      - Number(right.metadata.distanceMeters || Number.MAX_SAFE_INTEGER)
    )
    .slice(0, 500);
}
