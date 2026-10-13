import ExifReader from 'exifreader';
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
    documentId?: string;
    instanceId?: string;
    originalDocumentId?: string;
  };
  locationDescriptors: {
    created?: {
      sublocation?: string;
      city?: string;
      state?: string;
      country?: string;
      countryCode?: string;
    };
    shown?: {
      sublocation?: string;
      city?: string;
      state?: string;
      country?: string;
      countryCode?: string;
    };
    quickTime?: {
      iso6709?: string;
      locationName?: string;
      locationRole?: string;
    };
  };
  metadataConflicts: string[];
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

function rawString(raw: Record<string, unknown> | null, ...names: string[]): string | undefined {
  if (!raw) return undefined;
  for (const name of names) {
    const value = raw[name];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) return value.map(String).join(', ');
    return String(value);
  }
  return undefined;
}

function rawNumber(raw: Record<string, unknown> | null, ...names: string[]): number | undefined {
  const value = rawString(raw, ...names);
  if (!value) return undefined;
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function compactObject<T extends Record<string, string | undefined>>(value: T): T | undefined {
  return Object.values(value).some(Boolean) ? value : undefined;
}

export async function extractMediaMetadata(
  filePath: string,
  fileName: string,
): Promise<MediaMetadataReport> {
  const gps = await extractGPSFromFile(filePath).catch(() => null);

  try {
    const tags = await ExifReader.load(filePath, { expanded: false } as any) as any;

    // Video/container metadata and metadata-poor images are where ExifTool is
    // materially richer (QuickTime/ISO-6709/XMP/IPTC). Prefer it when available
    // instead of accepting a partial ExifReader parse as "complete".
    const containerMetadataPreferred =
      /\.(?:mp4|mov|m4v|3gp|3g2|avi|mkv|webm)$/i.test(fileName) ||
      !gps ||
      !gps.timestamp;
    if (
      containerMetadataPreferred &&
      await exifToolExtractor.checkInstalled().catch(() => false)
    ) {
      throw new Error('prefer-exiftool-container-metadata');
    }

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
        documentId: description(tags, 'DocumentID', 'DocumentId'),
        instanceId: description(tags, 'InstanceID', 'InstanceId'),
        originalDocumentId: description(tags, 'OriginalDocumentID', 'OriginalDocumentId'),
      },
      locationDescriptors: {
        created: compactObject({
          sublocation: description(tags, 'LocationCreatedSublocation', 'Sublocation'),
          city: description(tags, 'LocationCreatedCity', 'City'),
          state: description(tags, 'LocationCreatedProvinceState', 'State', 'ProvinceState'),
          country: description(tags, 'LocationCreatedCountryName', 'Country'),
          countryCode: description(tags, 'LocationCreatedCountryCode', 'CountryCode'),
        }),
        shown: compactObject({
          sublocation: description(tags, 'LocationShownSublocation'),
          city: description(tags, 'LocationShownCity'),
          state: description(tags, 'LocationShownProvinceState'),
          country: description(tags, 'LocationShownCountryName'),
          countryCode: description(tags, 'LocationShownCountryCode'),
        }),
        quickTime: compactObject({
          iso6709: description(tags, 'GPSCoordinates', 'LocationISO6709', 'LocationInformation'),
          locationName: description(tags, 'LocationName'),
          locationRole: description(tags, 'LocationRole'),
        }),
      },
      metadataConflicts: [],
      extractor: 'exifreader',
    };
  } catch {
    // ExifTool is optional at runtime. Use it as a broader media-container fallback
    // when installed, particularly for video/QuickTime metadata.
    if (await exifToolExtractor.checkInstalled().catch(() => false)) {
      const [location, raw] = await Promise.all([
        exifToolExtractor.extractLocation(filePath),
        exifToolExtractor.extractMetadata(filePath),
      ]);
      const locationFromExifTool = location
        ? {
            latitude: location.latitude,
            longitude: location.longitude,
            altitude: location.altitude,
            timestamp: location.timestamp,
            accuracy: rawNumber(raw, 'GPSHPositioningError', 'HorizontalPositioningError'),
          }
        : undefined;
      const primaryGps = locationFromExifTool || gps || undefined;
      const conflicts: string[] = [];
      if (
        locationFromExifTool &&
        gps &&
        (
          Math.abs(locationFromExifTool.latitude - gps.latitude) > 0.00001 ||
          Math.abs(locationFromExifTool.longitude - gps.longitude) > 0.00001
        )
      ) {
        conflicts.push('EXIFReader and ExifTool reported different GPS coordinates.');
      }

      return {
        fileName,
        gps: primaryGps,
        capture: {
          dateTimeOriginal: rawString(raw, 'DateTimeOriginal'),
          createDate: rawString(raw, 'CreateDate', 'MediaCreateDate', 'TrackCreateDate'),
          modifyDate: rawString(raw, 'ModifyDate', 'MediaModifyDate', 'TrackModifyDate'),
          offsetTimeOriginal: rawString(raw, 'OffsetTimeOriginal'),
          gpsDateStamp: rawString(raw, 'GPSDateStamp'),
          gpsTimeStamp: rawString(raw, 'GPSTimeStamp', 'GPSDateTime'),
        },
        device: {
          make: rawString(raw, 'Make'),
          model: rawString(raw, 'Model'),
          lensMake: rawString(raw, 'LensMake'),
          lensModel: rawString(raw, 'LensModel'),
          software: rawString(raw, 'Software', 'Encoder'),
          serialNumber: rawString(raw, 'BodySerialNumber', 'SerialNumber', 'CameraSerialNumber'),
          imageUniqueId: rawString(raw, 'ImageUniqueID', 'ImageUniqueId'),
        },
        movement: {
          directionDegrees: rawNumber(raw, 'GPSImgDirection', 'GPSTrack'),
          directionRef: rawString(raw, 'GPSImgDirectionRef', 'GPSTrackRef'),
          speed: rawNumber(raw, 'GPSSpeed'),
          speedRef: rawString(raw, 'GPSSpeedRef'),
          destinationBearing: rawNumber(raw, 'GPSDestBearing'),
          destinationDistance: rawNumber(raw, 'GPSDestDistance'),
        },
        positioning: {
          horizontalErrorMeters: rawNumber(raw, 'GPSHPositioningError', 'HorizontalPositioningError'),
          dilutionOfPrecision: rawNumber(raw, 'GPSDOP'),
          satellites: rawString(raw, 'GPSSatellites'),
          measureMode: rawString(raw, 'GPSMeasureMode'),
          processingMethod: rawString(raw, 'GPSProcessingMethod'),
          areaInformation: rawString(raw, 'GPSAreaInformation'),
        },
        image: {
          width: rawNumber(raw, 'ImageWidth', 'SourceImageWidth'),
          height: rawNumber(raw, 'ImageHeight', 'SourceImageHeight'),
          orientation: rawString(raw, 'Orientation'),
          focalLength: rawNumber(raw, 'FocalLength'),
          focalLength35mm: rawNumber(raw, 'FocalLengthIn35mmFormat', 'FocalLengthIn35mmFilm'),
          exposureTime: rawString(raw, 'ExposureTime'),
          fNumber: rawNumber(raw, 'FNumber'),
          iso: rawNumber(raw, 'ISO', 'PhotographicSensitivity'),
        },
        provenance: {
          artist: rawString(raw, 'Artist'),
          copyright: rawString(raw, 'Copyright'),
          hostComputer: rawString(raw, 'HostComputer'),
          creatorTool: rawString(raw, 'CreatorTool', 'Software'),
          metadataDate: rawString(raw, 'MetadataDate'),
          documentId: rawString(raw, 'DocumentID', 'DocumentId'),
          instanceId: rawString(raw, 'InstanceID', 'InstanceId'),
          originalDocumentId: rawString(raw, 'OriginalDocumentID', 'OriginalDocumentId'),
        },
        locationDescriptors: {
          created: compactObject({
            sublocation: rawString(raw, 'LocationCreatedSublocation', 'Sublocation'),
            city: rawString(raw, 'LocationCreatedCity', 'City'),
            state: rawString(raw, 'LocationCreatedProvinceState', 'State', 'ProvinceState'),
            country: rawString(raw, 'LocationCreatedCountryName', 'Country'),
            countryCode: rawString(raw, 'LocationCreatedCountryCode', 'CountryCode'),
          }),
          shown: compactObject({
            sublocation: rawString(raw, 'LocationShownSublocation'),
            city: rawString(raw, 'LocationShownCity'),
            state: rawString(raw, 'LocationShownProvinceState'),
            country: rawString(raw, 'LocationShownCountryName'),
            countryCode: rawString(raw, 'LocationShownCountryCode'),
          }),
          quickTime: compactObject({
            iso6709: rawString(raw, 'GPSCoordinates', 'LocationISO6709', 'LocationInformation'),
            locationName: rawString(raw, 'LocationName'),
            locationRole: rawString(raw, 'LocationRole'),
          }),
        },
        metadataConflicts: conflicts,
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
      locationDescriptors: {},
      metadataConflicts: [],
      extractor: 'none',
    };
  }
}
