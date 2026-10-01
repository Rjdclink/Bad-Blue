import { createHash } from 'crypto';
import path from 'path';

export interface MediaIntegrityResult {
  contentSha256: string;
  detectedMimeType: string;
  claimedMimeType: string;
  fileName: string;
  compatible: boolean;
  reason?: string;
}

const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/csv',
  'text/markdown',
  'text/html',
  'text/xml',
  'application/json',
  'application/rtf',
  'message/rfc822',
]);

function startsWithHex(bytes: Buffer, hex: string): boolean {
  const expected = Buffer.from(hex.replace(/\s+/g, ''), 'hex');
  return bytes.length >= expected.length && bytes.subarray(0, expected.length).equals(expected);
}

function mostlyText(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  if (!sample.length) return false;
  let printable = 0;
  for (const value of sample) {
    if (value === 9 || value === 10 || value === 13 || (value >= 32 && value <= 126) || value >= 0xc2) printable += 1;
  }
  return printable / sample.length >= 0.9;
}

function detectZipOffice(bytes: Buffer): string {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4 * 1024 * 1024)).toString('latin1');
  if (sample.includes('word/document.xml')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (sample.includes('xl/workbook.xml')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return 'application/zip';
}

export function detectMediaMimeType(bytes: Buffer, claimedMimeType: string): string {
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (startsWithHex(bytes, 'ffd8ff')) return 'image/jpeg';
  if (startsWithHex(bytes, '89504e470d0a1a0a')) return 'image/png';
  if (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp';
  if (startsWithHex(bytes, '49492a00') || startsWithHex(bytes, '4d4d002a')) return 'image/tiff';

  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav';
  if (bytes.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';
  if (bytes.subarray(0, 3).toString('ascii') === 'ID3' || startsWithHex(bytes, 'fffb') || startsWithHex(bytes, 'fff3') || startsWithHex(bytes, 'fff2')) return 'audio/mpeg';

  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'AVI ') return 'video/x-msvideo';
  if (startsWithHex(bytes, '1a45dfa3')) return 'video/webm';
  if (startsWithHex(bytes, '000001ba') || startsWithHex(bytes, '000001b3')) return 'video/mpeg';
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    return claimedMimeType === 'audio/mp4' || claimedMimeType === 'audio/x-m4a' ? claimedMimeType : 'video/mp4';
  }

  if (startsWithHex(bytes, '504b0304')) return detectZipOffice(bytes);
  if (startsWithHex(bytes, 'd0cf11e0a1b11ae1')) return 'application/x-ole-storage';

  if (TEXT_MIME_TYPES.has(claimedMimeType) && mostlyText(bytes)) return claimedMimeType;
  return 'application/octet-stream';
}

function mimeCompatible(claimed: string, detected: string, fileName: string): boolean {
  if (claimed === detected) return true;
  if (detected === 'application/x-ole-storage') {
    return [
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.ms-outlook',
    ].includes(claimed);
  }
  if (detected === 'video/mp4') {
    return ['video/mp4', 'video/quicktime', 'audio/mp4', 'audio/x-m4a'].includes(claimed);
  }
  if (detected === 'audio/mp4') {
    return ['audio/mp4', 'audio/x-m4a', 'video/mp4'].includes(claimed);
  }
  if (TEXT_MIME_TYPES.has(claimed) && TEXT_MIME_TYPES.has(detected)) return true;

  const ext = path.extname(fileName).toLowerCase();
  if ((ext === '.mov' || ext === '.qt') && detected === 'video/mp4' && claimed === 'video/quicktime') return true;
  return false;
}

export function inspectMediaFile(bytes: Buffer, claimedMimeType: string, fileName: string): MediaIntegrityResult {
  const detectedMimeType = detectMediaMimeType(bytes, claimedMimeType);
  const compatible = mimeCompatible(claimedMimeType, detectedMimeType, fileName);
  return {
    contentSha256: createHash('sha256').update(bytes).digest('hex'),
    detectedMimeType,
    claimedMimeType,
    fileName,
    compatible,
    reason: compatible
      ? undefined
      : detectedMimeType === 'application/octet-stream'
        ? 'The uploaded bytes do not match a supported, verifiable media format.'
        : `The uploaded bytes identify as ${detectedMimeType}, not the claimed ${claimedMimeType} type.`,
  };
}
