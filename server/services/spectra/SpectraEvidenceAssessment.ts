import {
  spectraAcquisitionRecordHash,
  type SpectraAcquisitionEvidenceRecord,
} from './SpectraAcquisitionRecords';

/**
 * Source-evidence correlation, separate from a subject's live coordinate
 * solver. An acquired record, camera, satellite footprint, or photograph can
 * contextualize a hypothesis but cannot verify current personal presence.
 *
 * Source snapshots are immutable inputs. Like Nomenklatura's non-destructive
 * resolver, this view combines identical evidence while retaining the URLs
 * where each underlying record was encountered.
 */
export type SpectraEvidenceKind =
  | 'retrieved_source' | 'photo_capture_scene' | 'camera_directory'
  | 'satellite_scene' | 'catalogued_scene' | 'place_context'
  | 'weather_context' | 'other_geographic_context';

export interface SpectraSourceContribution {
  key: string;
  kind: SpectraEvidenceKind;
  provider: string;
  sources: string[];
  sourceRecordId: string | null;
  sourceEventAt: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  copies: number;
  hasSceneCoordinates: boolean;
  /** All public source records are context, not authenticated person telemetry. */
  subjectPositionEligible: false;
  identityBinding: 'unverified';
}

export interface SpectraEvidenceAssessment {
  sourceRecordCount: number;
  uniqueContributionCount: number;
  duplicateCopies: number;
  providers: string[];
  countsByKind: Record<SpectraEvidenceKind, number>;
  datedSourceEvents: number;
  undatedPhotoScenes: number;
  observationsInPositionPipeline: number;
  /** A bounded preview only; all received inputs are counted. */
  contributions: SpectraSourceContribution[];
}

const KINDS: SpectraEvidenceKind[] = [
  'retrieved_source', 'photo_capture_scene', 'camera_directory',
  'satellite_scene', 'catalogued_scene', 'place_context', 'weather_context',
  'other_geographic_context',
];
const MAX_PREVIEW = 48;
const MAX_SOURCE_LINKS = 8;
const SHA256 = /^[0-9a-f]{64}$/i;
const objectValue = (v: unknown): Record<string, any> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : null;

function normalizedDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = Date.parse(value);
  return Number.isFinite(date) && date >= Date.UTC(1900, 0, 1)
    && date <= Date.now() + 5 * 60_000
    ? new Date(date).toISOString() : null;
}

function validSourceUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 4_096) return null;
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}

function kindFor(record: SpectraAcquisitionEvidenceRecord): SpectraEvidenceKind {
  const payload = record.payload;
  const structured = objectValue(payload.structuredRecord);
  if (record.recordType === 'retrieved_document') {
    return structured?.evidenceRole === 'media_capture_scene'
      ? 'photo_capture_scene' : 'retrieved_source';
  }
  const family = payload.contextFamily;
  if (family === 'cameras') return 'camera_directory';
  if (family === 'earthObservation') return 'satellite_scene';
  if (family === 'geotaggedMedia') return 'catalogued_scene';
  if (family === 'places') return 'place_context';
  if (family === 'weather') return 'weather_context';
  return 'other_geographic_context';
}

function sourceTime(
  record: SpectraAcquisitionEvidenceRecord,
  kind: SpectraEvidenceKind,
): string | null {
  const payload = record.payload;
  const source = objectValue(payload.structuredRecord);
  const context = objectValue(payload.record);
  if (kind === 'photo_capture_scene') {
    // An upload/publication timestamp cannot substitute for EXIF original.
    return source?.captureTimeStatus === 'utc_offset_present'
      ? normalizedDate(source.capturedAt) : null;
  }
  if (record.recordType === 'geographic_context') {
    return normalizedDate(context?.observedAt)
      || normalizedDate(context?.capturedAt) || null;
  }
  // These are source publication dates, not scene capture or person fix dates.
  return null;
}

function sceneHasCoordinates(
  record: SpectraAcquisitionEvidenceRecord,
  kind: SpectraEvidenceKind,
): boolean {
  if (kind === 'photo_capture_scene') {
    const geo = objectValue(objectValue(record.payload.structuredRecord)?.captureGps);
    return typeof geo?.latitude === 'number'
      && typeof geo?.longitude === 'number'
      && Number.isFinite(geo.latitude) && Number.isFinite(geo.longitude)
      && Math.abs(geo.latitude) <= 90 && Math.abs(geo.longitude) <= 180;
  }
  if (kind === 'catalogued_scene') {
    const context = objectValue(record.payload.record);
    return typeof context?.latitude === 'number'
      && typeof context?.longitude === 'number'
      && Number.isFinite(context.latitude) && Number.isFinite(context.longitude)
      && Math.abs(context.latitude) <= 90 && Math.abs(context.longitude) <= 180;
  }
  return false;
}

/** A source graph/timeline, not a covert location or identity inference path. */
export function assessSpectraAcquiredEvidence(
  records: readonly SpectraAcquisitionEvidenceRecord[],
  observationsInPositionPipeline = 0,
): SpectraEvidenceAssessment {
  const grouped = new Map<string, SpectraSourceContribution>();
  const providers = new Set<string>();
  for (const record of records) {
    if (!record || !objectValue(record.payload) || !Number.isFinite(Date.parse(record.retrievedAt))) {
      continue;
    }
    const kind = kindFor(record);
    const structured = objectValue(record.payload.structuredRecord);
    const sha = structured?.contentSha256;
    // The SAME image may be reposted on several platforms. Its bytes count
    // once as a scene, while each independently retrieved URL stays inspectable.
    const key = kind === 'photo_capture_scene' && typeof sha === 'string' && SHA256.test(sha)
      ? 'photo:' + sha.toLowerCase()
      : spectraAcquisitionRecordHash(record);
    const sources = [record.sourceUrl, structured?.sourcePostUrl]
      .map(validSourceUrl).filter((value): value is string => value !== null);
    providers.add(record.provider);
    const previous = grouped.get(key);
    if (previous) {
      previous.copies++;
      for (const url of sources) {
        if (!previous.sources.includes(url) && previous.sources.length < MAX_SOURCE_LINKS) {
          previous.sources.push(url);
        }
      }
      if (record.retrievedAt > previous.retrievedAt) previous.retrievedAt = record.retrievedAt;
      // Do not promote a later repost's publication date to capture time.
      continue;
    }
    const payload = record.payload;
    grouped.set(key, {
      key, kind, provider: record.provider,
      sources: [...new Set(sources)].slice(0, MAX_SOURCE_LINKS),
      sourceRecordId: typeof payload.sourceRecordId === 'string'
        ? payload.sourceRecordId.slice(0, 500) : null,
      sourceEventAt: sourceTime(record, kind),
      publishedAt: normalizedDate(payload.publishedAt),
      retrievedAt: record.retrievedAt,
      copies: 1,
      hasSceneCoordinates: sceneHasCoordinates(record, kind),
      subjectPositionEligible: false,
      identityBinding: 'unverified',
    });
  }
  const all = [...grouped.values()];
  const countsByKind = Object.fromEntries(KINDS.map(kind => [kind, 0]))
    as Record<SpectraEvidenceKind, number>;
  for (const record of all) countsByKind[record.kind]++;
  return {
    sourceRecordCount: all.reduce((sum, item) => sum + item.copies, 0),
    uniqueContributionCount: all.length,
    duplicateCopies: all.reduce((sum, item) => sum + item.copies - 1, 0),
    providers: [...providers].sort(),
    countsByKind,
    datedSourceEvents: all.filter(item => item.sourceEventAt !== null).length,
    undatedPhotoScenes: all.filter(item =>
      item.kind === 'photo_capture_scene' && item.sourceEventAt === null).length,
    observationsInPositionPipeline: Number.isFinite(observationsInPositionPipeline)
      ? Math.max(0, Math.floor(observationsInPositionPipeline)) : 0,
    contributions: all.sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt))
      .slice(0, MAX_PREVIEW),
  };
}
