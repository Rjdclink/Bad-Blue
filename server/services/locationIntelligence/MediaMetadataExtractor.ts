import * as ExifReader from 'exifreader';
import { extractGPSFromFile, type GPSCoordinates } from '../gpsIntelligence';
import { exifToolExtractor } from './ExifToolExtractor';

export interface MediaMetadataReport {
  fileName: string;
  gps?: GPSCoordinates;
  capture: {
    dateTimeOriginal?: string;
    createDate?: string;
    modifyDate?: string;
    offsetTimeOriginal?: string;
    gpsDateStamp?: string;
    gpsTimeStamp?: string;
  };
  device: {
    make?: string;
    model?: string;
    lensMake?: string;
    lensModel?: string;
    software?: string;
    serialNumber?: string;
    imageUniqueId?: string;
  };
  movement: {
    directionDegrees?: number;
    directionRef?: string;
    speed?: number;
    speedRef?: string;
    destinationBearing?: number;
    destinationDistance?: number;
  };
  positioning: {
    horizontalErrorMeters?: number;
    dilutionOfPrecision?: number;
    satellites?: string;
    measureMode?: string;
    processingMethod?: string;
    areaInformation?: string;
  };
  image: {
    width?: number;
    height?: number;
    orientation?: string;
    focalLength?: number;
    focalLength35mm?: number;
    exposureTime?: string;
    fNumber?: number;
    iso?: number;
  };
  provenance: {
    artist?: string;
    copyright?: string;
    hostComputer?: string;
    creatorTool?: string;
    metadataDate?: string;
  };
  extractor: 'exifreader' | 'exiftool-fallback' | 'none';
}

function description(tags: any, ...names: string[]): string | undefined {
  for (const name of names) {
    const tag = tags?.[name];
    if (!tag) continue;
    const value = tag.description ?? tag.value;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      const flattened = value.flat?.(2) ?? value;
      return flattened.map((item: any) => {
        if (typeof item === 'object' && item !== null && 'numerator' in item && 'denominator' in item) {
          return Number(item.numerator) / Math.max(1, Number(item.denominator));
        }
        return String(item);
      }).join(', ');
    }
    return String(value);
  }
  return undefined;
}

function numberValue(tags: any, ...names: string[]): number | undefined {
  const value = description(tags, ...names);
  if (!value) return undefined;
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function extractMediaMetadata(
  filePath: string,
  fileName: string,
): Promise<MediaMetadataReport> {
  const gps = await extractGPSFromFile(filePath).catch(() => null);

  try {
    const tags = await ExifReader.load(filePath, { expanded: false } as any) as any;

    return {
      fileName,
      gps: gps || undefined,
      capture: {
        dateTimeOriginal: description(tags, 'DateTimeOriginal'),
        createDate: description(tags, 'CreateDate', 'DateTimeDigitized'),
        modifyDate: description(tags, 'ModifyDate', 'DateTime'),
        offsetTimeOriginal: description(tags, 'OffsetTimeOriginal'),
        gpsDateStamp: description(tags, 'GPSDateStamp'),
        gpsTimeStamp: description(tags, 'GPSTimeStamp'),
      },
      device: {
        make: description(tags, 'Make'),
        model: description(tags, 'Model'),
        lensMake: description(tags, 'LensMake'),
        lensModel: description(tags, 'LensModel'),
        software: description(tags, 'Software'),
        serialNumber: description(tags, 'BodySerialNumber', 'SerialNumber', 'CameraSerialNumber'),
        imageUniqueId: description(tags, 'ImageUniqueID', 'ImageUniqueId'),
      },
      movement: {
        directionDegrees: numberValue(tags, 'GPSImgDirection', 'GPSTrack'),
        directionRef: description(tags, 'GPSImgDirectionRef', 'GPSTrackRef'),
        speed: numberValue(tags, 'GPSSpeed'),
        speedRef: description(tags, 'GPSSpeedRef'),
        destinationBearing: numberValue(tags, 'GPSDestBearing'),
        destinationDistance: numberValue(tags, 'GPSDestDistance'),
      },
      positioning: {
        horizontalErrorMeters: numberValue(tags, 'GPSHPositioningError'),
        dilutionOfPrecision: numberValue(tags, 'GPSDOP'),
        satellites: description(tags, 'GPSSatellites'),
        measureMode: description(tags, 'GPSMeasureMode'),
        processingMethod: description(tags, 'GPSProcessingMethod'),
        areaInformation: description(tags, 'GPSAreaInformation'),
      },
      image: {
        width: numberValue(tags, 'ImageWidth', 'PixelXDimension'),
        height: numberValue(tags, 'ImageHeight', 'PixelYDimension'),
        orientation: description(tags, 'Orientation'),
        focalLength: numberValue(tags, 'FocalLength'),
        focalLength35mm: numberValue(tags, 'FocalLengthIn35mmFilm', 'FocalLengthIn35mmFormat'),
        exposureTime: description(tags, 'ExposureTime'),
        fNumber: numberValue(tags, 'FNumber'),
        iso: numberValue(tags, 'ISOSpeedRatings', 'PhotographicSensitivity', 'ISO'),
      },
      provenance: {
        artist: description(tags, 'Artist'),
        copyright: description(tags, 'Copyright'),
        hostComputer: description(tags, 'HostComputer'),
        creatorTool: description(tags, 'CreatorTool'),
        metadataDate: description(tags, 'MetadataDate'),
      },
      extractor: 'exifreader',
    };
  } catch {
    // ExifTool is optional at runtime. Use it as a broader media-container fallback
    // when installed, particularly for video/QuickTime metadata.
    if (await exifToolExtractor.checkInstalled().catch(() => false)) {
      const location = await exifToolExtractor.extractLocation(filePath);
      return {
        fileName,
        gps: location
          ? {
              latitude: location.latitude,
              longitude: location.longitude,
              altitude: location.altitude,
              timestamp: location.timestamp,
            }
          : gps || undefined,
        capture: {},
        device: {},
        movement: {},
        positioning: {},
        image: {},
        provenance: {},
        extractor: 'exiftool-fallback',
      };
    }

    return {
      fileName,
      gps: gps || undefined,
      capture: {},
      device: {},
      movement: {},
      positioning: {},
      image: {},
      provenance: {},
      extractor: 'none',
    };
  }
}
