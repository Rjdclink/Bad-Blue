import type { RetrievalEvidence } from '../crawlers/PantheonRetrievalAdapter';

export type PantheonSubjectCorrelate =
  | 'location_phrase'
  | 'location_token_set'
  | 'structured_location'
  | 'source_identity_attribute'
  | 'source_record_identifier'
  | 'exact_unique_identifier';

export interface PantheonEntityMatch {
  matched: boolean;
  score: number;
  factors: string[];
  conflicts: string[];
  independentCorrelates: PantheonSubjectCorrelate[];
  normalizedSubject: string;
}

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'jr', 'sr', 'ii', 'iii', 'iv']);
const GENERIC_LOCATION_TOKENS = new Set([
  'area', 'borough', 'center', 'centre', 'city', 'county', 'district', 'east', 'fort',
  'heights', 'lake', 'mount', 'mt', 'new', 'north', 'park', 'saint', 'south', 'st',
  'state', 'town', 'united', 'village', 'west',
]);
const SOURCE_IDENTITY_ATTRIBUTE = /\b(?:address|alumni|born|case|credential|date of birth|dob|docket|education|email|employe[der]|employment|license|member|owner|parcel|phone|profile|registered|resident|resides|spouse|student|works? at)\b/i;
const RECORD_IDENTIFIER_KEYS = [
  'recordId', 'recordNumber', 'caseNumber', 'docketNumber', 'licenseNumber', 'profileId',
  'personId', 'registrationNumber', 'parcelId',
] as const;
const LOCATION_METADATA_KEYS = ['location', 'city', 'address', 'residence', 'jurisdiction'] as const;

function uniqueIdentifierKind(value: string): 'email' | 'phone' | 'username' | 'vin' | undefined {
  const candidate = String(value || '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(candidate)) return 'email';
  if (/^[A-HJ-NPR-Z0-9]{11,17}$/i.test(candidate)) return 'vin';
  if (/^@[A-Za-z0-9_.-]{2,64}$/.test(candidate)) return 'username';
  if (/^\+?[0-9() .-]{7,24}$/.test(candidate) && candidate.replace(/\D/g, '').length >= 7) return 'phone';
  return undefined;
}

function exactUniqueIdentifierMatch(content: string, rawSubject: string, kind: ReturnType<typeof uniqueIdentifierKind>): boolean {
  if (!kind) return false;
  if (kind === 'phone') {
    const needle = rawSubject.replace(/\D/g, '');
    return needle.length >= 7 && content.replace(/\D/g, '').includes(needle);
  }
  return normalize(content).includes(normalize(rawSubject));
}

function clean(value: unknown): string {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function normalize(value: unknown): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function words(value: string): string[] {
  return value.split(' ').filter(Boolean);
}

function tokensShareWindow(contentWords: readonly string[], required: readonly string[], windowSize = 12): boolean {
  if (!required.length || contentWords.length < required.length) return false;
  const uniqueRequired = [...new Set(required)];
  for (let start = 0; start < contentWords.length; start += 1) {
    const window = new Set(contentWords.slice(start, start + windowSize));
    if (uniqueRequired.every(token => window.has(token))) return true;
  }
  return false;
}

function locationCorrelates(
  content: string,
  rawLocation: string | undefined,
): { matched: boolean; factor?: PantheonSubjectCorrelate } {
  const normalizedLocation = normalize(rawLocation);
  if (!normalizedLocation) return { matched: false };

  const contentTokens = new Set(words(content));
  const locationTokens = words(normalizedLocation);
  const primarySegment = normalize(String(rawLocation || '').split(',')[0]);
  const primaryTokens = words(primarySegment);
  const primaryHasDistinctiveToken = primaryTokens.some(token =>
    token.length >= 3 && !GENERIC_LOCATION_TOKENS.has(token));

  // A complete locality phrase is meaningful; a stray token such as "new",
  // "city", or "county" is not a subject correlate.
  if (primarySegment && primaryHasDistinctiveToken &&
      (primaryTokens.length > 1 || primaryTokens[0]?.length >= 5) &&
      content.includes(primarySegment)) {
    return { matched: true, factor: 'location_phrase' };
  }

  const significantTokens = locationTokens.filter(token =>
    token.length >= 3 && !GENERIC_LOCATION_TOKENS.has(token));
  const matchedSignificant = significantTokens.filter(token => contentTokens.has(token));
  const shortRegionTokens = locationTokens.filter(token => token.length === 2);
  const matchedRegions = shortRegionTokens.filter(token => contentTokens.has(token));

  if (matchedSignificant.length >= 2 ||
      (matchedSignificant.length >= 1 && matchedRegions.length >= 1)) {
    return { matched: true, factor: 'location_token_set' };
  }

  // A single-token location is accepted only when the entire supplied locality
  // is a distinctive token, never when one token merely overlaps a longer place.
  if (locationTokens.length === 1 && significantTokens.length === 1 &&
      significantTokens[0].length >= 5 && contentTokens.has(significantTokens[0])) {
    return { matched: true, factor: 'location_phrase' };
  }

  return { matched: false };
}

function sourceIdentityAttributeCorrelates(content: string, normalizedSubject: string): boolean {
  const subjectIndex = content.indexOf(normalizedSubject);
  if (subjectIndex < 0) return false;
  const start = Math.max(0, subjectIndex - 220);
  const end = Math.min(content.length, subjectIndex + normalizedSubject.length + 220);
  return SOURCE_IDENTITY_ATTRIBUTE.test(content.slice(start, end));
}

function sourceRecordIdentifierCorrelates(item: RetrievalEvidence, content: string): boolean {
  for (const key of RECORD_IDENTIFIER_KEYS) {
    const value = normalize(item.metadata?.[key]);
    if (value.length < 3) continue;
    if (content.includes(value) || normalize(item.sourceUrl).includes(value)) return true;
  }
  return false;
}

function structuredLocationCorrelates(item: RetrievalEvidence, location?: string): boolean {
  if (!location) return false;
  for (const key of LOCATION_METADATA_KEYS) {
    const candidate = String(item.metadata?.[key] || '').trim();
    if (!candidate) continue;
    const forward = locationCorrelates(normalize(candidate), location).matched;
    const reverse = locationCorrelates(normalize(location), candidate).matched;
    if (forward && reverse) return true;
  }
  return false;
}

export function matchPantheonSubject(
  item: RetrievalEvidence,
  subject: string,
  location?: string,
): PantheonEntityMatch {
  const normalizedSubject = normalize(subject);
  const content = normalize(clean(item.content));
  const contentWords = words(content);
  const contentTokenSet = new Set(contentWords);
  const factors: string[] = [];
  const conflicts: string[] = [];
  const independentCorrelates: PantheonSubjectCorrelate[] = [];
  let score = 0;
  const identifierKind = uniqueIdentifierKind(subject);
  const exactIdentifierMatch = exactUniqueIdentifierMatch(clean(item.content), subject, identifierKind);

  const tokens = words(normalizedSubject)
    .filter(token => token.length >= 2 && !HONORIFICS.has(token));
  const normalizedName = tokens.join(' ');
  const fullNameMatch = tokens.length >= 2 && content.includes(normalizedName);
  const matchedTokens = tokens.filter(token => contentTokenSet.has(token));
  const allNameTokensNearby = tokens.length >= 2 && tokensShareWindow(contentWords, tokens);
  const firstLastNearby = tokens.length >= 2 && tokensShareWindow(
    contentWords,
    [tokens[0], tokens[tokens.length - 1]],
    8,
  );

  if (fullNameMatch) {
    score += 0.67;
    factors.push('exact_normalized_name');
  } else if (allNameTokensNearby) {
    score += 0.62;
    factors.push('all_name_tokens');
  } else if (firstLastNearby) {
    score += 0.52;
    factors.push('first_last_name');
  } else if (tokens.length === 1 && matchedTokens.length === 1) {
    // Retain the diagnostic factor for observability, but a one-token subject
    // is never specific enough to be accepted automatically.
    score += 0.2;
    factors.push('single_name_token');
    conflicts.push('insufficient_subject_specificity');
  }

  if (exactIdentifierMatch) {
    score = Math.max(score, 0.92);
    factors.push(`exact_${identifierKind}_identifier`);
    independentCorrelates.push('exact_unique_identifier');
  }

  if (fullNameMatch && tokens.length >= 3) {
    score += 0.05;
    factors.push('distinctive_multi_token_name');
  }

  try {
    const host = new URL(item.sourceUrl).hostname.toLowerCase();
    if (fullNameMatch && (host.endsWith('.gov') || host.endsWith('.mil') || host.endsWith('.edu'))) {
      // Authority affects evidence ranking, never identity acceptance.
      factors.push('authoritative_public_domain');
    }
  } catch {
    conflicts.push('invalid_source_url');
  }

  const locationMatch = locationCorrelates(content, location);
  if (locationMatch.matched && locationMatch.factor) {
    score += 0.28;
    factors.push('location_correlates');
    independentCorrelates.push(locationMatch.factor);
  }

  if (structuredLocationCorrelates(item, location)) {
    score += 0.28;
    factors.push('structured_location_correlates');
    independentCorrelates.push('structured_location');
  }

  const metadataSubject = normalize(item.metadata?.subjectName || item.metadata?.subject || item.metadata?.personName);
  if (metadataSubject) {
    if (metadataSubject === normalizedSubject) {
      score += 0.08;
      factors.push('metadata_subject_exact');
    } else {
      conflicts.push('metadata_subject_conflict');
    }
  }

  if ((fullNameMatch || allNameTokensNearby) && sourceIdentityAttributeCorrelates(content, normalizedName)) {
    score += 0.2;
    factors.push('source_identity_attribute');
    independentCorrelates.push('source_identity_attribute');
  }

  if ((fullNameMatch || allNameTokensNearby) && sourceRecordIdentifierCorrelates(item, content)) {
    score += 0.22;
    factors.push('source_record_identifier');
    independentCorrelates.push('source_record_identifier');
  }

  const uniqueCorrelates = [...new Set(independentCorrelates)];
  const boundedScore = Math.min(1, score);
  const reliableNameMatch = fullNameMatch || allNameTokensNearby || exactIdentifierMatch;
  return {
    matched: reliableNameMatch && uniqueCorrelates.length > 0 && boundedScore >= 0.82 && conflicts.length === 0,
    score: boundedScore,
    factors,
    conflicts,
    independentCorrelates: uniqueCorrelates,
    normalizedSubject,
  };
}
