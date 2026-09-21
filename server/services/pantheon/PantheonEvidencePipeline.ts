import type { RetrievalEvidence } from '../crawlers/PantheonRetrievalAdapter';
import { matchPantheonSubject } from './PantheonEntityResolution';
import {
  createPantheonSourceResult,
  validatePantheonSourceResult,
} from './PantheonSourceResult';

export type PantheonEvidenceRejectionReason =
  | 'simulation_or_test_output'
  | 'empty_or_low_confidence'
  | 'diagnostic_or_block_page'
  | 'unparseable_content'
  | 'subject_mismatch'
  | 'duplicate_evidence'
  | 'conflicting_evidence'
  | 'weak_evidence';

export interface PantheonRejectedEvidence {
  evidence: RetrievalEvidence;
  reason: PantheonEvidenceRejectionReason;
}

export function canonicalPantheonEvidenceUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value.trim();
  }
}

export function cleanPantheonEvidenceContent(value: string): string {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function blockedOrDiagnostic(value: string): boolean {
  const lowered = value.toLowerCase();
  return [
    'our systems have detected unusual traffic',
    'enable javascript on your web browser',
    'captcha',
    'access denied',
    'forbidden',
    'too many requests',
    'rate limit',
    'robot check',
    'verify you are human',
    'press / to jump to the search box',
    'accessibility help',
    'quick settings',
  ].some(marker => lowered.includes(marker));
}

function rejectionReason(
  item: RetrievalEvidence,
  subject: string,
  location?: string,
): PantheonEvidenceRejectionReason | undefined {
  const metadataText = JSON.stringify(item.metadata || {});
  if (item.metadata?.entropySignature || item.metadata?.cooperativeAnalysis ||
      /(?:simulat(?:e|ed|ion)|mirrored|synthetic|test[ _-]?mode)/i.test([metadataText, item.crawler, item.sourceUrl].join(' ')) ||
      /\b(?:simulated|synthetic|mirrored)\s+(?:environment|output|result|data)\b/i.test(item.content)) {
    return 'simulation_or_test_output';
  }
  if (!item.content.trim() || !(item.confidence > 0)) return 'empty_or_low_confidence';
  if (item.confidence < 0.35) return 'weak_evidence';
  const text = cleanPantheonEvidenceContent(item.content);
  if (text.length < 40 || text.toLowerCase().includes('<!doctype') ||
      text.toLowerCase().includes('function(') || text.toLowerCase().includes('webpack')) {
    return 'unparseable_content';
  }
  if (blockedOrDiagnostic(text)) return 'diagnostic_or_block_page';

  const entityMatch = matchPantheonSubject(item, subject, location);
  return entityMatch.matched ? undefined : 'subject_mismatch';
}

export function requireVerifiedPantheonEvidence(items: readonly RetrievalEvidence[]): RetrievalEvidence[] {
  items.forEach(validatePantheonSourceResult);
  const rejected = items.filter(item =>
    item.metadata?.evidenceState !== 'verified_live_source' ||
    item.metadata?.subjectMatch !== true ||
    !item.provenance?.sourceUrl ||
    !item.contentHash ||
    !item.evidenceId
  );
  if (rejected.length) {
    throw new Error('Pantheon analysis rejected unverified or unattributed evidence');
  }
  return [...items];
}

export function dedupePantheonEvidence(items: readonly RetrievalEvidence[]): RetrievalEvidence[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const content = cleanPantheonEvidenceContent(item.content);
    const key = canonicalPantheonEvidenceUrl(item.target) + '|' + content.slice(0, 500).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function processPantheonEvidence(
  items: readonly RetrievalEvidence[],
  subject: string,
  location?: string,
): { accepted: RetrievalEvidence[]; rejected: PantheonRejectedEvidence[] } {
  const candidates: RetrievalEvidence[] = [];
  const rejected: PantheonRejectedEvidence[] = [];
  const duplicateKeys = new Set<string>();

  for (const item of items) {
    validatePantheonSourceResult(item);
    const entityMatch = matchPantheonSubject(item, subject, location);
    const reason = rejectionReason(item, subject, location);
    if (reason) {
      rejected.push({ evidence: item, reason });
      continue;
    }

    const normalized = createPantheonSourceResult({
      crawler: item.crawler,
      capabilityId: item.capabilityId,
      categoryLabel: item.categoryLabel,
      sourceUrl: canonicalPantheonEvidenceUrl(item.sourceUrl),
      content: cleanPantheonEvidenceContent(item.content),
      confidence: item.confidence,
      retrievedAt: item.retrievedAt,
      durationMs: item.provenance.durationMs,
      transport: item.provenance.transport,
      httpStatus: item.provenance.httpStatus,
      contentType: item.provenance.contentType,
      metadata: {
        ...(item.metadata || {}),
        evidenceState: 'verified_live_source',
        subjectMatch: true,
        entityMatch,
        analysisEligible: true,
      },
    });
    const duplicateKey = normalized.contentHash;
    if (duplicateKeys.has(duplicateKey)) {
      rejected.push({ evidence: item, reason: 'duplicate_evidence' });
      continue;
    }
    duplicateKeys.add(duplicateKey);
    candidates.push(normalized);
  }

  const accepted: RetrievalEvidence[] = [];
  const claimWinners = new Map<string, RetrievalEvidence>();
  for (const candidate of candidates) {
    const claimType = String(candidate.metadata?.claimType || '').trim();
    const claimKey = String(candidate.metadata?.claimKey || '').trim();
    const claimValue = String(candidate.metadata?.claimValue || '').trim().toLowerCase();
    if (!claimType || !claimKey || !claimValue) {
      accepted.push(candidate);
      continue;
    }

    const key = claimType + '|' + claimKey;
    const winner = claimWinners.get(key);
    if (!winner) {
      claimWinners.set(key, candidate);
      accepted.push(candidate);
      continue;
    }
    const winnerValue = String(winner.metadata?.claimValue || '').trim().toLowerCase();
    if (winnerValue === claimValue) {
      accepted.push(candidate);
      continue;
    }

    if (candidate.confidence > winner.confidence) {
      const winnerIndex = accepted.indexOf(winner);
      if (winnerIndex >= 0) accepted.splice(winnerIndex, 1);
      rejected.push({ evidence: winner, reason: 'conflicting_evidence' });
      claimWinners.set(key, candidate);
      accepted.push(candidate);
    } else {
      rejected.push({ evidence: candidate, reason: 'conflicting_evidence' });
    }
  }

  return { accepted, rejected };
}
