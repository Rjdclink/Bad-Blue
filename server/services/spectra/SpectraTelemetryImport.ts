import { load } from 'cheerio';
import { parse as parseCsv } from 'csv-parse/sync';

export type SpectraTelemetryImportFormat =
  | 'geojson'
  | 'gpx'
  | 'kml'
  | 'nmea'
  | 'csv'
  | 'ndjson';

export interface SpectraImportedObservation {
  latitude: number;
  longitude: number;
  altitude?: number;
  accuracy?: number;
  timestamp: string;
  confidence: number;
  recordId?: string;
  metadata?: Record<string, unknown>;
}

const MAX_IMPORTED_POINTS = 2_000;
const MAX_IMPORT_CHARACTERS = 5_000_000;

function validCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180;
}

function validTimestamp(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value as any);
  const ms = date.getTime();
  if (!Number.isFinite(ms)) return null;
  if (ms < Date.UTC(1900, 0, 1) || ms > Date.now() + 24 * 60 * 60_000) return null;
  return date.toISOString();
}

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function observation(
  latitude: unknown,
  longitude: unknown,
  timestamp: unknown,
  options: {
    altitude?: unknown;
    accuracy?: unknown;
    confidence?: number;
    recordId?: string;
    metadata?: Record<string, unknown>;
  } = {},
): SpectraImportedObservation | null {
  const lat = Number(latitude);
  const lon = Number(longitude);
  const time = validTimestamp(timestamp);
  if (!validCoordinate(lat, lon) || !time) return null;

  const altitude = numberOrUndefined(options.altitude);
  const accuracyRaw = numberOrUndefined(options.accuracy);
  return {
    latitude: lat,
    longitude: lon,
    altitude,
    accuracy: accuracyRaw !== undefined && accuracyRaw > 0 ? accuracyRaw : undefined,
    timestamp: time,
    confidence: Math.max(0.1, Math.min(0.8, options.confidence ?? 0.55)),
    recordId: options.recordId,
    metadata: options.metadata,
  };
}

function propertyTimestamp(properties: Record<string, any>, index?: number): unknown {
  const candidates = [
    properties.timestamp,
    properties.observedAt,
    properties.capturedAt,
    properties.datetime,
    properties.dateTime,
    properties.time,
    properties.createdAt,
    properties.date,
  ];
  if (index !== undefined) {
    for (const list of [
      properties.timestamps,
      properties.times,
      properties.datetimes,
      properties.observedTimes,
    ]) {
      if (Array.isArray(list) && list[index] !== undefined) return list[index];
    }
  }
  return candidates.find(value => value !== undefined && value !== null && value !== '');
}

function parseGeoJson(content: string): SpectraImportedObservation[] {
  const payload = JSON.parse(content);
  const out: SpectraImportedObservation[] = [];

  const geometryPoints = (
    geometry: any,
    properties: Record<string, any>,
    recordId?: string,
  ) => {
    if (!geometry || typeof geometry !== 'object') return;
    const type = String(geometry.type || '');
    const coordinates = geometry.coordinates;
    const pushCoordinate = (coord: any, index?: number) => {
      if (!Array.isArray(coord) || coord.length < 2) return;
      const point = observation(coord[1], coord[0], propertyTimestamp(properties, index), {
        altitude: coord[2],
        accuracy: properties.accuracy ?? properties.horizontalAccuracy,
        confidence: 0.58,
        recordId,
        metadata: { format: 'geojson', geometryType: type },
      });
      if (point) out.push(point);
    };

    if (type === 'Point') pushCoordinate(coordinates);
    else if (type === 'MultiPoint' || type === 'LineString') {
      (Array.isArray(coordinates) ? coordinates : []).forEach(pushCoordinate);
    } else if (type === 'MultiLineString' || type === 'Polygon') {
      let index = 0;
      for (const line of Array.isArray(coordinates) ? coordinates : []) {
        for (const coord of Array.isArray(line) ? line : []) pushCoordinate(coord, index++);
      }
    } else if (type === 'GeometryCollection') {
      for (const child of Array.isArray(geometry.geometries) ? geometry.geometries : []) {
        geometryPoints(child, properties, recordId);
      }
    }
  };

  const visit = (value: any) => {
    if (!value || typeof value !== 'object' || out.length >= MAX_IMPORTED_POINTS) return;
    if (value.type === 'FeatureCollection') {
      for (const feature of Array.isArray(value.features) ? value.features : []) visit(feature);
      return;
    }
    if (value.type === 'Feature') {
      geometryPoints(
        value.geometry,
        value.properties && typeof value.properties === 'object' ? value.properties : {},
        value.id === undefined ? undefined : String(value.id),
      );
      return;
    }
    geometryPoints(value, value.properties || {}, value.id === undefined ? undefined : String(value.id));
  };

  visit(payload);
  return out.slice(0, MAX_IMPORTED_POINTS);
}

function parseGpx(content: string): SpectraImportedObservation[] {
  const $ = load(content, { xmlMode: true });
  const out: SpectraImportedObservation[] = [];
  $('trkpt, rtept, wpt').each((index, element) => {
    if (out.length >= MAX_IMPORTED_POINTS) return false;
    const node = $(element);
    const point = observation(
      node.attr('lat'),
      node.attr('lon'),
      node.children('time').first().text().trim(),
      {
        altitude: node.children('ele').first().text().trim(),
        accuracy: undefined,
        confidence: 0.62,
        recordId: `gpx:${index + 1}`,
        metadata: {
          format: 'gpx',
          pointType: String((element as any).tagName || (element as any).name || ''),
          hdop: numberOrUndefined(node.children('hdop').first().text().trim()),
          vdop: numberOrUndefined(node.children('vdop').first().text().trim()),
          pdop: numberOrUndefined(node.children('pdop').first().text().trim()),
          satellites: numberOrUndefined(node.children('sat').first().text().trim()),
          fix: node.children('fix').first().text().trim() || undefined,
        },
      },
    );
    if (point) out.push(point);
  });
  return out;
}

function parseKml(content: string): SpectraImportedObservation[] {
  const $ = load(content, { xmlMode: true });
  const out: SpectraImportedObservation[] = [];

  $('Placemark').each((index, element) => {
    if (out.length >= MAX_IMPORTED_POINTS) return false;
    const placemark = $(element);
    const recordId = placemark.attr('id') || `kml:${index + 1}`;
    const placemarkTime =
      placemark.find('TimeStamp > when').first().text().trim()
      || placemark.find('TimeSpan > begin').first().text().trim();

    placemark.find('Point > coordinates').each((_coordIndex, coordinateNode) => {
      const raw = $(coordinateNode).text().trim().split(/\s+/)[0];
      const [lon, lat, alt] = raw.split(',').map(Number);
      const point = observation(lat, lon, placemarkTime, {
        altitude: alt,
        confidence: 0.58,
        recordId,
        metadata: {
          format: 'kml',
          name: placemark.children('name').first().text().trim() || undefined,
        },
      });
      if (point) out.push(point);
    });

    const track = placemark.find('gx\\:Track');
    if (track.length) {
      const times = track.find('when').toArray().map(node => $(node).text().trim());
      const coords = track.find('gx\\:coord').toArray().map(node => $(node).text().trim());
      for (let trackIndex = 0; trackIndex < Math.min(times.length, coords.length); trackIndex += 1) {
        if (out.length >= MAX_IMPORTED_POINTS) break;
        const [lon, lat, alt] = coords[trackIndex].split(/\s+/).map(Number);
        const point = observation(lat, lon, times[trackIndex], {
          altitude: alt,
          confidence: 0.62,
          recordId: `${recordId}:track:${trackIndex + 1}`,
          metadata: { format: 'kml', geometryType: 'gx:Track' },
        });
        if (point) out.push(point);
      }
    }
  });

  return out.slice(0, MAX_IMPORTED_POINTS);
}

function nmeaCoordinate(raw: string, hemisphere: string): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const degrees = Math.floor(value / 100);
  const minutes = value - degrees * 100;
  let result = degrees + minutes / 60;
  if (hemisphere === 'S' || hemisphere === 'W') result = -result;
  return result;
}

function nmeaUtc(timeRaw: string, dateRaw: string): string | null {
  const time = String(timeRaw || '').trim();
  const date = String(dateRaw || '').trim();
  if (!/^\d{6}(?:\.\d+)?$/.test(time) || !/^\d{6}$/.test(date)) return null;
  const day = Number(date.slice(0, 2));
  const month = Number(date.slice(2, 4));
  const yy = Number(date.slice(4, 6));
  const year = yy >= 80 ? 1900 + yy : 2000 + yy;
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2, 4));
  const secondWithFraction = Number(time.slice(4));
  const second = Math.floor(secondWithFraction);
  const milliseconds = Math.round((secondWithFraction - second) * 1000);
  return validTimestamp(new Date(Date.UTC(year, month - 1, day, hour, minute, second, milliseconds)));
}

function parseNmea(content: string): SpectraImportedObservation[] {
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const ggaByTime = new Map<string, { altitude?: number; hdop?: number; satellites?: number }>();

  for (const line of lines) {
    const parts = line.split(',');
    if (!/^\$..GGA$/.test(parts[0] || '')) continue;
    const key = String(parts[1] || '').slice(0, 6);
    if (!key) continue;
    ggaByTime.set(key, {
      hdop: numberOrUndefined(parts[8]),
      altitude: numberOrUndefined(parts[9]),
      satellites: numberOrUndefined(parts[7]),
    });
  }

  const out: SpectraImportedObservation[] = [];
  for (let index = 0; index < lines.length && out.length < MAX_IMPORTED_POINTS; index += 1) {
    const parts = lines[index].split(',');
    if (!/^\$..RMC$/.test(parts[0] || '') || String(parts[2] || '').toUpperCase() !== 'A') continue;
    const latitude = nmeaCoordinate(parts[3], String(parts[4] || '').toUpperCase());
    const longitude = nmeaCoordinate(parts[5], String(parts[6] || '').toUpperCase());
    const timestamp = nmeaUtc(parts[1], parts[9]);
    if (latitude === null || longitude === null || !timestamp) continue;
    const gga = ggaByTime.get(String(parts[1] || '').slice(0, 6));
    const point = observation(latitude, longitude, timestamp, {
      altitude: gga?.altitude,
      accuracy: gga?.hdop !== undefined ? Math.max(3, gga.hdop * 5) : undefined,
      confidence: 0.65,
      recordId: `nmea:${index + 1}`,
      metadata: {
        format: 'nmea',
        sentence: parts[0],
        speedKnots: numberOrUndefined(parts[7]),
        courseDegrees: numberOrUndefined(parts[8]),
        hdop: gga?.hdop,
        satellites: gga?.satellites,
      },
    });
    if (point) out.push(point);
  }
  return out;
}

function rowValue(row: Record<string, unknown>, names: string[]): unknown {
  const entries = Object.entries(row);
  for (const name of names) {
    const match = entries.find(([key]) => key.toLowerCase().replace(/[^a-z0-9]/g, '') === name);
    if (match) return match[1];
  }
  return undefined;
}

function parseCsvContent(content: string): SpectraImportedObservation[] {
  const rows = parseCsv(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, unknown>[];

  return rows.slice(0, MAX_IMPORTED_POINTS).flatMap((row, index) => {
    const point = observation(
      rowValue(row, ['latitude', 'lat', 'gpslatitude']),
      rowValue(row, ['longitude', 'lon', 'lng', 'gpslongitude']),
      rowValue(row, ['timestamp', 'time', 'datetime', 'observedat', 'capturedat', 'date']),
      {
        altitude: rowValue(row, ['altitude', 'alt', 'elevation']),
        accuracy: rowValue(row, ['accuracy', 'horizontalaccuracy', 'accuracymeters']),
        confidence: 0.52,
        recordId: String(rowValue(row, ['id', 'recordid']) || `csv:${index + 1}`),
        metadata: { format: 'csv' },
      },
    );
    return point ? [point] : [];
  });
}

function parseNdjson(content: string): SpectraImportedObservation[] {
  const out: SpectraImportedObservation[] = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (out.length >= MAX_IMPORTED_POINTS) break;
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const point = observation(
        row.latitude ?? row.lat ?? row.gpsLatitude,
        row.longitude ?? row.lon ?? row.lng ?? row.gpsLongitude,
        row.timestamp ?? row.observedAt ?? row.capturedAt ?? row.datetime ?? row.time,
        {
          altitude: row.altitude ?? row.alt,
          accuracy: row.accuracy ?? row.horizontalAccuracy,
          confidence: 0.52,
          recordId: String(row.id ?? row.recordId ?? `ndjson:${index + 1}`),
          metadata: { format: 'ndjson' },
        },
      );
      if (point) out.push(point);
    } catch {
      // Bad lines are isolated; valid observations in the same stream survive.
    }
  }
  return out;
}

export function importSpectraTelemetry(
  format: SpectraTelemetryImportFormat,
  content: string,
): SpectraImportedObservation[] {
  if (!content || content.length > MAX_IMPORT_CHARACTERS) {
    throw new Error('Telemetry import is empty or exceeds the supported size.');
  }

  let observations: SpectraImportedObservation[];
  if (format === 'geojson') observations = parseGeoJson(content);
  else if (format === 'gpx') observations = parseGpx(content);
  else if (format === 'kml') observations = parseKml(content);
  else if (format === 'nmea') observations = parseNmea(content);
  else if (format === 'csv') observations = parseCsvContent(content);
  else if (format === 'ndjson') observations = parseNdjson(content);
  else throw new Error('Unsupported telemetry import format.');

  const seen = new Set<string>();
  return observations.filter(point => {
    const key = [
      point.latitude.toFixed(7),
      point.longitude.toFixed(7),
      point.timestamp,
      point.recordId || '',
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_IMPORTED_POINTS);
}
