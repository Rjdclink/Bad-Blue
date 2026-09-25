import { createHash } from 'node:crypto';
import type { RetrievalEvidence } from '../crawlers/PantheonRetrievalAdapter';
import { matchPantheonSubject, type PantheonEntityMatch } from './PantheonEntityResolution';
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
  | 'weak_evidence'
  | 'discovery_result_not_evidence';

export interface PantheonRejectedEvidence {
  evidence: RetrievalEvidence;
  reason: PantheonEvidenceRejectionReason;
}

export type PantheonCategoryClaimType =
  | 'source_mention'
  | 'identity_record'
  | 'date_of_birth'
  | 'phone_number'
  | 'email_address'
  | 'current_address'
  | 'historical_address'
  | 'relative'
  | 'associate'
  | 'social_profile'
  | 'online_account'
  | 'public_image'
  | 'employment'
  | 'education'
  | 'professional_credential'
  | 'business_affiliation'
  | 'property_record'
  | 'transportation_record'
  | 'court_record'
  | 'criminal_record'
  | 'arrest_record'
  | 'corrections_record'
  | 'probation_parole_record'
  | 'warrant_record'
  | 'sex_offender_record'
  | 'civil_judgment'
  | 'financial_public_record'
  | 'vital_record'
  | 'news_mention'
  | 'web_footprint'
  | 'public_service_record'
  | 'relationship_timeline_event';

export interface PantheonCategoryClaim {
  schemaVersion: 'pantheon-category-claim-v1';
  categoryLabel: string;
  claimType: PantheonCategoryClaimType;
  claimKey: string;
  claimValue: string;
  normalizedValue: string;
  exclusive: boolean;
  derivation: 'validated_source_metadata' | 'explicit_source_text' | 'source_subject_mention';
}

export interface PantheonEvidenceRank {
  schemaVersion: 'pantheon-evidence-rank-v1';
  authority: number;
  entity: number;
  corroboration: number;
  confidence: number;
  recency: number;
  independentDomains: number;
  score: number;
}

const CLAIM_TYPES = new Set<PantheonCategoryClaimType>([
  'source_mention', 'identity_record', 'date_of_birth', 'phone_number', 'email_address',
  'current_address', 'historical_address', 'relative', 'associate', 'social_profile',
  'online_account', 'public_image', 'employment', 'education', 'professional_credential',
  'business_affiliation', 'property_record', 'transportation_record', 'court_record',
  'criminal_record', 'arrest_record', 'corrections_record', 'probation_parole_record',
  'warrant_record', 'sex_offender_record', 'civil_judgment', 'financial_public_record',
  'vital_record', 'news_mention', 'web_footprint', 'public_service_record',
  'relationship_timeline_event',
]);

const CATEGORY_CLAIM_TYPES: Record<string, PantheonCategoryClaimType> = {
  'identity & identity verification': 'identity_record',
  'phone numbers': 'phone_number',
  'email addresses': 'email_address',
  'current address': 'current_address',
  'address history': 'historical_address',
  'relatives & family': 'relative',
  'associates & household connections': 'associate',
  'social-media profiles': 'social_profile',
  'usernames & online accounts': 'online_account',
  'photos & public images': 'public_image',
  'employment history': 'employment',
  education: 'education',
  'professional licenses & credentials': 'professional_credential',
  'business ownership & affiliations': 'business_affiliation',
  'property & real estate': 'property_record',
  'vehicles & transportation records': 'transportation_record',
  'court records': 'court_record',
  'criminal records': 'criminal_record',
  'arrest & police records': 'arrest_record',
  'incarceration & corrections': 'corrections_record',
  'probation & parole information': 'probation_parole_record',
  'warrants & wanted-person records': 'warrant_record',
  'sex-offender registries': 'sex_offender_record',
  'civil litigation & judgments': 'civil_judgment',
  'bankruptcies, liens & financial public records': 'financial_public_record',
  'marriage, divorce & vital-record information': 'vital_record',
  'news & media mentions': 'news_mention',
  'internet & web footprint': 'web_footprint',
  'government, political & public-service records': 'public_service_record',
  'relationship & timeline intelligence': 'relationship_timeline_event',
};

function normalizeComparable(value: unknown): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@.+-]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function bounded(value: unknown): number {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function canonicalPantheonEvidenceUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return value.trim();
  }
}

export function cleanPantheonEvidenceContent(value: string): string {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(?:svg|form)\b[^>]*>[\s\S]*?<\/(?:svg|form)>/gi, ' ')
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
    'sign in to continue',
    'login required',
    'subscribe to continue',
    'checking your browser',
    'cloudflare ray id',
    'security check',
    'service unavailable',
    'internal server error',
    'bad gateway',
    'gateway timeout',
    'page not found',
  ].some(marker => lowered.includes(marker));
}

function sourceHost(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function relevantWindow(content: string, subject: string, radius = 320): string {
  const lowered = content.toLowerCase();
  const subjectIndex = lowered.indexOf(subject.toLowerCase());
  if (subjectIndex < 0) return content.slice(0, radius * 2);
  return content.slice(
    Math.max(0, subjectIndex - radius),
    Math.min(content.length, subjectIndex + subject.length + radius),
  );
}

export function buildPantheonEvidenceExcerpt(content: string, subject: string): string {
  const cleaned = cleanPantheonEvidenceContent(content);
  const window = relevantWindow(cleaned, subject, 360).trim();
  if (window.length <= 720) return window;
  return window.slice(0, 717).replace(/\s+\S*$/, '').trimEnd() + '...';
}

function explicitClaimValue(
  claimType: PantheonCategoryClaimType,
  content: string,
  subject: string,
): string | undefined {
  const window = relevantWindow(content, subject);
  const patterns: Partial<Record<PantheonCategoryClaimType, RegExp>> = {
    date_of_birth: /\b(?:date of birth|dob|born)\s*(?:is|:|-)?\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\b/i,
    phone_number: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/,
    email_address: /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i,
    current_address: /\b\d{1,6}\s+[A-Za-z0-9.' -]{2,80}\s(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|way)\b[^.;\n]{0,80}/i,
    historical_address: /\b\d{1,6}\s+[A-Za-z0-9.' -]{2,80}\s(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|way)\b[^.;\n]{0,80}/i,
    social_profile: /\b(?:https?:\/\/)?(?:www\.)?(?:facebook\.com|linkedin\.com\/in|instagram\.com|x\.com|twitter\.com|tiktok\.com\/@)\/[\w.@/-]+/i,
    online_account: /(?:^|\s)(@[A-Za-z0-9_.-]{3,32})\b/,
    professional_credential: /\b(?:license|credential|registration)\s*(?:#|no\.?|number|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,30})\b/i,
    court_record: /\b(?:case|docket)\s*(?:#|no\.?|number|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9:-]{3,40})\b/i,
    criminal_record: /\b(?:case|docket)\s*(?:#|no\.?|number|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9:-]{3,40})\b/i,
    arrest_record: /\b(?:arrest|booking)\s*(?:#|no\.?|number|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9:-]{3,40})\b/i,
    corrections_record: /\b(?:inmate|offender)\s*(?:#|no\.?|number|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9:-]{3,40})\b/i,
    probation_parole_record: /\b(?:probation|parole)\s*(?:case|record)?\s*(?:#|no\.?|number|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9:-]{3,40})\b/i,
    warrant_record: /\bwarrant\s*(?:#|no\.?|number|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9:-]{3,40})\b/i,
    civil_judgment: /\b(?:case|docket|judgment)\s*(?:#|no\.?|number|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9:-]{3,40})\b/i,
    property_record: /\b(?:parcel|property)\s*(?:#|no\.?|number|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9:-]{3,40})\b/i,
    transportation_record: /\b(?:vin|vehicle)\s*(?:#|no\.?|number|id)?\s*[:#-]?\s*([A-HJ-NPR-Z0-9]{11,17})\b/i,
  };
  const pattern = patterns[claimType];
  if (!pattern) return undefined;
  const match = window.match(pattern);
  const value = String(match?.[1] || match?.[0] || '').trim();
  return value && value.length <= 200 ? value : undefined;
}

function deriveCategoryClaim(
  item: RetrievalEvidence,
  content: string,
  subject: string,
): PantheonCategoryClaim {
  const categoryLabel = String(item.categoryLabel || item.metadata?.reportCategory || 'Unassigned').trim();
  const normalizedSubject = normalizeComparable(subject);
  const metadataClaim = item.metadata?.categoryClaim as Partial<PantheonCategoryClaim> | undefined;
  const metadataType = String(metadataClaim?.claimType || item.metadata?.claimType || '') as PantheonCategoryClaimType;
  const metadataValue = String(metadataClaim?.claimValue || item.metadata?.claimValue || '').trim();
  const normalizedMetadataValue = normalizeComparable(metadataValue);
  if (CLAIM_TYPES.has(metadataType) && normalizedMetadataValue &&
      normalizeComparable(content).includes(normalizedMetadataValue)) {
    return {
      schemaVersion: 'pantheon-category-claim-v1',
      categoryLabel,
      claimType: metadataType,
      claimKey: String(metadataClaim?.claimKey || item.metadata?.claimKey || `${normalizedSubject}:${metadataType}`).trim(),
      claimValue: metadataValue.slice(0, 200),
      normalizedValue: normalizedMetadataValue.slice(0, 200),
      exclusive: metadataClaim?.exclusive === true || item.metadata?.claimExclusive === true,
      derivation: 'validated_source_metadata',
    };
  }

  const categoryType = CATEGORY_CLAIM_TYPES[categoryLabel.toLowerCase()] || 'source_mention';
  const explicitValue = explicitClaimValue(categoryType, content, subject);
  if (explicitValue) {
    const normalizedValue = normalizeComparable(explicitValue);
    return {
      schemaVersion: 'pantheon-category-claim-v1',
      categoryLabel,
      claimType: categoryType,
      claimKey: `${normalizedSubject}:${categoryType}`,
      claimValue: explicitValue,
      normalizedValue,
      exclusive: categoryType === 'date_of_birth',
      derivation: 'explicit_source_text',
    };
  }

  return {
    schemaVersion: 'pantheon-category-claim-v1',
    categoryLabel,
    claimType: 'source_mention',
    claimKey: `${normalizedSubject}:source_mention`,
    claimValue: subject.trim().slice(0, 200),
    normalizedValue: normalizedSubject,
    exclusive: false,
    derivation: 'source_subject_mention',
  };
}

function authorityScore(item: RetrievalEvidence): number {
  const declared = String(item.metadata?.sourceAuthority || item.metadata?.registryAuthority || '').toLowerCase();
  if (declared === 'primary') return 1;
  if (declared === 'secondary') return 0.78;
  if (declared === 'archive') return 0.68;
  const host = sourceHost(item.sourceUrl);
  if (/(?:^|\.)gov(?:\.|$)|(?:^|\.)mil$/.test(host)) return 1;
  if (/(?:^|\.)edu$/.test(host)) return 0.88;
  if (item.provenance.transport === 'archive') return 0.68;
  return item.provenance.httpStatus === 200 ? 0.62 : 0.56;
}

function recencyScore(item: RetrievalEvidence): number {
  const raw = item.metadata?.publishedAt || item.metadata?.recordDate ||
    item.metadata?.sourceUpdatedAt || item.metadata?.lastModified;
  if (!raw) return 0.5;
  const sourceTime = Date.parse(String(raw));
  const retrievalTime = Date.parse(item.retrievedAt);
  if (!Number.isFinite(sourceTime) || !Number.isFinite(retrievalTime)) return 0.5;
  const ageDays = (retrievalTime - sourceTime) / 86_400_000;
  if (ageDays < -7) return 0.2;
  if (ageDays <= 90) return 1;
  if (ageDays <= 365) return 0.85;
  if (ageDays <= 1_825) return 0.65;
  return 0.4;
}

function claimFrom(item: RetrievalEvidence): PantheonCategoryClaim | undefined {
  const claim = item.metadata?.categoryClaim as PantheonCategoryClaim | undefined;
  return claim?.schemaVersion === 'pantheon-category-claim-v1' ? claim : undefined;
}

function stableCitationId(item: RetrievalEvidence, claim: PantheonCategoryClaim, contentHash: string): string {
  return 'PNT-' + createHash('sha256').update([
    claim.categoryLabel.toLowerCase(),
    canonicalPantheonEvidenceUrl(item.sourceUrl),
    claim.claimType,
    claim.claimKey,
    claim.normalizedValue,
    contentHash,
  ].join('\u0000')).digest('hex').slice(0, 24).toUpperCase();
}

function evidenceDedupeKey(item: RetrievalEvidence): string {
  const claim = claimFrom(item);
  const category = String(claim?.categoryLabel || item.categoryLabel || item.metadata?.reportCategory || 'Unassigned').toLowerCase();
  const claimPart = claim
    ? [claim.claimType, claim.claimKey, claim.normalizedValue].join('|')
    : item.contentHash;
  return [category, canonicalPantheonEvidenceUrl(item.sourceUrl), claimPart].join('|');
}

function rankFrom(item: RetrievalEvidence): PantheonEvidenceRank | undefined {
  const rank = item.metadata?.evidenceRank as PantheonEvidenceRank | undefined;
  return rank?.schemaVersion === 'pantheon-evidence-rank-v1' ? rank : undefined;
}

function deterministicEvidenceOrder(left: RetrievalEvidence, right: RetrievalEvidence): number {
  const leftRank = rankFrom(left);
  const rightRank = rankFrom(right);
  const leftScore = leftRank?.score ?? bounded(left.confidence);
  const rightScore = rightRank?.score ?? bounded(right.confidence);
  if (rightScore !== leftScore) return rightScore - leftScore;
  const leftCitation = String(left.metadata?.citationId || left.evidenceId);
  const rightCitation = String(right.metadata?.citationId || right.evidenceId);
  return leftCitation.localeCompare(rightCitation);
}

function rankPantheonEvidence(items: readonly RetrievalEvidence[]): RetrievalEvidence[] {
  const independentDomains = new Map<string, Set<string>>();
  for (const item of items) {
    const claim = claimFrom(item);
    if (!claim) continue;
    const fingerprint = [claim.categoryLabel.toLowerCase(), claim.claimType, claim.claimKey, claim.normalizedValue].join('|');
    const hosts = independentDomains.get(fingerprint) || new Set<string>();
    const host = sourceHost(item.sourceUrl);
    if (host) hosts.add(host);
    independentDomains.set(fingerprint, hosts);
  }

  for (const item of items) {
    const claim = claimFrom(item);
    const fingerprint = claim
      ? [claim.categoryLabel.toLowerCase(), claim.claimType, claim.claimKey, claim.normalizedValue].join('|')
      : '';
    const domains = independentDomains.get(fingerprint)?.size || 1;
    const entityMatch = item.metadata?.entityMatch as Partial<PantheonEntityMatch> | undefined;
    const authority = authorityScore(item);
    const entity = bounded(entityMatch?.score);
    const corroboration = domains <= 1 ? 0 : domains === 2 ? 0.75 : 1;
    const confidence = bounded(item.confidence);
    const recency = recencyScore(item);
    const rank: PantheonEvidenceRank = {
      schemaVersion: 'pantheon-evidence-rank-v1',
      authority: rounded(authority),
      entity: rounded(entity),
      corroboration: rounded(corroboration),
      confidence: rounded(confidence),
      recency: rounded(recency),
      independentDomains: domains,
      score: rounded(
        authority * 0.25 + entity * 0.30 + corroboration * 0.15 + confidence * 0.20 + recency * 0.10,
      ),
    };
    item.metadata = { ...(item.metadata || {}), evidenceRank: rank };
  }
  return [...items].sort(deterministicEvidenceOrder);
}

function rejectionReason(
  item: RetrievalEvidence,
  subject: string,
  location?: string,
  entityMatch?: PantheonEntityMatch,
): PantheonEvidenceRejectionReason | undefined {
  if (item.metadata?.discoveryOnly === true || item.provenance?.transport === 'search-provider') {
    return 'discovery_result_not_evidence';
  }
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

  const resolvedEntity = entityMatch || matchPantheonSubject(item, subject, location);
  return resolvedEntity.matched ? undefined : 'subject_mismatch';
}

export interface PantheonCorrelationSummary {
  corroboratedClaimCount: number;
  crossCategoryClaimCount: number;
  relationshipClaimCount: number;
  timelineClaimCount: number;
  independentDomainCount: number;
}

export function summarizePantheonCorrelations(items: readonly RetrievalEvidence[]): PantheonCorrelationSummary {
  const claims = new Map<string, { domains: Set<string>; categories: Set<string> }>();
  const allDomains = new Set<string>();
  for (const item of items) {
    const claim = claimFrom(item);
    const host = sourceHost(item.sourceUrl);
    if (host) allDomains.add(host);
    if (!claim || claim.claimType === 'source_mention') continue;
    const key = [claim.claimType, claim.normalizedValue].join('|');
    const current = claims.get(key) || { domains: new Set<string>(), categories: new Set<string>() };
    if (host) current.domains.add(host);
    current.categories.add(claim.categoryLabel);
    claims.set(key, current);
  }
  let corroboratedClaimCount = 0;
  let crossCategoryClaimCount = 0;
  let relationshipClaimCount = 0;
  let timelineClaimCount = 0;
  for (const [key, value] of claims) {
    if (value.domains.size > 1) corroboratedClaimCount += 1;
    if (value.categories.size > 1) crossCategoryClaimCount += 1;
    if (/relative|associate|relationship/i.test(key)) relationshipClaimCount += 1;
    if (/date|historical|timeline|vital/i.test(key)) timelineClaimCount += 1;
  }
  return {
    corroboratedClaimCount,
    crossCategoryClaimCount,
    relationshipClaimCount,
    timelineClaimCount,
    independentDomainCount: allDomains.size,
  };
}

export function requireVerifiedPantheonEvidence(items: readonly RetrievalEvidence[]): RetrievalEvidence[] {
  items.forEach(validatePantheonSourceResult);
  const rejected = items.filter(item =>
    item.metadata?.evidenceState !== 'verified_live_source' ||
    item.metadata?.subjectMatch !== true ||
    !Array.isArray((item.metadata?.entityMatch as Partial<PantheonEntityMatch> | undefined)?.independentCorrelates) ||
    !((item.metadata?.entityMatch as Partial<PantheonEntityMatch>).independentCorrelates?.length) ||
    !(item.metadata?.categoryClaim as PantheonCategoryClaim | undefined)?.claimType ||
    !(item.metadata?.evidenceRank as PantheonEvidenceRank | undefined)?.score ||
    !item.metadata?.citationId ||
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
  return [...items].sort(deterministicEvidenceOrder).filter(item => {
    const key = evidenceDedupeKey(item);
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
  const candidates: Array<{ original: RetrievalEvidence; normalized: RetrievalEvidence }> = [];
  const rejected: PantheonRejectedEvidence[] = [];

  for (const item of items) {
    validatePantheonSourceResult(item);
    const entityMatch = matchPantheonSubject(item, subject, location);
    const reason = rejectionReason(item, subject, location, entityMatch);
    if (reason) {
      rejected.push({ evidence: item, reason });
      continue;
    }

    const cleanedContent = cleanPantheonEvidenceContent(item.content);
    const excerpt = buildPantheonEvidenceExcerpt(cleanedContent, subject);
    const categoryClaim = deriveCategoryClaim(item, cleanedContent, subject);
    const excerptHash = createHash('sha256').update(excerpt).digest('hex');
    const citationId = stableCitationId(item, categoryClaim, excerptHash);
    const normalizedContent = createPantheonSourceResult({
      crawler: item.crawler,
      capabilityId: item.capabilityId,
      categoryLabel: item.categoryLabel,
      sourceUrl: canonicalPantheonEvidenceUrl(item.sourceUrl),
      content: excerpt,
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
        categoryClaim,
        claimType: categoryClaim.claimType,
        claimKey: categoryClaim.claimKey,
        claimValue: categoryClaim.claimValue,
        claimExclusive: categoryClaim.exclusive,
        citationId,
        citation: {
          schemaVersion: 'pantheon-citation-v1',
          citationId,
          categoryLabel: categoryClaim.categoryLabel,
          sourceUrl: canonicalPantheonEvidenceUrl(item.sourceUrl),
          contentHash: excerptHash,
          retrievedAt: item.retrievedAt,
        },
        sourceContentHash: item.contentHash,
        analysisEligible: true,
      },
    });
    const normalized: RetrievalEvidence = {
      ...normalizedContent,
      status: 'completed_with_evidence',
    };
    candidates.push({ original: item, normalized });
  }

  const dedupeWinners = new Map<string, { original: RetrievalEvidence; normalized: RetrievalEvidence }>();
  for (const entry of candidates) {
    const key = evidenceDedupeKey(entry.normalized);
    const existing = dedupeWinners.get(key);
    if (!existing || deterministicEvidenceOrder(entry.normalized, existing.normalized) < 0) {
      if (existing) rejected.push({ evidence: existing.original, reason: 'duplicate_evidence' });
      dedupeWinners.set(key, entry);
    } else {
      rejected.push({ evidence: entry.original, reason: 'duplicate_evidence' });
    }
  }

  const ranked = rankPantheonEvidence([...dedupeWinners.values()].map(entry => entry.normalized));
  const accepted: RetrievalEvidence[] = [];
  const exclusiveGroups = new Map<string, RetrievalEvidence[]>();
  for (const candidate of ranked) {
    const claim = claimFrom(candidate);
    if (!claim?.exclusive) {
      accepted.push(candidate);
      continue;
    }
    const key = [claim.categoryLabel.toLowerCase(), claim.claimType, claim.claimKey].join('|');
    const group = exclusiveGroups.get(key) || [];
    group.push(candidate);
    exclusiveGroups.set(key, group);
  }

  // A disputed singular fact is not resolved by confidence alone. Pantheon
  // accepts a value only when it has strictly greater independent-source
  // corroboration; otherwise every competing value remains excluded.
  for (const group of exclusiveGroups.values()) {
    const valueGroups = new Map<string, RetrievalEvidence[]>();
    for (const candidate of group) {
      const value = claimFrom(candidate)?.normalizedValue || '';
      const values = valueGroups.get(value) || [];
      values.push(candidate);
      valueGroups.set(value, values);
    }
    if (valueGroups.size === 1) {
      accepted.push(...group);
      continue;
    }

    const orderedValues = [...valueGroups.entries()].map(([value, evidence]) => ({
      value,
      evidence: evidence.sort(deterministicEvidenceOrder),
      domains: new Set(evidence.map(item => sourceHost(item.sourceUrl)).filter(Boolean)).size,
    })).sort((left, right) =>
      right.domains - left.domains || deterministicEvidenceOrder(left.evidence[0], right.evidence[0]));
    const winner = orderedValues[0];
    const runnerUp = orderedValues[1];
    const resolved = winner.domains >= 2 && winner.domains > runnerUp.domains;
    for (const valueGroup of orderedValues) {
      if (resolved && valueGroup.value === winner.value) {
        for (const candidate of valueGroup.evidence) {
          candidate.metadata = {
            ...(candidate.metadata || {}),
            conflictResolution: {
              status: 'corroborated_winner',
              corroboratingDomains: winner.domains,
              competingValues: orderedValues.length,
            },
          };
        }
        accepted.push(...valueGroup.evidence);
      } else {
        rejected.push(...valueGroup.evidence.map(evidence => ({ evidence, reason: 'conflicting_evidence' as const })));
      }
    }
  }

  return { accepted: accepted.sort(deterministicEvidenceOrder), rejected };
}
