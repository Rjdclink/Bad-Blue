import { createHash, randomUUID } from 'node:crypto';
import { pool } from '../../db';
import type { GPSPoint } from '../geoconsole/types';

export interface SpectraAcquisitionPersistenceResult {
  available: boolean;
  sessionId: string;
  investigationId?: string;
}

function normalizeClue(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function observationFingerprint(point: GPSPoint): string {
  return createHash('sha256')
    .update([
      Number(point.latitude).toFixed(7),
      Number(point.longitude).toFixed(7),
      point.timestamp.toISOString(),
      point.source,
      point.correlationGroup || '',
      point.provenance?.provider || '',
      point.provenance?.recordId || '',
    ].join('|'))
    .digest('hex');
}

function evidenceClassForPoint(point: GPSPoint): string {
  if (point.observationKind === 'predicted' || point.source === 'predicted') return 'PREDICTED';
  if (point.observationKind === 'interpolated' || point.source === 'interpolated') return 'INTERPOLATED';
  if (
    point.observationKind === 'historical'
    || point.source === 'historical_location'
    || point.source === 'public_record'
  ) return 'HISTORICAL';
  if (point.observationKind === 'inferred') return 'INFERRED';

  const ageMs = Math.max(0, Date.now() - point.timestamp.getTime());
  if (ageMs <= 5 * 60_000) return 'CURRENT';
  if (ageMs <= 24 * 60 * 60_000) return 'RECENT';
  return 'HISTORICAL';
}

function optionalConfidence(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function metadataString(point: GPSPoint, ...keys: string[]): string | null {
  const metadata = point.metadata || {};
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 2_000);
  }
  return null;
}

const GENERIC_SPECTRA_SUBJECT_RE = /^(?:person|individual|target|device|vehicle|car|truck|business|company|organization|object|place|address|thing|property|phone|phone number)$/i;

function subjectsCompatible(existing: string, incoming: string): boolean {
  if (!existing || !incoming || existing === incoming) return true;
  if (GENERIC_SPECTRA_SUBJECT_RE.test(existing) || GENERIC_SPECTRA_SUBJECT_RE.test(incoming)) return true;
  return existing.includes(incoming) || incoming.includes(existing);
}

function clueType(value: string): string {
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)) return 'email';
  if (/(?:\+\d{1,3}[\s().-]*)?(?:\d[\s().-]*){7,15}/.test(value)) return 'phone';
  if (/\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|highway|hwy)\b/i.test(value)) return 'address';
  if (/\b(?:instagram|facebook|linkedin|tiktok|twitter|x\.com|username|handle|profile)\b/i.test(value)) return 'social';
  if (/\b(?:employer|works?|job|occupation|company)\b/i.test(value)) return 'employment';
  if (/\b(?:vehicle|car|truck|vin|plate)\b/i.test(value)) return 'vehicle';
  if (/\b(?:photo|image|video|exif|xmp|iptc|metadata)\b/i.test(value)) return 'media';
  if (/\b(?:city|state|county|located|location|near|around|from|address)\b/i.test(value)) return 'location';
  return 'freeform';
}

export interface SpectraIdentityBindingEvidence {
  provider?: string;
  observedAt: Date;
  values: Record<string, number>;
  metadata: Record<string, unknown>;
}

export async function loadSpectraSessionIdentityBindings(
  userId: string,
  sessionId: string,
  limit = 200,
): Promise<SpectraIdentityBindingEvidence[]> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId || normalizedSessionId.length > 200) return [];
  const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));

  try {
    const result = await pool.query(
      `SELECT provider, observed_at, received_at, payload
       FROM public.spectra_telemetry_events
       WHERE session_id = $1 AND user_id = $2
       ORDER BY COALESCE(observed_at, received_at) DESC
       LIMIT $3`,
      [normalizedSessionId, userId, boundedLimit],
    );

    return result.rows.flatMap((row: any) => {
      const payload = row.payload && typeof row.payload === 'object'
        ? row.payload
        : {};
      const measurements = Array.isArray(payload.measurements)
        ? payload.measurements
        : [];

      return measurements.flatMap((measurement: any) => {
        if (
          !measurement
          || measurement.kind !== 'sensor'
          || measurement.source !== 'identity_binding'
        ) return [];

        const observedAt = new Date(
          measurement.timestamp
          || row.observed_at
          || row.received_at,
        );
        if (!Number.isFinite(observedAt.getTime())) return [];

        const values = measurement.values && typeof measurement.values === 'object'
          ? Object.fromEntries(
              Object.entries(measurement.values)
                .map(([key, value]) => [key, Number(value)] as const)
                .filter(([, value]) => Number.isFinite(value)),
            )
          : {};
        const metadata = measurement.metadata && typeof measurement.metadata === 'object'
          ? { ...measurement.metadata }
          : {};

        return [{
          provider: measurement.provider || row.provider || undefined,
          observedAt,
          values,
          metadata,
        } satisfies SpectraIdentityBindingEvidence];
      });
    });
  } catch (error: any) {
    if (error?.code === '42P01') return [];
    throw error;
  }
}

function persistedObservationRowToPoint(row: any): GPSPoint | null {
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  const observedAt = new Date(row.observed_at);
  if (
    !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || !Number.isFinite(observedAt.getTime())
  ) return null;

  const metadata = row.metadata && typeof row.metadata === 'object'
    ? { ...row.metadata }
    : {};

  return {
    latitude,
    longitude,
    altitude: row.altitude == null ? undefined : Number(row.altitude),
    accuracy: row.accuracy_meters == null ? undefined : Number(row.accuracy_meters),
    timestamp: observedAt,
    receivedAt: row.received_at ? new Date(row.received_at) : undefined,
    source: row.source_type,
    confidence: Number(row.confidence),
    observationKind: row.observation_kind,
    correlationGroup: row.correlation_group || undefined,
    provenance: row.provenance || {
      provider: row.provider || undefined,
      capturedAt: observedAt,
    },
    metadata: {
      ...metadata,
      evidenceClass: row.evidence_class || metadata.evidenceClass,
      subjectMatchConfidence: row.subject_match_confidence == null
        ? metadata.subjectMatchConfidence
        : Number(row.subject_match_confidence),
      timestampConfidence: row.timestamp_confidence == null
        ? metadata.timestampConfidence
        : Number(row.timestamp_confidence),
      acquisitionMethod: row.acquisition_method || metadata.acquisitionMethod,
      sourceUrl: row.source_url || metadata.sourceUrl,
      restoredFromPersistence: true,
      databaseObservationId: row.id ? String(row.id) : metadata.databaseObservationId,
    },
  } as GPSPoint;
}

interface SpectraObservationCursor {
  observedAt: string;
  id: string;
}

function encodeObservationCursor(row: any): string | undefined {
  const observedAt = new Date(row?.observed_at);
  const id = String(row?.id || '').trim();
  if (!id || !Number.isFinite(observedAt.getTime())) return undefined;
  return Buffer.from(JSON.stringify({
    observedAt: observedAt.toISOString(),
    id,
  } satisfies SpectraObservationCursor), 'utf8').toString('base64url');
}

function decodeObservationCursor(value?: string): SpectraObservationCursor | null {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 1_000) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    const observedAt = new Date(parsed?.observedAt);
    const id = String(parsed?.id || '').trim();
    if (!id || !Number.isFinite(observedAt.getTime())) return null;
    return { observedAt: observedAt.toISOString(), id };
  } catch {
    return null;
  }
}

export interface SpectraObservationPage {
  points: GPSPoint[];
  nextCursor?: string;
  hasMore: boolean;
}

export async function loadSpectraSessionObservationPage(
  userId: string,
  sessionId: string,
  options: {
    limit?: number;
    after?: Date;
    before?: Date;
    cursor?: string;
  } = {},
): Promise<SpectraObservationPage> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId || normalizedSessionId.length > 200) {
    return { points: [], hasMore: false };
  }

  const boundedLimit = Math.max(1, Math.min(2_000, Math.floor(options.limit ?? 500)));
  const cursor = decodeObservationCursor(options.cursor);
  if (options.cursor && !cursor) {
    throw new Error('Invalid SPECTRA observation cursor.');
  }

  const after = options.after instanceof Date && Number.isFinite(options.after.getTime())
    ? options.after
    : null;
  const before = options.before instanceof Date && Number.isFinite(options.before.getTime())
    ? options.before
    : null;
  if (after && before && after.getTime() > before.getTime()) {
    throw new Error('SPECTRA observation range start must not exceed range end.');
  }

  try {
    const result = await pool.query(
      `SELECT
         id, source_type, provider, latitude, longitude, altitude, accuracy_meters,
         confidence, observation_kind, evidence_class,
         subject_match_confidence, timestamp_confidence, acquisition_method, source_url,
         observed_at, received_at, correlation_group, provenance, metadata
       FROM public.spectra_location_observations
       WHERE session_id = $1
         AND user_id = $2
         AND ($3::timestamptz IS NULL OR observed_at >= $3)
         AND ($4::timestamptz IS NULL OR observed_at <= $4)
         AND (
           $5::timestamptz IS NULL
           OR observed_at < $5
           OR (observed_at = $5 AND id < $6::uuid)
         )
       ORDER BY observed_at DESC, id DESC
       LIMIT $7`,
      [
        normalizedSessionId,
        userId,
        after,
        before,
        cursor?.observedAt || null,
        cursor?.id || null,
        boundedLimit + 1,
      ],
    );

    const hasMore = result.rows.length > boundedLimit;
    const pageRows = result.rows.slice(0, boundedLimit);
    const points = pageRows.flatMap((row: any) => {
      const point = persistedObservationRowToPoint(row);
      return point ? [point] : [];
    });

    return {
      points,
      hasMore,
      nextCursor: hasMore && pageRows.length
        ? encodeObservationCursor(pageRows[pageRows.length - 1])
        : undefined,
    };
  } catch (error: any) {
    if (error?.code === '42P01') return { points: [], hasMore: false };
    throw error;
  }
}

export async function loadSpectraSessionObservations(
  userId: string,
  sessionId: string,
  limit = 2_000,
): Promise<GPSPoint[]> {
  const page = await loadSpectraSessionObservationPage(userId, sessionId, {
    limit: Math.max(1, Math.min(2_000, Math.floor(limit))),
  });
  // The database page is newest-first so that a bounded read always contains
  // the freshest evidence. Internal fusion expects chronological order.
  return [...page.points].reverse();
}

export async function loadSpectraSessionObservationRange(
  userId: string,
  sessionId: string,
  input: {
    start?: Date;
    end?: Date;
    maxPoints?: number;
  } = {},
): Promise<{ points: GPSPoint[]; truncated: boolean }> {
  const maxPoints = Math.max(1, Math.min(50_000, Math.floor(input.maxPoints ?? 20_000)));
  const points: GPSPoint[] = [];
  let cursor: string | undefined;
  let truncated = false;

  while (points.length < maxPoints) {
    const page = await loadSpectraSessionObservationPage(userId, sessionId, {
      limit: Math.min(2_000, maxPoints - points.length),
      after: input.start,
      before: input.end,
      cursor,
    });
    points.push(...page.points);

    if (!page.hasMore || !page.nextCursor) {
      truncated = false;
      break;
    }

    cursor = page.nextCursor;
    if (points.length >= maxPoints) {
      truncated = true;
      break;
    }
  }

  return {
    points: points.sort((left, right) =>
      left.timestamp.getTime() - right.timestamp.getTime()
    ),
    truncated,
  };
}

export async function persistSpectraAcquisition(input: {
  userId: string;
  sessionId?: string;
  subjectLabel: string;
  clues: string[];
  observations: GPSPoint[];
  state?: Record<string, unknown>;
}): Promise<SpectraAcquisitionPersistenceResult> {
  const sessionId = input.sessionId?.trim() || `spectra-${randomUUID()}`;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT user_id, subject_label
       FROM public.spectra_investigations
       WHERE session_id = $1
       FOR UPDATE`,
      [sessionId],
    );
    let claimingPreviouslyUnownedSession = false;
    if (existing.rows.length) {
      const existingUserId = String(existing.rows[0]?.user_id || '');
      const existingSubject = normalizeClue(String(existing.rows[0]?.subject_label || ''));
      const incomingSubject = normalizeClue(input.subjectLabel);
      if (existingUserId && existingUserId !== input.userId) {
        throw new Error('SPECTRA session ownership mismatch');
      }
      if (!subjectsCompatible(existingSubject, incomingSubject)) {
        throw new Error('SPECTRA session subject mismatch');
      }
      claimingPreviouslyUnownedSession = !existingUserId;
    }

    const investigation = await client.query(
      `INSERT INTO public.spectra_investigations
        (user_id, subject_label, session_id, clues, state)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
       ON CONFLICT (session_id)
       DO UPDATE SET
         user_id = COALESCE(public.spectra_investigations.user_id, EXCLUDED.user_id),
         subject_label = COALESCE(public.spectra_investigations.subject_label, EXCLUDED.subject_label),
         clues = EXCLUDED.clues,
         state = public.spectra_investigations.state || EXCLUDED.state,
         updated_at = now()
       RETURNING id`,
      [
        input.userId,
        input.subjectLabel,
        sessionId,
        JSON.stringify(input.clues.slice(-40)),
        JSON.stringify(input.state || {}),
      ],
    );
    const investigationId = String(investigation.rows[0]?.id || '');

    const existingSubject = existing.rows.length
      ? normalizeClue(String(existing.rows[0]?.subject_label || ''))
      : '';
    const incomingSubject = normalizeClue(input.subjectLabel);
    if (
      investigationId
      && incomingSubject
      && (
        !existingSubject
        || GENERIC_SPECTRA_SUBJECT_RE.test(existingSubject)
        || (incomingSubject.includes(existingSubject) && incomingSubject.length > existingSubject.length)
      )
    ) {
      await client.query(
        `UPDATE public.spectra_investigations
         SET subject_label = $2, updated_at = now()
         WHERE id = $1::uuid`,
        [investigationId, input.subjectLabel],
      );
    }

    if (claimingPreviouslyUnownedSession) {
      await client.query(
        `UPDATE public.spectra_telemetry_events
         SET user_id = $2
         WHERE session_id = $1 AND user_id IS NULL`,
        [sessionId, input.userId],
      );
      await client.query(
        `UPDATE public.spectra_location_observations
         SET user_id = $2
         WHERE session_id = $1 AND user_id IS NULL`,
        [sessionId, input.userId],
      );
    }

    for (const rawValue of input.clues) {
      const raw = rawValue.replace(/\s+/g, ' ').trim();
      const normalized = normalizeClue(raw);
      if (!raw || !normalized) continue;
      await client.query(
        `INSERT INTO public.spectra_clues
          (investigation_id, clue_type, raw_value, normalized_value, confidence, metadata)
         VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (investigation_id, clue_type, normalized_value)
         DO UPDATE SET
           raw_value = EXCLUDED.raw_value,
           confidence = GREATEST(public.spectra_clues.confidence, EXCLUDED.confidence),
           evidence_count = public.spectra_clues.evidence_count + 1,
           last_seen_at = now()`,
        [investigationId, clueType(raw), raw, normalized, 0.35, JSON.stringify({ source: 'spectra_acquire' })],
      );
    }

    for (const point of input.observations) {
      await client.query(
        `INSERT INTO public.spectra_location_observations
          (
            investigation_id, user_id, session_id, subject_label,
            source_type, provider, latitude, longitude, altitude, accuracy_meters,
            confidence, observation_kind, evidence_class, subject_match_confidence,
            timestamp_confidence, acquisition_method, source_url,
            observed_at, received_at, correlation_group,
            provenance, metadata, evidence_fingerprint
          )
         VALUES (
            $1::uuid, $2, $3, $4,
            $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14,
            $15, $16, $17,
            $18, $19, $20,
            $21::jsonb, $22::jsonb, $23
         )
         ON CONFLICT (session_id, evidence_fingerprint) DO NOTHING`,
        [
          investigationId,
          input.userId,
          sessionId,
          input.subjectLabel,
          point.source,
          point.provenance?.provider || null,
          point.latitude,
          point.longitude,
          point.altitude ?? null,
          point.accuracy ?? null,
          point.confidence,
          point.observationKind || 'observed',
          evidenceClassForPoint(point),
          optionalConfidence(point.metadata?.subjectMatchConfidence),
          optionalConfidence(point.metadata?.timestampConfidence),
          metadataString(point, 'acquisitionMethod')
            || point.provenance?.transformedBy?.[0]
            || null,
          metadataString(point, 'sourceUrl', 'url'),
          point.timestamp,
          point.receivedAt || new Date(),
          point.correlationGroup || null,
          JSON.stringify(point.provenance || {}),
          JSON.stringify(point.metadata || {}),
          observationFingerprint(point),
        ],
      );
    }

    await client.query('COMMIT');
    return { available: true, sessionId, investigationId };
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error?.code === '42P01') {
      return { available: false, sessionId };
    }
    throw error;
  } finally {
    client.release();
  }
}
