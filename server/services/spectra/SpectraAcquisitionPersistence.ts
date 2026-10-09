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

function isOrderedWholeTokenRefinement(shorter: string, longer: string): boolean {
  // Subject labels can gain middle names or extra identifiers, but a partial
  // word match (Ann vs Anna, Lee vs Leela) never establishes compatibility.
  const required = shorter.split(/\s+/).filter(Boolean);
  const available = longer.split(/\s+/).filter(Boolean);
  if (!required.length || required.length > available.length) return false;

  let matched = 0;
  for (const token of available) {
    if (token === required[matched]) matched += 1;
    if (matched === required.length) return true;
  }
  return false;
}

function subjectsCompatible(existing: string, incoming: string): boolean {
  if (!existing || !incoming || existing === incoming) return true;
  if (GENERIC_SPECTRA_SUBJECT_RE.test(existing) || GENERIC_SPECTRA_SUBJECT_RE.test(incoming)) return true;
  return isOrderedWholeTokenRefinement(existing, incoming)
    || isOrderedWholeTokenRefinement(incoming, existing);
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

export async function loadSpectraSessionObservations(
  userId: string,
  sessionId: string,
  limit = 2_000,
): Promise<GPSPoint[]> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId || normalizedSessionId.length > 200) return [];
  const boundedLimit = Math.max(1, Math.min(2_000, Math.floor(limit)));

  try {
    const result = await pool.query(
      `SELECT
         source_type, provider, latitude, longitude, altitude, accuracy_meters,
         confidence, observation_kind, evidence_class,
         subject_match_confidence, timestamp_confidence, acquisition_method, source_url,
         observed_at, received_at, correlation_group, provenance, metadata
       FROM public.spectra_location_observations
       WHERE session_id = $1 AND user_id = $2
       ORDER BY observed_at ASC
       LIMIT $3`,
      [normalizedSessionId, userId, boundedLimit],
    );

    return result.rows.flatMap((row: any) => {
      const latitude = Number(row.latitude);
      const longitude = Number(row.longitude);
      const observedAt = new Date(row.observed_at);
      if (
        !Number.isFinite(latitude)
        || !Number.isFinite(longitude)
        || !Number.isFinite(observedAt.getTime())
      ) return [];

      const metadata = row.metadata && typeof row.metadata === 'object'
        ? { ...row.metadata }
        : {};
      return [{
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
        },
      } as GPSPoint];
    });
  } catch (error: any) {
    if (error?.code === '42P01') return [];
    throw error;
  }
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
        || (
          isOrderedWholeTokenRefinement(existingSubject, incomingSubject)
          && incomingSubject.split(/\s+/).length > existingSubject.split(/\s+/).length
        )
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
