import type { SpectraRetrievedEvidence } from './SpectraPublicRetrieval';

export type SpectraPublicContactMatch = 'email' | 'phone' | null;

function nameTokens(value: string): string[] {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().match(/[a-z]{2,}/g) || [];
}

/** Read the returned profile's own display name before retaining a search lead. */
export function publicProfileNameMatch(
  record: Pick<SpectraRetrievedEvidence, 'structuredRecord'>,
  suppliedName: string,
): boolean {
  const parts = nameTokens(suppliedName);
  if (parts.length < 2 || parts.length > 6) return false;
  const profile = record.structuredRecord;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return false;
  const object = profile as Record<string, unknown>;
  const display = object.displayName ?? object.display_name;
  if (typeof display !== 'string') return false;
  const displayed = nameTokens(display);
  return displayed.includes(parts[0]) && displayed.includes(parts[parts.length - 1]);
}

/** Matches a supplied contact clue only against public profile text. */
export function publicProfileContactMatch(
  record: Pick<SpectraRetrievedEvidence, 'textExcerpt'>,
  clues: { email?: string; phone?: string },
): SpectraPublicContactMatch {
  const text = String(record.textExcerpt || '');
  const email = clues.email?.trim().toLowerCase();
  if (email && email.length >= 6 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const publicEmails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    if (publicEmails.some(value => value.toLowerCase() === email)) return 'email';
  }
  const phone = clues.phone?.replace(/\D/g, '');
  if (phone && phone.length >= 10 && phone.length <= 15) {
    const publicPhones = text.match(/\+?\d[\d\s().-]{8,}\d/g) || [];
    if (publicPhones.some(value => value.replace(/\D/g, '') === phone)) return 'phone';
  }
  return null;
}
