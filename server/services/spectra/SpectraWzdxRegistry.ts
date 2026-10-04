export interface SpectraWzdxFeed {
  state?: string;
  issuingOrganization?: string;
  feedName: string;
  url: string;
  format?: 'json' | 'geojson' | 'xml' | string;
  updateFrequency?: string;
  version?: string;
  active: boolean;
  needsApiKey: boolean;
  startDate?: string;
  endDate?: string;
  stateCoordinate?: {
    latitude: number;
    longitude: number;
  };
  source: 'USDOT WZDx Feed Registry';
}

interface WzdxCache {
  expiresAt: number;
  feeds: SpectraWzdxFeed[];
}

const REGISTRY_API =
  'https://data.transportation.gov/resource/69qe-yiui.json';
let cache: WzdxCache | null = null;

function boolValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return /^(?:true|1|yes)$/i.test(String(value ?? '').trim());
}

function safeHttpsUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function clean(value: unknown, max = 300): string | undefined {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

export async function loadSpectraWzdxRegistry(
  forceRefresh = false,
): Promise<SpectraWzdxFeed[]> {
  if (!forceRefresh && cache && cache.expiresAt > Date.now()) {
    return cache.feeds.map(feed => ({ ...feed }));
  }

  const endpoint = new URL(REGISTRY_API);
  endpoint.searchParams.set('$limit', '250');
  endpoint.searchParams.set('$order', 'state ASC, feedname ASC');

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'LegalWhat-SPECTRA/1.0',
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return cache?.feeds || [];

    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) return cache?.feeds || [];

    const feeds = rows.slice(0, 250).flatMap((row: any) => {
      const url = safeHttpsUrl(row?.url);
      const active = boolValue(row?.active);
      const needsApiKey = boolValue(row?.needapikey);
      if (!url || !active || needsApiKey) return [];

      const coordinates = Array.isArray(row?.geocoded_column?.coordinates)
        ? row.geocoded_column.coordinates
        : [];
      const coordinateLongitude = Number(coordinates[0]);
      const coordinateLatitude = Number(coordinates[1]);
      const stateCoordinate =
        Number.isFinite(coordinateLatitude)
        && Number.isFinite(coordinateLongitude)
        && coordinateLatitude >= -90 && coordinateLatitude <= 90
        && coordinateLongitude >= -180 && coordinateLongitude <= 180
          ? {
              latitude: coordinateLatitude,
              longitude: coordinateLongitude,
            }
          : undefined;

      return [{
        state: clean(row?.state, 80),
        issuingOrganization: clean(row?.issuingorganization, 200),
        feedName: clean(row?.feedname, 200) || 'WZDx feed',
        url,
        format: clean(row?.format, 40)?.toLowerCase(),
        updateFrequency: clean(row?.datafeed_frequency_update, 80),
        version: clean(row?.version, 60),
        active,
        needsApiKey,
        startDate: clean(row?.sdate, 80),
        endDate: clean(row?.edate, 80),
        stateCoordinate,
        source: 'USDOT WZDx Feed Registry' as const,
      }];
    });

    cache = {
      expiresAt: Date.now() + 60 * 60_000,
      feeds,
    };
    return feeds.map(feed => ({ ...feed }));
  } catch {
    return cache?.feeds || [];
  }
}

export function getSpectraWzdxRegistryUrl(): string {
  return REGISTRY_API;
}
