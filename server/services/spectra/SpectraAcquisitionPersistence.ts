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
    const investigation = await client.query(
      `INSERT INTO public.spectra_investigations
        (user_id, subject_label, session_id, clues, state)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
       ON CONFLICT (session_id)
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         subject_label = COALESCE(EXCLUDED.subject_label, public.spectra_investigations.subject_label),
         clues = public.spectra_investigations.clues || EXCLUDED.clues,
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
            confidence, observation_kind, observed_at, received_at, correlation_group,
            provenance, metadata, evidence_fingerprint
          )
         VALUES (
            $1::uuid, $2, $3, $4,
            $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15,
            $16::jsonb, $17::jsonb, $18
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
