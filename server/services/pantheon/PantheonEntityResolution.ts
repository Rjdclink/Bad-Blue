import type { RetrievalEvidence } from '../crawlers/PantheonRetrievalAdapter';

export interface PantheonEntityMatch {
  matched: boolean;
  score: number;
  factors: string[];
  conflicts: string[];
  normalizedSubject: string;
}

function clean(value: unknown): string {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
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

export function matchPantheonSubject(
  item: RetrievalEvidence,
  subject: string,
  location?: string,
): PantheonEntityMatch {
  const normalizedSubject = normalize(subject);
  const content = normalize(clean(item.content));
  const factors: string[] = [];
  const conflicts: string[] = [];
  let score = 0;

  const tokens = normalizedSubject.split(' ').filter(token => token.length >= 2);
  const fullNameMatch = normalizedSubject.length >= 2 && content.includes(normalizedSubject);
  const matchedTokens = tokens.filter(token => content.split(' ').includes(token));
  if (fullNameMatch) {
    score += 0.7;
    factors.push('exact_normalized_name');
  } else if (tokens.length > 1 && matchedTokens.length === tokens.length) {
    score += 0.65;
    factors.push('all_name_tokens');
  } else if (tokens.length > 1 && matchedTokens.includes(tokens[0]) && matchedTokens.includes(tokens[tokens.length - 1])) {
    score += 0.55;
    factors.push('first_last_name');
  } else if (tokens.length === 1 && matchedTokens.length === 1) {
    score += 0.55;
    factors.push('single_name_token');
  }

  if (fullNameMatch && tokens.length >= 3) {
    score += 0.15;
    factors.push('distinctive_multi_token_name');
  }

  try {
    const host = new URL(item.sourceUrl).hostname.toLowerCase();
    if (fullNameMatch && (host.endsWith('.gov') || host.endsWith('.edu'))) {
      score += 0.15;
      factors.push('authoritative_public_domain');
    }
  } catch {
    conflicts.push('invalid_source_url');
  }

  const normalizedLocation = normalize(location);
  const locationTokens = normalizedLocation.split(' ').filter(token => token.length >= 3);
  if (locationTokens.length && locationTokens.some(token => content.split(' ').includes(token))) {
    score += 0.2;
    factors.push('location_correlates');
  }

  const metadataSubject = normalize(item.metadata?.subjectName || item.metadata?.subject || item.metadata?.personName);
  if (metadataSubject) {
    if (metadataSubject === normalizedSubject) {
      score += 0.25;
      factors.push('metadata_subject_exact');
    } else {
      conflicts.push('metadata_subject_conflict');
    }
  }

  const boundedScore = Math.min(1, score);
  return {
    matched: boundedScore >= 0.8 && conflicts.length === 0,
    score: boundedScore,
    factors,
    conflicts,
    normalizedSubject,
  };
}
