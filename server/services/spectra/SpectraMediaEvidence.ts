/**
 * Assess what a media file's embedded geotag establishes. This is a
 * measurement of the MEDIA CAPTURE SCENE at a time, not an authenticated
 * observation of the subject or their current position.
 */
import type { MediaMetadataReport } from '../locationIntelligence/MediaMetadataExtractor';

export type SpectraMediaCaptureStatus =
  | 'accepted' | 'missing_gps' | 'invalid_gps' | 'conflicting_gps'
  | 'missing_capture_time' | 'future_capture_time';

export interface SpectraMediaCaptureAssessment {
  status: SpectraMediaCaptureStatus;
  evidenceRole: 'media_capture_scene';
  capturedAt?: string;
  ageMs?: number;
  ageBand?: 'within_24_hours' | 'within_7_days' | 'within_30_days' | 'older';
  subjectPresenceVerified: false;
  currentPositionVerified: false;
  metadataConflictCount: number;
}

export function assessSpectraMediaCapture(
  metadata: Pick<MediaMetadataReport, 'gps' | 'metadataConflicts'>,
  asOf: Date = new Date(),
): SpectraMediaCaptureAssessment {
  if (!Number.isFinite(asOf.getTime())) {
    throw new Error('A valid evaluation time is required.');
  }
  const base: SpectraMediaCaptureAssessment = {
    status: 'missing_gps',
    evidenceRole: 'media_capture_scene',
    subjectPresenceVerified: false,
    currentPositionVerified: false,
    metadataConflictCount: metadata.metadataConflicts.length,
  };
  const gps = metadata.gps;
  if (!gps) return base;
  if (
    !Number.isFinite(gps.latitude) || !Number.isFinite(gps.longitude)
    || Math.abs(gps.latitude) > 90 || Math.abs(gps.longitude) > 180
  ) return { ...base, status: 'invalid_gps' };
  if (metadata.metadataConflicts.some(value =>
    /(?:gps|coordinates|geolocation)/i.test(value)
  )) return { ...base, status: 'conflicting_gps' };

  const time = gps.timestamp instanceof Date ? gps.timestamp.getTime() : NaN;
  if (!Number.isFinite(time) || time < Date.UTC(1900, 0, 1)) {
    return { ...base, status: 'missing_capture_time' };
  }
  const ageMs = asOf.getTime() - time;
  if (ageMs < -5 * 60_000) return { ...base, status: 'future_capture_time' };
  const safeAge = Math.max(0, ageMs);
  const day = 86_400_000;
  return {
    ...base,
    status: 'accepted',
    capturedAt: new Date(time).toISOString(),
    ageMs: safeAge,
    ageBand: safeAge < day ? 'within_24_hours' :
      safeAge < 7 * day ? 'within_7_days' :
      safeAge < 30 * day ? 'within_30_days' : 'older',
  };
}
