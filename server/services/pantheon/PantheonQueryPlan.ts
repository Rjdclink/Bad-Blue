import { createHash } from 'node:crypto';

export const PANTHEON_IDENTIFIER_KINDS = [
  'name',
  'phone',
  'email',
  'username',
  'address',
  'business',
  'property',
  'vin',
] as const;

export type PantheonIdentifierKind = typeof PANTHEON_IDENTIFIER_KINDS[number];

export interface PantheonStartingIdentifier {
  kind: PantheonIdentifierKind;
  value: string;
}

export interface PantheonControlledQueryPlan {
  schemaVersion: 'pantheon-query-plan-v1';
  planId: string;
  mode: 'interactive-single-subject';
  primary: PantheonStartingIdentifier;
  location?: string;
  searchTerms: string[];
  categoryHints: string[];
  relationshipHopLimit: number;
  automaticIdentityMerge: false;
}

function normalized(value: unknown, maximumLength: number): string {
  const clean = String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  if (clean.length > maximumLength) throw new Error('input_too_long');
  return clean;
}

function validateIdentifier(kind: PantheonIdentifierKind, value: string): void {
  const rules: Record<PantheonIdentifierKind, RegExp> = {
    name: /[\p{L}\p{N}].*[\p{L}\p{N}]|[\p{L}\p{N}]/u,
    phone: /^\+?[0-9() .-]{7,24}$/,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
    username: /^@?[A-Za-z0-9_.-]{2,64}$/,
    address: /\d|\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|way|route|highway|hwy)\b/i,
    business: /[\p{L}\p{N}]{2,}/u,
    property: /[\p{L}\p{N}]{2,}/u,
    vin: /^[A-HJ-NPR-Z0-9]{11,17}$/i,
  };
  if (!rules[kind].test(value)) throw new Error(`invalid_${kind}_identifier`);
}

export function normalizePantheonStartingIdentifier(input: {
  kind?: unknown;
  value?: unknown;
  legacyName?: unknown;
}): PantheonStartingIdentifier {
  const candidateKind = String(input.kind || 'name').toLowerCase();
  if (!(PANTHEON_IDENTIFIER_KINDS as readonly string[]).includes(candidateKind)) {
    throw new Error('invalid_identifier_type');
  }
  const kind = candidateKind as PantheonIdentifierKind;
  const value = normalized(input.value ?? input.legacyName, kind === 'address' ? 240 : 160);
  if (!value) throw new Error('missing_starting_identifier');
  validateIdentifier(kind, value);
  return { kind, value };
}

function hintsFor(kind: PantheonIdentifierKind): string[] {
  return ({
    name: ['identity', 'residence', 'contacts', 'professional-web', 'news'],
    phone: ['contacts', 'identity-resolution', 'associates', 'business'],
    email: ['contacts', 'identity-resolution', 'usernames', 'professional-web', 'breach-notices'],
    username: ['usernames', 'social', 'internet', 'professional-web'],
    address: ['residence', 'property', 'business', 'associates', 'geography'],
    business: ['business', 'corporate', 'professional-web', 'government-contracting'],
    property: ['property', 'tax-public', 'residence', 'business'],
    vin: ['transportation', 'property', 'identity-resolution'],
  } as Record<PantheonIdentifierKind, string[]>)[kind];
}

export function buildPantheonControlledQueryPlan(input: {
  primary: PantheonStartingIdentifier;
  location?: string;
  searchDepth: number;
}): PantheonControlledQueryPlan {
  const location = normalized(input.location, 160);
  const searchTerms = [...new Set([
    input.primary.value,
    location,
    `${input.primary.kind}:${input.primary.value}`,
  ].filter(Boolean))];
  const relationshipHopLimit = Math.max(1, Math.min(3, Math.floor(Number(input.searchDepth) || 1)));
  const planKey = JSON.stringify({ primary: input.primary, location, relationshipHopLimit });
  return {
    schemaVersion: 'pantheon-query-plan-v1',
    planId: createHash('sha256').update(planKey).digest('hex'),
    mode: 'interactive-single-subject',
    primary: { ...input.primary },
    ...(location ? { location } : {}),
    searchTerms,
    categoryHints: hintsFor(input.primary.kind),
    relationshipHopLimit,
    automaticIdentityMerge: false,
  };
}

export function pantheonQuerySubject(plan: PantheonControlledQueryPlan): string {
  return plan.primary.value;
}
