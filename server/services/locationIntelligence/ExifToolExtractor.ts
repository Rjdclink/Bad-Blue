import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ExifLocation {
  latitude: number;
  longitude: number;
  timestamp?: Date;
  source: string;
  altitude?: number;
}

export class ExifToolExtractor {
  async extractLocation(imagePath: string): Promise<ExifLocation | null> {
    try {
      // Validate file path to prevent command injection
      // Only allow alphanumeric, dots, hyphens, underscores, forward slashes, and spaces
      if (!/^[a-zA-Z0-9._\-\/ ]+$/.test(imagePath)) {
        console.error(`[ExifTool] Invalid file path format: ${imagePath}`);
        return null;
      }
      
      // Additional sanitization: escape any special characters that passed the whitelist
      const sanitizedPath = imagePath.replace(/["'`$\\]/g, '\\$&');
      
      const { stdout } = await execAsync(
        `exiftool -j -GPSLatitude -GPSLongitude -GPSLatitudeRef -GPSLongitudeRef -GPSAltitude -CreateDate -DateTimeOriginal "${sanitizedPath}"`
      );

      const data = JSON.parse(stdout)[0];

      if (!data.GPSLatitude || !data.GPSLongitude) {
        console.log(`[ExifTool] No GPS data in ${imagePath}`);
        return null;
      }

      const latitude = this.parseGPS(data.GPSLatitude, data.GPSLatitudeRef);
      const longitude = this.parseGPS(data.GPSLongitude, data.GPSLongitudeRef);

      // Validate parsed coordinates
      if (latitude === null || longitude === null) {
        console.error(`[ExifTool] Invalid GPS coordinates in ${imagePath}`);
        return null;
      }

      const location: ExifLocation = {
        latitude,
        longitude,
        source: imagePath,
        altitude: data.GPSAltitude ? parseFloat(data.GPSAltitude) : undefined,
      };

      const timestamp = data.DateTimeOriginal || data.CreateDate;
      if (timestamp) {
        location.timestamp = new Date(timestamp.replace(/(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'));
      }

      console.log(`[ExifTool] Extracted: ${location.latitude}, ${location.longitude}`);
      return location;
    } catch (error) {
      console.error(`[ExifTool] Error extracting from ${imagePath}:`, error);
      return null;
    }
  }

  async extractBatch(imagePaths: string[]): Promise<ExifLocation[]> {
    const results = await Promise.all(
      imagePaths.map(path => this.extractLocation(path))
    );
    return results.filter((loc): loc is ExifLocation => loc !== null);
  }

  private parseGPS(coord: string, ref: string): number | null {
    if (typeof coord === 'number') {
      return ref === 'S' || ref === 'W' ? -coord : coord;
    }

    const match = coord.match(/(\d+)\s*deg\s*(\d+)'\s*([\d.]+)"/);
    if (match) {
      const deg = parseFloat(match[1]);
      const min = parseFloat(match[2]);
      const sec = parseFloat(match[3]);
      let decimal = deg + min / 60 + sec / 3600;
      return ref === 'S' || ref === 'W' ? -decimal : decimal;
    }

    const parsed = parseFloat(coord);
    if (isNaN(parsed)) {
      console.warn(`[ExifTool] Invalid coordinate value: ${coord}`);
      return null;
    }
    return parsed;
  }

  async checkInstalled(): Promise<boolean> {
    try {
      await execAsync('exiftool -ver');
      return true;
    } catch {
      console.warn('[ExifTool] Not installed. Install: apt-get install libimage-exiftool-perl');
      return false;
    }
  }
}

export const exifToolExtractor = new ExifToolExtractor();
