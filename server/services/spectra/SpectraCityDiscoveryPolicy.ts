/**
 * Public city-evidence discovery is complete only when the public webpages
 * establish a corroborated city, not merely when a crawler found many URLs.
 *
 * This module scores PUBLIC page sources only. It reads no session tokens,
 * account activity or private device records.
 */
import { inferCorroboratedRegionalCity, type RegionalSourceExcerpt } from './SpectraRegionalInference';
import { SPECTRA_DISCOVERY_POLICY } from './SpectraSourceRegistry';

export interface SpectraPublicDiscoverySource extends RegionalSourceExcerpt {
  reliability?: 'high' | 'medium' | 'low';
  relevanceScore?: number;
}

export function publicPublisherDomain(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const labels = parsed.hostname.toLowerCase().replace(/^www\./, '').split('.');
    if (labels.length < 2 || labels.some(label => !label)) return null;
    const tail = labels.slice(-2).join('.');
    const compound = /^(?:co|com|org|net|gov|edu|ac)\.[a-z]{2}$/.test(tail);
    if (compound && labels.length < 3) return null;
    return labels.slice(compound ? -3 : -2).join('.');
  } catch {
    return null;
  }
}

/**
 * Prefer one fetched public page per independent publisher before spending
 * retrieval capacity on multiple pages from the same website.
 */
export function chooseSpectraPublicRetrievalUrls(
  candidates: readonly SpectraPublicDiscoverySource[],
  limit = 8,
): string[] {
  const capacity = Number.isFinite(limit)
    ? Math.max(0, Math.min(16, Math.floor(limit))) : 0;
  if (capacity === 0) return [];
  const ranked = [...candidates]
    .filter(candidate => publicPublisherDomain(candidate.url))
    .sort((left, right) => {
      const priority = (value: SpectraPublicDiscoverySource) =>
        value.reliability === 'high' ? 2 : value.reliability === 'medium' ? 1 : 0;
      return priority(right) - priority(left)
        || (Number.isFinite(right.relevanceScore) ? right.relevanceScore! : 0)
          - (Number.isFinite(left.relevanceScore) ? left.relevanceScore! : 0);
    });
  const urls: string[] = [];
  const seenUrls = new Set<string>();
  const seenPublishers = new Set<string>();
  for (const candidate of ranked) {
    const publisher = publicPublisherDomain(candidate.url);
    if (!publisher || seenPublishers.has(publisher) || seenUrls.has(candidate.url)) continue;
    seenPublishers.add(publisher);
    seenUrls.add(candidate.url);
    urls.push(candidate.url);
    if (urls.length >= capacity) return urls;
  }
  for (const candidate of ranked) {
    if (seenUrls.has(candidate.url)) continue;
    seenUrls.add(candidate.url);
    urls.push(candidate.url);
    if (urls.length >= capacity) break;
  }
  return urls;
}

export interface SpectraCityDiscoveryReadiness {
  publisherCount: number;
  highReliabilityPublisherCount: number;
  evidenceConfidence: number;
  publicCityCorroborated: boolean;
  city?: string;
  state?: string;
  sufficientToStop: boolean;
}

/** Prevent a large set of irrelevant hits from ending a city investigation. */
export function assessSpectraCityDiscoveryReadiness(input: {
  subject: string;
  sources: readonly SpectraPublicDiscoverySource[];
  backgroundConfidence: number;
  asOf?: Date;
}): SpectraCityDiscoveryReadiness {
  const distinct = new Set<string>();
  const highReliability = new Set<string>();
  for (const source of input.sources) {
    const publisher = publicPublisherDomain(source.url);
    if (!publisher) continue;
    distinct.add(publisher);
    if (source.reliability === 'high') highReliability.add(publisher);
  }
  const rawBackground = Number.isFinite(input.backgroundConfidence)
    ? input.backgroundConfidence : 0;
  const evidenceConfidence = Math.min(0.95,
    Math.max(0, rawBackground)
    + Math.min(0.42, distinct.size * 0.055)
    + Math.min(0.18, highReliability.size * 0.03),
  );
  const city = inferCorroboratedRegionalCity(
    input.subject,
    input.sources,
    input.asOf,
  );
  return {
    publisherCount: distinct.size,
    highReliabilityPublisherCount: highReliability.size,
    evidenceConfidence,
    publicCityCorroborated: Boolean(city),
    city: city?.city,
    state: city?.state,
    sufficientToStop: Boolean(city)
      && distinct.size >= SPECTRA_DISCOVERY_POLICY.minIndependentSources
      && evidenceConfidence >= SPECTRA_DISCOVERY_POLICY.sufficientConfidence,
  };
}
