import { createHash } from 'node:crypto';
import { pool } from '../../db';
import type { GPSPoint } from '../geoconsole/types';
import { publishLocalSpectraObservation } from './SpectraRealtimeHub';

export interface SpectraInvestigationRecord {
  id: string;
  userId: string;
  subjectLabel: string;
  subjectKey: string;
  status: 'active' | 'complete' | 'paused' | 'failed';
  clues: unknown[];
  state: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpectraPersistedObservation {
  id: string;
  investigationId: string;
  point: GPSPoint;
  evidenceClass: string;
  evidenceFingerprint: string;
}

function normalizeSubjectKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function json(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function evidenceClass(point: GPSPoint): string {
  const kind = point.observationKind || (
    point.source === 'predicted'
      ? 'predicted'
      : point.source === 'interpolated'
        ? 'interpolated'
        : point.source === 'historical_location' || point.source === 'public_record'
          ? 'historical'
          : 'observed'
  );

  if (kind === 'predicted') return 'PREDICTED_LOCATION';
  if (kind === 'interpolated') return 'INTERPOLATED_LOCATION';
  if (kind === 'inferred') return 'INFERRED_LOCATION';
  if (kind === 'historical') return 'HISTORICAL_LOCATION';

  const ageMs = Math.max(0, Date.now() - point.timestamp.getTime());
  if (ageMs <= 5 * 60_000) return 'CURRENT_OBSERVATION';
  if (ageMs <= 60 * 60_000) return 'RECENT_OBSERVATION';
  return 'HISTORICAL_LOCATION';
}

function observationFingerprint(point: GPSPoint): string {
  return createHash('sha256')
    .update([
      point.latitude.toFixed(7),
      point.longitude.toFixed(7),
      point.timestamp.toISOString(),
      point.source,
      point.correlationGroup || '',
      point.provenance?.provider || '',
      point.provenance?.recordId || '',
    ].join('|'))
    .digest('hex');
}

function rowToInvestigation(row: any): SpectraInvestigationRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    subjectLabel: String(row.subject_label),
    subjectKey: String(row.subject_key),
    status: row.status,
    clues: Array.isArray(row.clues) ? row.clues : [],
    state: row.state && typeof row.state === 'object' ? row.state : {},
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export async function createSpectraInvestigation(input: {
  userId: string;
  subjectLabel: string;
  clues?: unknown[];
  state?: Record<string, unknown>;
}): Promise<SpectraInvestigationRecord> {
  const subjectLabel = input.subjectLabel.replace(/\s+/g, ' ').trim();
  const subjectKey = normalizeSubjectKey(subjectLabel);
  if (!input.userId.trim() || !subjectLabel || !subjectKey) {
    throw new Error('SPECTRA investigation requires user and subject identity');
  }

  const result = await pool.query(
    `INSERT INTO public.spectra_investigations
      (user_id, subject_label, subject_key, clues, state)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
     RETURNING *`,
    [
      input.userId,
      subjectLabel,
      subjectKey,
      json(input.clues || []),
      json(input.state || {}),
    ],
  );
  return rowToInvestigation(result.rows[0]);
}

export async function getSpectraInvestigation(
  investigationId: string,
  userId: string,
): Promise<SpectraInvestigationRecord | null> {
  const result = await pool.query(
    `SELECT *
       FROM public.spectra_investigations
       WHERE id = $1::uuid AND user_id = $2
       LIMIT 1`,
    [investigationId, userId],
  );
  return result.rows[0] ? rowToInvestigation(result.rows[0]) : null;
}

export async function updateSpectraInvestigationState(input: {
  investigationId: string;
  userId: string;
  clues?: unknown[];
  state?: Record<string, unknown>;
  status?: SpectraInvestigationRecord['status'];
}): Promise<void> {
  await pool.query(
    `UPDATE public.spectra_investigations
     SET clues = COALESCE($3::jsonb, clues),
         state = COALESCE($4::jsonb, state),
         status = COALESCE($5, status),
         updated_at = now()
     WHERE id = $1::uuid AND user_id = $2`,
    [
      input.investigationId,
      input.userId,
      input.clues === undefined ? null : json(input.clues),
      input.state === undefined ? null : json(input.state),
      input.status || null,
    ],
  );
}

export async function persistSpectraClue(input: {
  investigationId: string;
  clueType: string;
  rawValue: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const normalizedValue = input.rawValue
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedValue) return;

  const confidence = Math.max(0, Math.min(1, Number(input.confidence) || 0));
  await pool.query(
    `INSERT INTO public.spectra_clues
       (investigation_id, clue_type, raw_value, normalized_value, confidence, metadata)
     VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (investigation_id, clue_type, normalized_value)
     DO UPDATE SET
       raw_value = EXCLUDED.raw_value,
       confidence = GREATEST(public.spectra_clues.confidence, EXCLUDED.confidence),
       evidence_count = public.spectra_clues.evidence_count + 1,
       last_seen_at = now(),
       metadata = public.spectra_clues.metadata || EXCLUDED.metadata`,
    [
      input.investigationId,
      input.clueType,
      input.rawValue,
      normalizedValue,
      confidence,
      json(input.metadata || {}),
    ],
  );
}

export async function persistSpectraObservation(input: {
  investigationId: string;
  userId: string;
  point: GPSPoint;
}): Promise<SpectraPersistedObservation | null> {
  const point = input.point;
  const fingerprint = observationFingerprint(point);
  const klass = evidenceClass(point);

  const result = await pool.query(
    `INSERT INTO public.spectra_location_observations
       (
         investigation_id, user_id, source_type, provider, evidence_class,
         latitude, longitude, altitude, accuracy_meters, confidence,
         observed_at, received_at, correlation_group, provenance,
         raw_observation, evidence_fingerprint
       )
     VALUES (
       $1::uuid, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       $11, $12, $13, $14::jsonb,
       $15::jsonb, $16
     )
     ON CONFLICT (investigation_id, evidence_fingerprint) DO NOTHING
     RETURNING id`,
    [
      input.investigationId,
      input.userId,
      point.source,
      point.provenance?.provider || null,
      klass,
      point.latitude,
      point.longitude,
      point.altitude ?? null,
      point.accuracy ?? null,
      point.confidence,
      point.timestamp,
      point.receivedAt || new Date(),
      point.correlationGroup || null,
      json(point.provenance || {}),
      json({
        verticalAccuracy: point.verticalAccuracy,
        observationKind: point.observationKind,
        metadata: point.metadata || {},
      }),
      fingerprint,
    ],
  );

  if (!result.rows[0]?.id) return null;
  const persisted = {
    id: String(result.rows[0].id),
    investigationId: input.investigationId,
    point,
    evidenceClass: klass,
    evidenceFingerprint: fingerprint,
  };

  publishLocalSpectraObservation({
    type: 'observation',
    investigationId: input.investigationId,
    userId: input.userId,
    observationId: persisted.id,
    payload: {
      id: persisted.id,
      investigation_id: input.investigationId,
      user_id: input.userId,
      source_type: point.source,
      provider: point.provenance?.provider || null,
      evidence_class: klass,
      latitude: point.latitude,
      longitude: point.longitude,
      altitude: point.altitude ?? null,
      accuracy_meters: point.accuracy ?? null,
      confidence: point.confidence,
      observed_at: point.timestamp.toISOString(),
      received_at: (point.receivedAt || new Date()).toISOString(),
      correlation_group: point.correlationGroup || null,
      provenance: point.provenance || {},
      raw_observation: {
        verticalAccuracy: point.verticalAccuracy,
        observationKind: point.observationKind,
        metadata: point.metadata || {},
      },
      evidence_fingerprint: fingerprint,
    },
  });

  return persisted;
}

export async function loadSpectraObservations(input: {
  investigationId: string;
  userId: string;
  since?: Date;
  limit?: number;
}): Promise<GPSPoint[]> {
  const limit = Math.max(1, Math.min(2_000, Math.trunc(input.limit || 1_000)));
  const result = await pool.query(
    `SELECT source_type, provider, latitude, longitude, altitude,
            accuracy_meters, confidence, observed_at, received_at,
            correlation_group, provenance, raw_observation, evidence_class
     FROM public.spectra_location_observations
     WHERE investigation_id = $1::uuid
       AND user_id = $2
       AND ($3::timestamptz IS NULL OR observed_at >= $3::timestamptz)
     ORDER BY observed_at ASC
     LIMIT $4`,
    [
      input.investigationId,
      input.userId,
      input.since || null,
      limit,
    ],
  );

  return result.rows.map((row: any) => ({
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    altitude: row.altitude == null ? undefined : Number(row.altitude),
    accuracy: row.accuracy_meters == null ? undefined : Number(row.accuracy_meters),
    timestamp: new Date(row.observed_at),
    receivedAt: new Date(row.received_at),
    source: row.source_type,
    confidence: Number(row.confidence),
    observationKind:
      row.evidence_class === 'PREDICTED_LOCATION' ? 'predicted'
      : row.evidence_class === 'INTERPOLATED_LOCATION' ? 'interpolated'
      : row.evidence_class === 'INFERRED_LOCATION' ? 'inferred'
      : row.evidence_class === 'HISTORICAL_LOCATION' ? 'historical'
      : 'observed',
    correlationGroup: row.correlation_group || undefined,
    provenance: row.provenance && typeof row.provenance === 'object'
      ? {
          ...row.provenance,
          capturedAt: row.provenance.capturedAt
            ? new Date(row.provenance.capturedAt)
            : undefined,
        }
      : undefined,
    metadata: row.raw_observation && typeof row.raw_observation === 'object'
      ? row.raw_observation.metadata || {}
      : {},
  } as GPSPoint));
}
