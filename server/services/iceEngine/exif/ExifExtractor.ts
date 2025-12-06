import ExifParser from 'exif-parser';

export interface ConsentedUpload {
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
    consentGiven: boolean;
  };
}

export class ExifExtractor {
  async extractLocation(upload: ConsentedUpload): Promise<LocationData | null> {
    if (!upload.consentGiven) {
      throw new Error('Cannot extract EXIF without explicit user consent');
    }

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
          consentGiven: upload.consentGiven,
        },
      };
    } catch (error) {
      console.error('[ExifExtractor] Error:', error);
      return null;
    }
  }

  async extractBatch(uploads: ConsentedUpload[]): Promise<LocationData[]> {
    const results = await Promise.all(
      uploads.map(upload => this.extractLocation(upload))
    );
    return results.filter(r => r !== null) as LocationData[];
  }

  validateConsent(uploads: ConsentedUpload[]): { valid: ConsentedUpload[]; invalid: ConsentedUpload[] } {
    const valid = uploads.filter(u => u.consentGiven);
    const invalid = uploads.filter(u => !u.consentGiven);
    return { valid, invalid };
  }
}

export const exifExtractor = new ExifExtractor();
