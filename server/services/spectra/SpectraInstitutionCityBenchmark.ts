/**
 * Public institutional venue-city field benchmark.
 *
 * Measures whether SPECTRA's public fetcher can extract a supported
 * municipal address from two independent public descriptions of a venue.
 * No individual- or device-location inference is involved.
 */
import type { SpectraRetrievedEvidence } from './SpectraPublicRetrieval';
import { publicPublisherDomain } from './SpectraCityDiscoveryPolicy';

export interface InstitutionFieldCase {
  id: 'boston-central-library' | 'wisconsin-historical-society' | 'seattle-central-library';
  label: string;
  nameClues: readonly string[];
  streetClues: readonly string[];
  expectedCity: string;
  expectedState: string;
  sourceUrls: readonly [string, string];
}

export const INSTITUTION_FIELD_CASES: readonly InstitutionFieldCase[] = [
  {
    id: 'boston-central-library',
    label: 'Boston Public Library — Central Library',
    nameClues: ['Central Library in Copley Square', 'Boston Public Library', 'Central Library'],
    streetClues: ['700 Boylston'],
    expectedCity: 'Boston',
    expectedState: 'MA',
    sourceUrls: [
      'https://www.bpl.org/locations/central/',
      'https://content.boston.gov/departments/boston-public-library',
    ],
  },
  {
    id: 'wisconsin-historical-society',
    label: 'Wisconsin Historical Society Headquarters',
    nameClues: ['Wisconsin Historical Society'],
    streetClues: ['816 State'],
    expectedCity: 'Madison',
    expectedState: 'WI',
    sourceUrls: [
      'https://legacy.wisconsinhistory.org/',
      'https://www.visitmadison.com/listings/wisconsin-historical-society/181825/',
    ],
  },
  {
    id: 'seattle-central-library',
    label: 'Seattle Public Library — Central Library',
    nameClues: ['Central Library', 'Seattle Public Library', 'Seattle Central Library'],
    streetClues: ['1000 Fourth', '1000 4th'],
    expectedCity: 'Seattle',
    expectedState: 'WA',
    sourceUrls: [
      'https://www.spl.org/hours-and-locations/central-library',
      'https://www.visitseattle.org/things-to-do/sightseeing/modern-wonders/',
    ],
  },
] as const;

export interface InstitutionFieldSourceResult {
  requestedUrl: string;
  finalUrl?: string;
  publisher?: string;
  retrievedAt?: string;
  publishedAt?: string;
  publicationStatus: 'dated' | 'undated';
  postalCity?: string;
  postalState?: string;
  status: 'supported' | 'unavailable' | 'name_unmatched' | 'street_unmatched'
    | 'city_unmatched' | 'conflicted';
}

export interface InstitutionFieldCaseResult {
  id: InstitutionFieldCase['id'];
  expectedCity: string;
  expectedState: string;
  prediction?: { city: string; state: string };
  outcome: 'correct' | 'wrong_city' | 'abstained';
  reason: string;
  sources: InstitutionFieldSourceResult[];
}

function escaped(value: string): string {
  return value.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&');
}

function getCityNearPostalStreet(text: string, street: string): Array<{ city: string; state: string }> {
  const addresses: Array<{ city: string; state: string }> = [];
  const streetExpression = new RegExp('\\b' + escaped(street).replace(/\\s+/g, '\\s+') + '\\b', 'gi');
  let streetMatch: RegExpExecArray | null;
  let scanned = 0;
  while ((streetMatch = streetExpression.exec(text)) && scanned++ < 12) {
    const tail = text.slice(streetMatch.index + streetMatch[0].length, streetMatch.index + streetMatch[0].length + 110);
    const normalized = tail
      .replace(/^\s*(?:Street|St|Avenue|Ave|Road|Rd)\.?(?=\s|,|$)/i, '')
      .replace(/^\s*[,.;]?\s*/, '');
    const postal = /^([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2})\s*,\s*([A-Za-z]{2})\b/i.exec(normalized);
    if (!postal) continue;
    const city = postal[1].trim().replace(/\s+/g, ' ');
    const state = postal[2].toUpperCase();
    if (city.length >= 2 && city.length <= 60) addresses.push({ city, state });
  }
  return addresses;
}

export function evaluateInstitutionFieldSource(
  field: InstitutionFieldCase,
  requestedUrl: string,
  evidence?: SpectraRetrievedEvidence,
): InstitutionFieldSourceResult {
  const base: InstitutionFieldSourceResult = {
    requestedUrl,
    finalUrl: evidence?.url,
    publisher: publicPublisherDomain(evidence?.url),
    retrievedAt: evidence?.retrievedAt,
    publishedAt: evidence?.publishedAt,
    publicationStatus: evidence?.publishedAt ? 'dated' : 'undated',
    status: 'unavailable',
  };
  if (!evidence || !evidence.textExcerpt) return base;
  const text = [evidence.title, evidence.textExcerpt].filter(Boolean).join(' ').replace(/\s+/g, ' ');
  if (!field.nameClues.some(name => text.toLowerCase().includes(name.toLowerCase()))) {
    return { ...base, status: 'name_unmatched' };
  }
  const locations = field.streetClues.flatMap(street => getCityNearPostalStreet(text, street));
  const uniqueCities = new Map(locations.map(place => [place.city.toLowerCase() + '|' + place.state, place]));
  if (uniqueCities.size > 1) return { ...base, status: 'conflicted' };
  const city = uniqueCities.values().next().value;
  if (city) return { ...base, status: 'supported', postalCity: city.city, postalState: city.state };
  const mentionsStreet = field.streetClues.some(street => text.toLowerCase().includes(street.toLowerCase()));
  return { ...base, status: mentionsStreet ? 'city_unmatched' : 'street_unmatched' };
}

export function evaluateInstitutionFieldCase(
  field: InstitutionFieldCase,
  evidence: readonly SpectraRetrievedEvidence[],
): InstitutionFieldCaseResult {
  const sources = field.sourceUrls.map(url =>
    evaluateInstitutionFieldSource(field, url, evidence.find(item => item.requestedUrl === url))
  );
  const defaultResult: InstitutionFieldCaseResult = {
    id: field.id,
    expectedCity: field.expectedCity,
    expectedState: field.expectedState,
    outcome: 'abstained',
    reason: 'Both independent public pages must contain the institution name, matching street address, city and state.',
    sources,
  };
  if (sources.some(item => item.status !== 'supported')) return defaultResult;
  if (!sources[0].publisher || sources[0].publisher === sources[1].publisher) {
    return { ...defaultResult, reason: 'Sources are not independent publishers.' };
  }
  if (sources[0].postalCity?.toLowerCase() !== sources[1].postalCity?.toLowerCase()
    || sources[0].postalState !== sources[1].postalState) {
    return { ...defaultResult, reason: 'Two public sources disagree on the institutional city.' };
  }
  const prediction = { city: sources[0].postalCity!, state: sources[0].postalState! };
  const correct = prediction.city.toLowerCase() === field.expectedCity.toLowerCase()
    && prediction.state === field.expectedState;
  return {
    ...defaultResult,
    prediction,
    outcome: correct ? 'correct' : 'wrong_city',
    reason: correct ? 'Two independent public sources support the verified institutional address.'
      : 'Two sources agree on a city that contradicts the independent address ground truth.',
  };
}
