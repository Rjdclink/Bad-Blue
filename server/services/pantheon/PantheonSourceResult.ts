import { createHash } from 'node:crypto';
import type { PantheonTransport } from './PantheonCrawlerCapabilityMatrix';

export const PANTHEON_SOURCE_RESULT_SCHEMA = 'pantheon-source-result-v1' as const;

export interface PantheonStructuredSourceResult {
  schemaVersion: typeof PANTHEON_SOURCE_RESULT_SCHEMA;
  evidenceId: string;
  crawler: string;
  capabilityId: string;
  categoryLabel: string;
  target: string;
  sourceUrl: string;
  content: string;
  contentHash: string;
  confidence: number;
  retrievedAt: string;
  status: 'completed_with_content' | 'completed_with_evidence';
  provenance: {
    sourceUrl: string;
    transport: PantheonTransport;
    retrievedAt: string;
    durationMs: number;
    httpStatus?: number;
    contentType?: string;
    requestedUrl?: string;
    finalUrl?: string;
    redirectChain?: string[];
    parser?: string;
    ocrApplied?: boolean;
    rawSnapshot?: {
      rawSha256: string;
      rawBytes: number;
      compressedBytes: number;
      storageKey: string;
      immutable: true;
      durable: boolean;
      capturedAt: string;
    };
    lastModified?: string;
  };
  metadata: Record<string, unknown>;
}

export function createPantheonSourceResult(input: {
  crawler: string;
  capabilityId?: string;
  categoryLabel?: string;
  sourceUrl: string;
  content: string;
  confidence: number;
  retrievedAt: string;
  durationMs?: number;
  transport?: PantheonTransport;
  httpStatus?: number;
  contentType?: string;
  requestedUrl?: string;
  finalUrl?: string;
  redirectChain?: string[];
  parser?: string;
  ocrApplied?: boolean;
  rawSnapshot?: PantheonStructuredSourceResult['provenance']['rawSnapshot'];
  lastModified?: string;
  metadata?: Record<string, unknown>;
}): PantheonStructuredSourceResult {
  const content = String(input.content || '').trim();
  if (!content) throw new Error('Pantheon source result requires real retrieved content');
  const parsedSourceUrl = new URL(input.sourceUrl);
  if (!['http:', 'https:'].includes(parsedSourceUrl.protocol)) {
    throw new Error('Pantheon source result requires an attributable HTTP(S) source URL');
  }
  const sourceUrl = parsedSourceUrl.toString();
  const contentHash = createHash('sha256').update(content).digest('hex');
  const evidenceId = createHash('sha256')
    .update([input.crawler, sourceUrl, contentHash, input.retrievedAt].join('\u0000'))
    .digest('hex');
  const result: PantheonStructuredSourceResult = {
    schemaVersion: PANTHEON_SOURCE_RESULT_SCHEMA,
    evidenceId,
    crawler: input.crawler,
    capabilityId: input.capabilityId || input.crawler,
    categoryLabel: input.categoryLabel || 'Unassigned',
    target: sourceUrl,
    sourceUrl,
    content,
    contentHash,
    confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0)),
    retrievedAt: input.retrievedAt,
    status: 'completed_with_content',
    provenance: {
      sourceUrl,
      transport: input.transport || 'direct-http',
      retrievedAt: input.retrievedAt,
      durationMs: Math.max(0, Number(input.durationMs) || 0),
      ...(input.httpStatus == null ? {} : { httpStatus: input.httpStatus }),
      ...(input.contentType ? { contentType: input.contentType } : {}),
      ...(input.requestedUrl ? { requestedUrl: input.requestedUrl } : {}),
      ...(input.finalUrl ? { finalUrl: input.finalUrl } : {}),
      ...(input.redirectChain?.length ? { redirectChain: [...input.redirectChain] } : {}),
      ...(input.parser ? { parser: input.parser } : {}),
      ...(input.ocrApplied == null ? {} : { ocrApplied: input.ocrApplied }),
      ...(input.rawSnapshot ? { rawSnapshot: { ...input.rawSnapshot } } : {}),
      ...(input.lastModified ? { lastModified: input.lastModified } : {}),
    },
    metadata: { ...(input.metadata || {}) },
  };
  if (/(?:simulat(?:e|ed|ion)|mirrored|synthetic|test[ _-]?mode)/i.test(JSON.stringify(result.metadata || {}))) {
    throw new Error('Pantheon production source result rejected simulated or test metadata');
  }
  validatePantheonSourceResult(result);
  return result;
}

export function validatePantheonSourceResult(value: PantheonStructuredSourceResult): void {
  if (value.schemaVersion !== PANTHEON_SOURCE_RESULT_SCHEMA) throw new Error('Invalid Pantheon source-result schema');
  if (!/^[a-f0-9]{64}$/.test(value.evidenceId) || !/^[a-f0-9]{64}$/.test(value.contentHash) || !value.content.trim()) {
    throw new Error('Incomplete Pantheon source result');
  }
  if (!value.provenance?.sourceUrl || !value.provenance.retrievedAt || !value.crawler || !value.capabilityId ||
      !Number.isFinite(Date.parse(value.retrievedAt)) || value.provenance.sourceUrl !== value.sourceUrl) {
    throw new Error('Pantheon source result is missing provenance or capability attribution');
  }
  const parsedSourceUrl = new URL(value.sourceUrl);
  if (!['http:', 'https:'].includes(parsedSourceUrl.protocol)
      || !['completed_with_content', 'completed_with_evidence'].includes(value.status)) {
    throw new Error('Pantheon source result has an invalid source or status');
  }
  if (value.status === 'completed_with_evidence' && value.metadata?.evidenceState !== 'verified_live_source') {
    throw new Error('Pantheon source result cannot claim evidence before validation');
  }
  const expectedContentHash = createHash('sha256').update(value.content).digest('hex');
  if (value.contentHash !== expectedContentHash) throw new Error('Pantheon source result content hash mismatch');
}
