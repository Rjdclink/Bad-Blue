import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ExifLocation {
  latitude: number;
  longitude: number;
  timestamp?: Date;
  source: string;
  altitude?: number;
}

function parseIso6709(value: unknown): { latitude: number; longitude: number; altitude?: number } | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;

  // ISO 6709 commonly appears as +DD.DDDD-DDD.DDDD+AAA.AAA/.
  const compact = text.match(
    /^([+-]\d{2}(?:\.\d+)?)([+-]\d{3}(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?\/?$/,
  );
  if (compact) {
    const latitude = Number(compact[1]);
    const longitude = Number(compact[2]);
    const altitude = compact[3] === undefined ? undefined : Number(compact[3]);
    if (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 && latitude <= 90 &&
      longitude >= -180 && longitude <= 180
    ) {
      return {
        latitude,
        longitude,
        altitude: Number.isFinite(altitude) ? altitude : undefined,
      };
    }
  }

  // ExifTool may normalize QuickTime GPSCoordinates to whitespace/comma
  // separated decimal numbers when -n is used.
  const decimal = text.match(
    /^\s*([+-]?\d{1,2}(?:\.\d+)?)\s*[, ]\s*([+-]?\d{1,3}(?:\.\d+)?)(?:\s*[, ]\s*([+-]?\d+(?:\.\d+)?))?\s*\/?\s*$/,
  );
  if (!decimal) return null;

  const latitude = Number(decimal[1]);
  const longitude = Number(decimal[2]);
  const altitude = decimal[3] === undefined ? undefined : Number(decimal[3]);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 ||
    longitude < -180 || longitude > 180
  ) {
    return null;
  }

  return {
    latitude,
    longitude,
    altitude: Number.isFinite(altitude) ? altitude : undefined,
  };
}

export class ExifToolExtractor {
  async extractMetadata(filePath: string): Promise<Record<string, unknown> | null> {
    try {
      const { stdout } = await execFileAsync(
        'exiftool',
        ['-j', '-n', '-a', '-u', filePath],
        { maxBuffer: 4 * 1024 * 1024 },
      );
      const parsed = JSON.parse(stdout);
      if (!Array.isArray(parsed) || parsed.length === 0) return null;
      return parsed[0] as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async extractLocation(imagePath: string): Promise<ExifLocation | null> {
    const metadata = await this.extractMetadata(imagePath);
    if (!metadata) return null;

    const latitude = this.number(metadata.GPSLatitude);
    const longitude = this.number(metadata.GPSLongitude);
    const iso6709 =
      parseIso6709(metadata.GPSCoordinates) ||
      parseIso6709(metadata.LocationISO6709);

    const resolvedLatitude = latitude ?? iso6709?.latitude ?? null;
    const resolvedLongitude = longitude ?? iso6709?.longitude ?? null;
    if (
      resolvedLatitude === null ||
      resolvedLongitude === null ||
      resolvedLatitude < -90 ||
      resolvedLatitude > 90 ||
      resolvedLongitude < -180 ||
      resolvedLongitude > 180
    ) {
      return null;
    }

    const location: ExifLocation = {
      latitude: resolvedLatitude,
      longitude: resolvedLongitude,
      source: imagePath,
      altitude:
        this.number(metadata.GPSAltitude) ??
        iso6709?.altitude ??
        undefined,
    };

    const gpsUtcTimestamp = this.parseGpsUtcTimestamp(
      metadata.GPSDateStamp,
      metadata.GPSTimeStamp,
    );
    const rawTimestamp =
      metadata.GPSDateTime ||
      metadata.DateTimeOriginal ||
      metadata.CreateDate ||
      metadata.MediaCreateDate ||
      metadata.TrackCreateDate;

    const timestamp = gpsUtcTimestamp || this.parseTimestamp(rawTimestamp);
    if (timestamp) location.timestamp = timestamp;

    return location;
  }

  async extractBatch(imagePaths: string[]): Promise<ExifLocation[]> {
    const results = await Promise.all(
      imagePaths.map(path => this.extractLocation(path))
    );
    return results.filter((loc): loc is ExifLocation => loc !== null);
  }

  private number(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private parseGpsUtcTimestamp(dateValue: unknown, timeValue: unknown): Date | undefined {
    if (typeof dateValue !== 'string' || typeof timeValue !== 'string') return undefined;

    const dateMatch = dateValue.trim().match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})$/);
    const timeParts = timeValue.match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
    if (!dateMatch || timeParts.length < 3 || !timeParts.every(Number.isFinite)) {
      return undefined;
    }

    const seconds = timeParts[2];
    const millis = Date.UTC(
      Number(dateMatch[1]),
      Number(dateMatch[2]) - 1,
      Number(dateMatch[3]),
      Math.floor(timeParts[0]),
      Math.floor(timeParts[1]),
      Math.floor(seconds),
      Math.round((seconds % 1) * 1000),
    );
    const parsed = new Date(millis);
    return Number.isFinite(parsed.getTime()) ? parsed : undefined;
  }

  private parseTimestamp(value: unknown): Date | undefined {
    if (typeof value !== 'string' || !value.trim()) return undefined;

    const text = value.trim();
    const normalized = text
      .replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
      .replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    const hasAbsoluteZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
    if (!hasAbsoluteZone) return undefined;

    const parsed = new Date(normalized);
    return Number.isFinite(parsed.getTime()) ? parsed : undefined;
  }

  async checkInstalled(): Promise<boolean> {
    try {
      await execFileAsync('exiftool', ['-ver']);
      return true;
    } catch {
      return false;
    }
  }
}

export const exifToolExtractor = new ExifToolExtractor();
