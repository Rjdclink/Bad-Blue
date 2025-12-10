// Type definitions for exif-parser
declare module 'exif-parser' {
  interface ExifTags {
    GPSLatitude?: number;
    GPSLongitude?: number;
    GPSAltitude?: number;
    GPSImgDirection?: number;
    GPSSpeed?: number;
    DateTimeOriginal?: number;
    Make?: string;
    Model?: string;
    [key: string]: any;
  }

  interface ExifResult {
    tags?: ExifTags;
    [key: string]: any;
  }

  interface ExifParser {
    parse(): ExifResult;
  }

  function create(buffer: Buffer): ExifParser;

  export default {
    create
  };
}
