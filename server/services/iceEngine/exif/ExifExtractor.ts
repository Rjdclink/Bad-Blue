import ExifParser from 'exif-parser';

export interface Upload {
  file: Buffer;
  filename: string;
  uploadedBy: string;
  consentGiven: boolean;
  purpose: 'legal-evidence' | 'public-interest';
  caseId?: string;
}

export interface LocationData {
  latitude: number;
  longitude: number;
  altitude?: number;
  direction?: number;
  speed?: number;
  timestamp: Date;
  device?: {
    make?: string;
    model?: string;
  };
  source: {
    filename: string;
    uploadedBy: string;
  };
}

export class ExifExtractor {
  async extractLocation(upload: Upload): Promise<LocationData | null> {
    try {
      const parser = ExifParser.create(upload.file);
      const result = parser.parse();

      if (!result.tags?.GPSLatitude || !result.tags?.GPSLongitude) {
        return null;
      }

      return {
        latitude: result.tags.GPSLatitude,
        longitude: result.tags.GPSLongitude,
        altitude: result.tags.GPSAltitude,
        direction: result.tags.GPSImgDirection,
        speed: result.tags.GPSSpeed,
        timestamp: result.tags.DateTimeOriginal 
          ? new Date(result.tags.DateTimeOriginal * 1000) 
          : new Date(),
        device: {
          make: result.tags.Make,
          model: result.tags.Model,
        },
        source: {
          filename: upload.filename,
          uploadedBy: upload.uploadedBy,
        },
      };
    } catch (error) {
      console.error('[ExifExtractor] Error:', error);
      return null;
    }
  }

  async extractBatch(uploads: Upload[]): Promise<LocationData[]> {
    const results = await Promise.all(
      uploads.map(upload => this.extractLocation(upload))
    );
    return results.filter(r => r !== null) as LocationData[];
  }
}

export const exifExtractor = new ExifExtractor();
