export type SpectraSourcePriority = 'critical' | 'high' | 'supporting';

export type SpectraClueKind =
  | 'identity'
  | 'phone'
  | 'email'
  | 'address'
  | 'location'
  | 'employment'
  | 'social'
  | 'property'
  | 'vehicle'
  | 'associate'
  | 'media'
  | 'general';

export interface SpectraSourceTarget {
  sourceId: string;
  sourceName: string;
  priority: SpectraSourcePriority;
  reason: string;
  query: string;
  clueKinds: SpectraClueKind[];
}

export interface SpectraDiscoveryPolicy {
  maxPasses: number;
  maxQueries: number;
  maxCandidates: number;
  minIndependentSources: number;
  sufficientConfidence: number;
  diminishingReturnFloor: number;
}

export const SPECTRA_DISCOVERY_POLICY: SpectraDiscoveryPolicy = {
  maxPasses: 8,
  maxQueries: 48,
  maxCandidates: 160,
  minIndependentSources: 6,
  sufficientConfidence: 0.78,
  diminishingReturnFloor: 0.12,
};

function safeText(value: string): string {
  return value
    .replace(/[\uD800-\uDFFF]/g, '\uFFFD')
    .replace(/\s+/g, ' ')
    .trim();
}

function quoted(value: string): string {
  const text = safeText(value);
  return text ? `"${text.replace(/"/g, '')}"` : '';
}

function clueKindsFromText(value: string): SpectraClueKind[] {
  const text = safeText(value);
  const kinds = new Set<SpectraClueKind>();
  if (/\b(?:\+?\d[\d\s().-]{6,}\d)\b/.test(text)) kinds.add('phone');
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)) kinds.add('email');
  if (/\b\d{1,7}[A-Za-z]?(?:[-/]\d{1,7}[A-Za-z]?)?\s+[A-Za-z0-9][A-Za-z0-9 .’'-]{1,70}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|highway|hwy|way|place|pl)\b/i.test(text)) kinds.add('address');
  if (/\b(?:in|from|near|around|located|last known|city|state|county|zip|postal)\b/i.test(text)) kinds.add('location');
  if (/\b(?:employer|employed|employment|works?|worked|job|occupation|staff|company)\b/i.test(text)) kinds.add('employment');
  if (/\b(?:instagram|facebook|linkedin|tiktok|twitter|x\.com|username|handle|profile|social)\b/i.test(text)) kinds.add('social');
  if (/\b(?:property|parcel|deed|assessor|mortgage|house|home|land|owner)\b/i.test(text)) kinds.add('property');
  if (/\b(?:vehicle|car|truck|motorcycle|vin|plate|registration)\b/i.test(text)) kinds.add('vehicle');
  if (/\b(?:relative|associate|spouse|parent|sibling|roommate|household)\b/i.test(text)) kinds.add('associate');
  if (/\b(?:photo|image|video|exif|xmp|metadata)\b/i.test(text)) kinds.add('media');
  if (kinds.size === 0) kinds.add('general');
  return [...kinds];
}

function target(
  sourceId: string,
  sourceName: string,
  priority: SpectraSourcePriority,
  reason: string,
  query: string,
  clueKinds: SpectraClueKind[],
): SpectraSourceTarget | null {
  const normalized = safeText(query);
  if (!normalized) return null;
  return { sourceId, sourceName, priority, reason, query: normalized, clueKinds };
}

export function buildSpectraPriorityTargets(
  subject: string,
  clues?: string,
  limit = SPECTRA_DISCOVERY_POLICY.maxQueries,
): SpectraSourceTarget[] {
  const cleanSubject = safeText(subject);
  const cleanClues = safeText(String(clues || ''));
  const identity = quoted(cleanSubject);
  const clueKinds = clueKindsFromText(cleanClues);
  const candidates: Array<SpectraSourceTarget | null> = [
    target(
      'identity-location',
      'identity and location discovery',
      'critical',
      'resolve the subject and current or recent location evidence',
      [identity, cleanClues, 'location address residence'].filter(Boolean).join(' '),
      ['identity', ...clueKinds],
    ),
    target(
      'historical-location',
      'historical location discovery',
      'critical',
      'find dated addresses, filings, records, and prior locations',
      [identity, cleanClues, 'historical address location dated record'].filter(Boolean).join(' '),
      ['identity', 'address', 'location'],
    ),
    clueKinds.includes('phone')
      ? target('phone-correlation', 'phone correlation', 'critical', 'use the supplied phone clue to resolve matching records and locations', [identity, cleanClues, 'phone address location'].filter(Boolean).join(' '), ['identity', 'phone', 'address', 'location'])
      : null,
    clueKinds.includes('email')
      ? target('email-correlation', 'email correlation', 'critical', 'use the supplied email clue to resolve matching profiles and locations', [identity, cleanClues, 'email profile address location'].filter(Boolean).join(' '), ['identity', 'email', 'social', 'location'])
      : null,
    clueKinds.includes('employment')
      ? target('employment-location', 'employment location', 'high', 'connect employer and workplace clues to physical locations', [identity, cleanClues, 'employer workplace staff address'].filter(Boolean).join(' '), ['identity', 'employment', 'address', 'location'])
      : null,
    clueKinds.includes('social')
      ? target('social-location', 'social location', 'high', 'find profile, place, check-in, geotag, and dated location references', [identity, cleanClues, 'profile place geotag check-in location'].filter(Boolean).join(' '), ['identity', 'social', 'location'])
      : null,
    clueKinds.includes('property')
      ? target('property-location', 'property location', 'high', 'connect property and parcel clues to recorded locations', [identity, cleanClues, 'property assessor parcel deed address'].filter(Boolean).join(' '), ['identity', 'property', 'address', 'location'])
      : null,
    clueKinds.includes('vehicle')
      ? target('vehicle-location', 'vehicle location context', 'high', 'connect vehicle clues to location-bearing records or context', [identity, cleanClues, 'vehicle VIN registration address'].filter(Boolean).join(' '), ['identity', 'vehicle', 'address', 'location'])
      : null,
    clueKinds.includes('associate')
      ? target('associate-corroboration', 'associate corroboration', 'high', 'use relationship clues only to corroborate subject identity and location', [identity, cleanClues, 'associate household address corroboration'].filter(Boolean).join(' '), ['identity', 'associate', 'address', 'location'])
      : null,
    clueKinds.includes('media')
      ? target('media-location', 'media location evidence', 'high', 'find target-related media with location or capture-time evidence', [identity, cleanClues, 'photo video EXIF location timestamp'].filter(Boolean).join(' '), ['identity', 'media', 'location'])
      : null,
    target(
      'corroboration',
      'independent corroboration',
      'supporting',
      'find an independent source family that confirms or contradicts the strongest clues',
      [identity, cleanClues, 'corroborate location address identity'].filter(Boolean).join(' '),
      ['identity', ...clueKinds],
    ),
    target(
      'alternate-records',
      'alternate records',
      'supporting',
      'broaden to alternate records when primary clues remain unresolved',
      [identity, cleanClues, 'record filing directory archive location'].filter(Boolean).join(' '),
      ['identity', ...clueKinds],
    ),
  ];

  const seen = new Set<string>();
  return candidates
    .filter((item): item is SpectraSourceTarget => Boolean(item))
    .filter(item => {
      const key = item.query.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(1, limit));
}

export function buildSpectraDiscoveryWaves(subject: string, clues?: string) {
  const targets = buildSpectraPriorityTargets(subject, clues);
  return (['critical', 'high', 'supporting'] as SpectraSourcePriority[])
    .map(priority => ({
      priority,
      targets: targets.filter(targetItem => targetItem.priority === priority),
    }))
    .filter(wave => wave.targets.length > 0);
}

export function buildSpectraAdaptiveQuery(
  subject: string,
  clues: string,
  pass: number,
  unresolved: readonly string[] = [],
): string {
  const identity = quoted(subject);
  const cleanClues = safeText(clues);
  const unresolvedText = unresolved.map(safeText).filter(Boolean).slice(0, 4).join(' ');
  const expansion = [
    'current recent location address',
    'historical address employment property',
    'profile geotag check-in dated location',
    'record filing directory archive',
    'independent corroboration contradiction',
    'alternate spelling alias associate location',
    'recent news image video location',
    'additional independent source location',
  ][Math.max(0, Math.min(7, pass))];

  return [identity, cleanClues, unresolvedText, expansion]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
