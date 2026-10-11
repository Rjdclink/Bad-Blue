import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

/** An archived snapshot of content already returned by an acquisition adapter. */
export interface SpectraAcquisitionEvidenceRecord {
  recordType: 'retrieved_document' | 'geographic_context';
  provider: string;
  sourceUrl?: string;
  retrievedAt: string;
  payload: Record<string, unknown>;
}

export interface SpectraStoredAcquisitionEvidenceRecord extends SpectraAcquisitionEvidenceRecord {
  id: string;
  contentSha256: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface SpectraEvidenceRecordOmissions {
  invalid: number;
  recordTooLarge: number;
  batchLimit: number;
  storageUnavailable: number;
  /** Identical input snapshots are already represented in the retained batch. */
  duplicate: number;
}

export const SPECTRA_EVIDENCE_RECORD_MAX_BYTES = 256 * 1024;
export const SPECTRA_EVIDENCE_BATCH_MAX_BYTES = 2 * 1024 * 1024;
export const SPECTRA_EVIDENCE_BATCH_MAX_RECORDS = 500;

interface PreparedEvidenceRecord extends SpectraAcquisitionEvidenceRecord {
  contentSha256: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface SpectraPreparedEvidenceRecords {
  records: PreparedEvidenceRecord[];
  omissions: SpectraEvidenceRecordOmissions;
  omittedCount: number;
  bytes: number;
}

type ObjectValue = Record<string, unknown>;
const objectValue = (value: unknown): ObjectValue | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as ObjectValue : undefined;
const textValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;
const dateValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
};

/**
 * Search hits alone are not archived as retrieved evidence. Only the fields
 * written by successful page retrieval are eligible; no title/snippet fallback
 * is taken from the search engine. Context inputs are already fetched adapter
 * results, stored as normalized records, not photographs or raw HTTP bytes.
 */
export function buildSpectraAcquisitionRecords(
  discoveryResults: readonly unknown[],
  contextEvidence?: {
    places?: readonly unknown[];
    cameras?: readonly unknown[];
    geotaggedMedia?: readonly unknown[];
    earthObservation?: readonly unknown[];
    weather?: unknown;
  },
): SpectraAcquisitionEvidenceRecord[] {
  const records: SpectraAcquisitionEvidenceRecord[] = [];
  for (const raw of discoveryResults) {
    const result = objectValue(raw);
    const metadata = objectValue(result?.metadata);
    if (!result || !metadata) continue;
    const retrievedAt = dateValue(metadata.retrievedAt);
    const title = textValue(metadata.fetchedTitle);
    const textExcerpt = textValue(metadata.fetchedExcerpt);
    const structuredRecord = metadata.fetchedRecord !== null && typeof metadata.fetchedRecord === 'object'
      ? metadata.fetchedRecord : undefined;
    const structuredRecordOmitted = metadata.fetchedRecordOmitted === true;
    const rawAddressBlocks = metadata.fetchedAddressBlocks || metadata.addressBlocks;
    const addressBlocks = Array.isArray(rawAddressBlocks)
      ? rawAddressBlocks.filter((value): value is string => Boolean(textValue(value))) : [];
    const locationEvidence = Array.isArray(metadata.retrievedLocationEvidence)
      ? metadata.retrievedLocationEvidence.flatMap(value => {
          const point = objectValue(value);
          return point ? [{
            ...point,
            kind: 'public_source_geospatial_context',
            subjectMatchConfidence: 0,
            currentPositionVerified: false,
          }] : [];
        }) : [];
    const hasExtractedContent = Boolean(title || textExcerpt || addressBlocks.length || locationEvidence.length);
    if (!retrievedAt || (!hasExtractedContent && !structuredRecord && !structuredRecordOmitted)) continue;
    const metadataOnly = !hasExtractedContent && !structuredRecord;

    records.push({
      recordType: 'retrieved_document',
      provider: textValue(metadata.retrievalProvider) || 'public-web-retrieval',
      sourceUrl: textValue(metadata.sourceUrl) || textValue(result.url),
      retrievedAt,
      payload: {
        snapshotKind: structuredRecord ? 'structured_record' : metadataOnly ? 'retrieval_metadata' : 'extracted_document',
        classification: metadataOnly ? 'retrieved_source_metadata' : 'retrieved_source_document',
        requestedUrl: textValue(metadata.requestedUrl),
        discoveryProvider: textValue(metadata.discoveryProvider) || textValue(result.provider),
        title,
        textExcerpt,
        structuredRecord,
        structuredRecordOmitted: structuredRecordOmitted || undefined,
        contentType: textValue(metadata.fetchedContentType) || textValue(metadata.contentType),
        publishedAt: textValue(metadata.publishedAt),
        addressBlocks,
        locationEvidence,
      },
    });
  }

  const completedAt = new Date().toISOString();
  const families: Array<[string, readonly unknown[]]> = [
    ['places', contextEvidence?.places || []],
    ['cameras', contextEvidence?.cameras || []],
    ['geotaggedMedia', contextEvidence?.geotaggedMedia || []],
    ['earthObservation', contextEvidence?.earthObservation || []],
    ['weather', contextEvidence?.weather ? [contextEvidence.weather] : []],
  ];
  for (const [family, items] of families) {
    for (const raw of items) {
      const item = objectValue(raw);
      if (!item || !Object.keys(item).length) continue;
      const metadata = objectValue(item.metadata);
      records.push({
        recordType: 'geographic_context',
        provider: textValue(item.provider) || family,
        sourceUrl: textValue(item.sourceUrl) || textValue(item.pageUrl)
          || textValue(item.url) || textValue(metadata?.sourceUrl),
        retrievedAt: dateValue(item.retrievedAt) || dateValue(metadata?.retrievedAt) || completedAt,
        payload: {
          snapshotKind: 'normalized_record',
          classification: 'geographic_context',
          contextFamily: family,
          subjectMatchConfidence: 0,
          currentPositionVerified: false,
          record: item,
        },
      });
    }
  }
  return records;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  const object = objectValue(value);
  if (!object) return value;
  return Object.fromEntries(Object.keys(object).sort().map(key => [key, stableValue(object[key])]));
}

const acquisitionTimestampKeys = new Set([
  'retrievedAt', 'receivedAt', 'acquiredAt', 'firstSeenAt', 'lastSeenAt',
]);

/** Hash the JSON snapshot, never the original response bytes. Source observation
 * timestamps inside the snapshot remain material; only top-level acquisition
 * timestamps are excluded so a later fetch of unchanged content deduplicates. */
export function spectraAcquisitionRecordHash(record: SpectraAcquisitionEvidenceRecord): string {
  const withoutAcquisitionTimes = (value: ObjectValue): ObjectValue => Object.fromEntries(Object.entries(value)
    .filter(([key]) => !acquisitionTimestampKeys.has(key)));
  const payload = withoutAcquisitionTimes(record.payload);
  // A normalized adapter record is wrapped for classification. Its receipt
  // metadata is still acquisition provenance, not source-observed event time.
  // Do not apply this removal recursively to structured source documents.
  if (payload.snapshotKind === 'normalized_record' && objectValue(payload.record)) {
    const normalized = withoutAcquisitionTimes(payload.record as ObjectValue);
    if (objectValue(normalized.metadata)) {
      normalized.metadata = withoutAcquisitionTimes(normalized.metadata as ObjectValue);
    }
    payload.record = normalized;
  }
  return createHash('sha256').update(JSON.stringify(stableValue({
    recordType: record.recordType,
    provider: record.provider,
    sourceUrl: record.sourceUrl || null,
    payload,
  }))).digest('hex');
}

/** Omit whole oversized/invalid records with explicit counts. Never silently
 * cut a payload and later present the fragment as the acquired record. */
export function prepareSpectraAcquisitionEvidenceRecords(
  input: readonly SpectraAcquisitionEvidenceRecord[],
): SpectraPreparedEvidenceRecords {
  const records: PreparedEvidenceRecord[] = [];
  const omissions: SpectraEvidenceRecordOmissions = {
    invalid: 0, recordTooLarge: 0, batchLimit: 0, storageUnavailable: 0, duplicate: 0,
  };
  const seen = new Map<string, PreparedEvidenceRecord>();
  let bytes = 2; // JSON array delimiters
  for (const raw of input) {
    try {
      if (!raw || !['retrieved_document', 'geographic_context'].includes(raw.recordType)
        || !textValue(raw.provider) || raw.provider.length > 200
        || (raw.sourceUrl !== undefined && (typeof raw.sourceUrl !== 'string' || raw.sourceUrl.length > 4_096))
        || !dateValue(raw.retrievedAt) || !objectValue(raw.payload)) {
        omissions.invalid += 1;
        continue;
      }
      // Isolate the persisted snapshot from caller mutation and normalize to
      // the JSON representation PostgreSQL will actually receive.
      const payload = JSON.parse(JSON.stringify(raw.payload));
      if (!objectValue(payload)) {
        omissions.invalid += 1;
        continue;
      }
      const record = { ...raw, retrievedAt: dateValue(raw.retrievedAt)!, payload };
      const contentSha256 = spectraAcquisitionRecordHash(record);
      const prepared = { ...record, contentSha256, firstSeenAt: record.retrievedAt, lastSeenAt: record.retrievedAt };
      const recordBytes = Buffer.byteLength(JSON.stringify(prepared), 'utf8');
      if (recordBytes > SPECTRA_EVIDENCE_RECORD_MAX_BYTES) {
        omissions.recordTooLarge += 1;
        continue;
      }
      const prior = seen.get(contentSha256);
      if (prior) {
        // A duplicate is represented once, retaining both receipt bounds.
        if (prepared.retrievedAt > prior.lastSeenAt) prior.lastSeenAt = prepared.retrievedAt;
        if (prepared.retrievedAt < prior.firstSeenAt) prior.firstSeenAt = prepared.retrievedAt;
        omissions.duplicate += 1;
        continue;
      }
      const addition = recordBytes + (records.length ? 1 : 0);
      if (records.length >= SPECTRA_EVIDENCE_BATCH_MAX_RECORDS || bytes + addition > SPECTRA_EVIDENCE_BATCH_MAX_BYTES) {
        omissions.batchLimit += 1;
        continue;
      }
      records.push(prepared);
      seen.set(contentSha256, prepared);
      bytes += addition;
    } catch {
      omissions.invalid += 1;
    }
  }
  return { records, omissions, omittedCount: omissions.invalid + omissions.recordTooLarge + omissions.batchLimit, bytes };
}

export type SpectraEvidenceQuery = (
  sql: string,
  parameters: unknown[],
) => Promise<{ rows: Array<Record<string, any>>; rowCount?: number | null }>;

/** The caller supplies its open transaction, so records and investigation state
 * commit together. Identical hashes update receipt metadata only; a changed
 * payload appends a distinct row and the old snapshot remains inspectable. */
export async function writeSpectraAcquisitionEvidenceRecords(
  query: SpectraEvidenceQuery,
  owner: { investigationId: string; userId: string; sessionId: string },
  prepared: SpectraPreparedEvidenceRecords,
): Promise<{ count: number; inserted: number }> {
  if (!prepared.records.length) return { count: 0, inserted: 0 };
  const result = await query(
    `INSERT INTO public.spectra_acquisition_evidence_records
       (investigation_id, user_id, session_id, record_type, provider, source_url,
        retrieved_at, content_hash, payload, first_seen_at, last_seen_at)
     SELECT $1::uuid, $2, $3, r."recordType", r.provider, r."sourceUrl",
            r."retrievedAt", r."contentSha256", r.payload, r."firstSeenAt", r."lastSeenAt"
     FROM jsonb_to_recordset($4::jsonb) AS r(
       "recordType" text, provider text, "sourceUrl" text, "retrievedAt" timestamptz,
       "contentSha256" text, payload jsonb, "firstSeenAt" timestamptz, "lastSeenAt" timestamptz)
     ON CONFLICT (investigation_id, record_type, provider, content_hash)
     DO UPDATE SET last_seen_at = GREATEST(
       public.spectra_acquisition_evidence_records.last_seen_at, EXCLUDED.last_seen_at),
       first_seen_at = LEAST(public.spectra_acquisition_evidence_records.first_seen_at, EXCLUDED.first_seen_at)
     WHERE public.spectra_acquisition_evidence_records.user_id = EXCLUDED.user_id
       AND public.spectra_acquisition_evidence_records.session_id = EXCLUDED.session_id
     RETURNING (xmax = 0) AS inserted`,
    [owner.investigationId, owner.userId, owner.sessionId, JSON.stringify(prepared.records)],
  );
  if (result.rows.length !== prepared.records.length) {
    throw new Error('SPECTRA evidence record ownership mismatch');
  }
  return {
    count: result.rows.length,
    inserted: result.rows.filter(row => row.inserted === true).length,
  };
}

export interface SpectraAcquisitionEvidenceRecordList {
  records: SpectraStoredAcquisitionEvidenceRecord[];
  persistenceAvailable: boolean;
  error?: string;
}

/** Query injection keeps tenant-boundary tests independent of application boot. */
export async function readSpectraAcquisitionEvidenceRecords(
  query: SpectraEvidenceQuery,
  userId: string,
  sessionId: string,
  limit = 100,
): Promise<SpectraAcquisitionEvidenceRecordList> {
  const normalizedSessionId = sessionId.trim();
  if (!userId.trim() || !normalizedSessionId || normalizedSessionId.length > 200) {
    return { records: [], persistenceAvailable: false, error: 'Invalid acquisition record request.' };
  }
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 100;
  try {
    const result = await query(
      `SELECT r.id, r.record_type, r.provider, r.source_url, r.retrieved_at,
              r.payload, r.content_hash, r.first_seen_at, r.last_seen_at
       FROM public.spectra_acquisition_evidence_records r
       JOIN public.spectra_investigations i
         ON i.id = r.investigation_id AND i.session_id = r.session_id AND i.user_id = r.user_id
       WHERE r.user_id = $1 AND i.user_id = $1 AND r.session_id = $2 AND i.session_id = $2
       ORDER BY r.last_seen_at DESC, r.id DESC
       LIMIT $3`,
      [userId, normalizedSessionId, boundedLimit],
    );
    return {
      records: result.rows.map(row => ({
        id: String(row.id),
        recordType: row.record_type,
        provider: row.provider,
        sourceUrl: row.source_url || undefined,
        retrievedAt: new Date(row.retrieved_at).toISOString(),
        payload: row.payload,
        contentSha256: row.content_hash,
        firstSeenAt: new Date(row.first_seen_at).toISOString(),
        lastSeenAt: new Date(row.last_seen_at).toISOString(),
      })),
      persistenceAvailable: true,
    };
  } catch (error: any) {
    return {
      records: [],
      persistenceAvailable: false,
      error: error?.code === '42P01'
        ? 'Acquisition record storage is not installed.'
        : 'Acquisition records could not be loaded.',
    };
  }
}
