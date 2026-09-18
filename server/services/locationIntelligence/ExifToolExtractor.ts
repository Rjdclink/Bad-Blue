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
    if (
      latitude === null ||
      longitude === null ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return null;
    }

    const location: ExifLocation = {
      latitude,
      longitude,
      source: imagePath,
      altitude: this.number(metadata.GPSAltitude) ?? undefined,
    };

    const rawTimestamp =
      metadata.GPSDateTime ||
      metadata.DateTimeOriginal ||
      metadata.CreateDate ||
      metadata.MediaCreateDate ||
      metadata.TrackCreateDate;

    const timestamp = this.parseTimestamp(rawTimestamp);
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
