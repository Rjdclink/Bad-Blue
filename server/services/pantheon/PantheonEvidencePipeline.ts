import type { RetrievalEvidence } from '../crawlers/PantheonRetrievalAdapter';
import { matchPantheonSubject } from './PantheonEntityResolution';

export type PantheonEvidenceRejectionReason =
  | 'simulation_or_test_output'
  | 'empty_or_low_confidence'
  | 'diagnostic_or_block_page'
  | 'unparseable_content'
  | 'subject_mismatch';

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
      /(?:simulat(?:e|ed|ion)|mirrored|synthetic|test[ _-]?mode)/i.test(metadataText)) {
    return 'simulation_or_test_output';
  }
  if (!item.content.trim() || !(item.confidence > 0)) return 'empty_or_low_confidence';
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
  const rejected = items.filter(item =>
    item.metadata?.evidenceState !== 'verified_live_source' ||
    item.metadata?.subjectMatch !== true ||
    !item.metadata?.provenance
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
  const accepted: RetrievalEvidence[] = [];
  const rejected: PantheonRejectedEvidence[] = [];
  for (const item of items) {
    const entityMatch = matchPantheonSubject(item, subject, location);
    const reason = rejectionReason(item, subject, location);
    if (reason) rejected.push({ evidence: item, reason });
    else accepted.push({
      ...item,
      target: canonicalPantheonEvidenceUrl(item.target),
      content: cleanPantheonEvidenceContent(item.content),
      metadata: {
        ...(item.metadata || {}),
        evidenceState: 'verified_live_source',
        subjectMatch: true,
        entityMatch,
        provenance: {
          sourceUrl: canonicalPantheonEvidenceUrl(item.target),
          retrievedAt: item.retrievedAt,
          crawler: item.crawler,
        },
      },
    });
  }
  return { accepted: dedupePantheonEvidence(accepted), rejected };
}
