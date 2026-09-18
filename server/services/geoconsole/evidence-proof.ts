import { createHmac, timingSafeEqual } from 'crypto';
import type { GPSPoint } from './types';

const PROOF_VERSION = 'spectra-evidence-v1';
const PROOF_FIELD = 'serverEvidenceProof';
const PROOF_VERSION_FIELD = 'serverEvidenceProofVersion';

function signingKey(): string {
  const key =
    process.env.SPECTRA_EVIDENCE_SIGNING_KEY ||
    process.env.SESSION_SECRET ||
    '';
  if (!key.trim()) {
    throw new Error('SPECTRA evidence signing key is not configured');
  }
  return key;
}

function canonicalObservation(point: GPSPoint): string {
  const timestamp =
    point.timestamp instanceof Date
      ? point.timestamp.toISOString()
      : new Date(point.timestamp as any).toISOString();
  const capturedAt = point.provenance?.capturedAt
    ? point.provenance.capturedAt instanceof Date
      ? point.provenance.capturedAt.toISOString()
      : new Date(point.provenance.capturedAt as any).toISOString()
    : '';

  return [
    PROOF_VERSION,
    Number(point.latitude).toFixed(7),
    Number(point.longitude).toFixed(7),
    point.altitude == null ? '' : Number(point.altitude).toFixed(3),
    point.accuracy == null ? '' : Number(point.accuracy).toFixed(3),
    point.verticalAccuracy == null ? '' : Number(point.verticalAccuracy).toFixed(3),
    timestamp,
    point.source,
    Number(point.confidence).toFixed(6),
    point.observationKind || '',
    point.correlationGroup || '',
    point.provenance?.provider || '',
    point.provenance?.recordId || '',
    capturedAt,
    (point.provenance?.transformedBy || []).join(','),
  ].join('|');
}

function signatureFor(point: GPSPoint): string {
  return createHmac('sha256', signingKey())
    .update(canonicalObservation(point))
    .digest('hex');
}

export function signServerEvidence<T extends GPSPoint>(point: T): T {
  const proof = signatureFor(point);
  return {
    ...point,
    metadata: {
      ...(point.metadata || {}),
      [PROOF_FIELD]: proof,
      [PROOF_VERSION_FIELD]: PROOF_VERSION,
    },
  };
}

export function verifyServerEvidence(point: GPSPoint): boolean {
  const metadata = point.metadata || {};
  const proof = metadata[PROOF_FIELD];
  const version = metadata[PROOF_VERSION_FIELD];
  if (typeof proof !== 'string' || version !== PROOF_VERSION) return false;

  let expected: string;
  try {
    expected = signatureFor(point);
  } catch {
    return false;
  }

  const actualBuffer = Buffer.from(proof, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (
    actualBuffer.length === 0 ||
    actualBuffer.length !== expectedBuffer.length
  ) {
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function normalizeClientEvidence(point: GPSPoint): GPSPoint {
  if (verifyServerEvidence(point)) return point;

  const browserReported =
    point.source === 'browser_geolocation' ||
    point.source === 'device_gps';

  if (browserReported) {
    return {
      ...point,
      source: 'browser_geolocation',
      confidence: Math.min(0.75, Math.max(0.1, point.confidence)),
      observationKind: 'observed',
      correlationGroup: 'client:navigator_geolocation',
      provenance: {
        provider: 'authenticated_client_browser',
        capturedAt: point.timestamp,
        transformedBy: ['server_client_evidence_normalization'],
      },
      metadata: {
        ...(point.metadata || {}),
        clientEvidenceNormalized: true,
        claimedSource: point.source,
      },
    };
  }

  return {
    ...point,
    source: 'manual_input',
    confidence: Math.min(0.35, Math.max(0.05, point.confidence)),
    observationKind: 'inferred',
    correlationGroup: 'client:unverified_location_claim',
    provenance: {
      provider: 'authenticated_client_unverified',
      capturedAt: point.timestamp,
      transformedBy: ['server_client_evidence_normalization'],
    },
    metadata: {
      ...(point.metadata || {}),
      clientEvidenceNormalized: true,
      claimedSource: point.source,
    },
  };
}
