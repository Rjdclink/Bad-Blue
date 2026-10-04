import { parse as parseCsv } from 'csv-parse/sync';

export interface SpectraPublicFeedRecord {
  id: string;
  provider: string;
  name?: string;
  dataType: 'gtfs-rt' | 'other';
  entityTypes: string[];
  directUrl: string;
  authenticationType: number;
  active: boolean;
  official?: boolean;
  countryCode?: string;
  subdivision?: string;
  municipality?: string;
  boundingBox?: {
    minimumLatitude: number;
    maximumLatitude: number;
    minimumLongitude: number;
    maximumLongitude: number;
  };
  source: 'MobilityDatabase';
}

interface CachedCatalog {
  expiresAt: number;
  records: SpectraPublicFeedRecord[];
}

let cache: CachedCatalog | null = null;
const CATALOG_URL = 'https://files.mobilitydatabase.org/feeds_v2.csv';

function value(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const direct = row[key];
    if (direct !== undefined && direct !== null && String(direct).trim()) {
      return String(direct).trim();
    }
  }

  const normalizedEntries = Object.entries(row).map(([key, item]) => [
    key.toLowerCase().replace(/[^a-z0-9]+/g, ''),
    item,
  ] as const);
  for (const key of keys) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const found = normalizedEntries.find(([candidate]) => candidate === normalizedKey);
    if (found && found[1] !== undefined && found[1] !== null && String(found[1]).trim()) {
      return String(found[1]).trim();
    }
  }
  return '';
}

function finite(row: Record<string, unknown>, ...keys: string[]): number | null {
  const raw = value(row, ...keys).trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolValue(raw: string): boolean | undefined {
  if (!raw) return undefined;
  if (/^(?:true|1|yes)$/i.test(raw)) return true;
  if (/^(?:false|0|no)$/i.test(raw)) return false;
  return undefined;
}

function httpsUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeRow(row: Record<string, unknown>): SpectraPublicFeedRecord | null {
  const dataType = value(row, 'data_type', 'dataType');
  if (dataType !== 'gtfs-rt') return null;

  const directUrl = httpsUrl(value(
    row,
    'urls.direct_download_url',
    'urls_direct_download_url',
    'direct_download_url',
    'direct_download',
  ));
  if (!directUrl) return null;

  const authRaw = value(
    row,
    'urls.authentication_type',
    'urls_authentication_type',
    'authentication_type',
  );
  const authenticationType = authRaw ? Number(authRaw) : 0;
  const status = value(row, 'status').toLowerCase();
  const id = value(row, 'id', 'mdb_source_id') || directUrl;
  const entityTypes = value(row, 'entity_type', 'entity_types')
    .split('|')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);

  const minLat = finite(
    row,
    'location.bounding_box.minimum_latitude',
    'location_bounding_box_minimum_latitude',
    'minimum_latitude',
  );
  const maxLat = finite(
    row,
    'location.bounding_box.maximum_latitude',
    'location_bounding_box_maximum_latitude',
    'maximum_latitude',
  );
  const minLon = finite(
    row,
    'location.bounding_box.minimum_longitude',
    'location_bounding_box_minimum_longitude',
    'minimum_longitude',
  );
  const maxLon = finite(
    row,
    'location.bounding_box.maximum_longitude',
    'location_bounding_box_maximum_longitude',
    'maximum_longitude',
  );

  const boundingBox =
    minLat !== null && maxLat !== null && minLon !== null && maxLon !== null
      && minLat >= -90 && maxLat <= 90 && minLon >= -180 && maxLon <= 180
      && minLat <= maxLat && minLon <= maxLon
      ? {
          minimumLatitude: minLat,
          maximumLatitude: maxLat,
          minimumLongitude: minLon,
          maximumLongitude: maxLon,
        }
      : undefined;

  return {
    id: id.slice(0, 200),
    provider: value(row, 'provider').slice(0, 300) || 'Public transit provider',
    name: value(row, 'name').slice(0, 300) || undefined,
    dataType: 'gtfs-rt',
    entityTypes,
    directUrl,
    authenticationType: Number.isFinite(authenticationType)
      ? Math.max(0, Math.min(3, authenticationType))
      : 0,
    active: !status || status === 'active',
    official: boolValue(value(row, 'is_official')),
    countryCode: value(row, 'location.country_code', 'location_country_code', 'country_code') || undefined,
    subdivision: value(row, 'location.subdivision_name', 'location_subdivision_name', 'subdivision_name') || undefined,
    municipality: value(row, 'location.municipality', 'location_municipality', 'municipality') || undefined,
    boundingBox,
    source: 'MobilityDatabase',
  };
}

export async function loadSpectraPublicGtfsRealtimeCatalog(
  forceRefresh = false,
): Promise<SpectraPublicFeedRecord[]> {
  if (!forceRefresh && cache && cache.expiresAt > Date.now()) {
    return cache.records.map(record => ({ ...record }));
  }

  try {
    const response = await fetch(CATALOG_URL, {
      headers: {
        Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.1',
        'User-Agent': 'LegalWhat-SPECTRA/1.0',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return cache?.records || [];

    const csv = await response.text();
    if (csv.length > 20_000_000) return cache?.records || [];

    const rows = parseCsv(csv, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      bom: true,
      trim: true,
    }) as Array<Record<string, unknown>>;

    const records = rows
      .slice(0, 20_000)
      .map(normalizeRow)
      .filter((record): record is SpectraPublicFeedRecord => Boolean(record))
      .filter(record =>
        record.active
        && record.authenticationType === 0
        && record.entityTypes.includes('vp')
      );

    cache = {
      expiresAt: Date.now() + 60 * 60_000,
      records,
    };
    return records.map(record => ({ ...record }));
  } catch {
    return cache?.records || [];
  }
}

export async function findSpectraPublicGtfsRealtimeFeeds(
  latitude: number,
  longitude: number,
  limit = 50,
): Promise<SpectraPublicFeedRecord[]> {
  if (
    !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90
    || longitude < -180 || longitude > 180
  ) return [];

  const records = await loadSpectraPublicGtfsRealtimeCatalog();
  return records
    .filter(record => {
      const box = record.boundingBox;
      if (!box) return false;
      return latitude >= box.minimumLatitude
        && latitude <= box.maximumLatitude
        && longitude >= box.minimumLongitude
        && longitude <= box.maximumLongitude;
    })
    .slice(0, Math.max(1, Math.min(200, Math.floor(limit))));
}

export function getSpectraPublicFeedCatalogSource(): string {
  return CATALOG_URL;
}
