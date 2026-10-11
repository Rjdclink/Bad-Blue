/** City-level hints from fetched public directory and reverse-number pages.
 * A directory's "current" label is an unverified claim, never a live fix.
 */
import { extractCityStateHint } from '../geoconsole/city-state-geocoder';
import type { ProvisionalRegionalCity, RegionalSourceExcerpt } from './SpectraRegionalInference';

function publisherUrl(item: RegionalSourceExcerpt): string | null {
  const final = item.metadata?.requestedUrl === item.url && typeof item.metadata?.sourceUrl === 'string'
    ? item.metadata.sourceUrl : item.url;
  try {
    const url = new URL(final || '');
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

function publicationDate(item: RegionalSourceExcerpt): string | null {
  const raw = item.metadata?.publishedAt ?? item.metadata?.datePublished;
  if (typeof raw !== 'string') return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) && ms <= Date.now() + 86_400_000 ? new Date(ms).toISOString() : null;
}

export function inferPublicDirectoryCities(
  fullName: string,
  sources: readonly RegionalSourceExcerpt[],
  clues: { phone?: string; email?: string } = {},
): ProvisionalRegionalCity[] {
  const name = fullName.trim().replace(/\s+/g, ' ');
  if (name.split(' ').length < 2 || name.split(' ').length > 5) return [];
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const named = new RegExp(`\\b${escaped}\\b`, 'gi');
  const digits = clues.phone?.replace(/\D/g, '') || '';
  const results = new Map<string, ProvisionalRegionalCity & { publishers: Set<string>; contact: boolean }>();
  for (const source of sources.slice(0, 200)) {
    const url = publisherUrl(source);
    const text = source.metadata?.fetchedExcerpt;
    if (!url || typeof text !== 'string' || !text) continue;
    const publishedAt = publicationDate(source);
    if (publishedAt && Date.now() - Date.parse(publishedAt) > 730 * 86_400_000) continue;
    // A page date is evidence age, not proof that the directory updated its underlying record.
    const normalized = text.replace(/\s+/g, ' ').slice(0, 20_000);
    named.lastIndex = 0;
    for (let match: RegExpExecArray | null; (match = named.exec(normalized));) {
      const segment = normalized.slice(match.index + match[0].length, match.index + match[0].length + 240);
      // Stay within this person's entry; do not borrow another person's city.
      const boundary = segment.search(/\b(?:Relatives:|View full report|Sponsored by|Robert [A-Z][a-z]+ Clinkenbeard)\b/i);
      const entry = boundary >= 0 ? segment.slice(0, boundary) : segment;
      const cityClaim = /^\s*,?\s*(?:(?:age\s+\d{1,3}|\d{1,3})\s*,?\s*)?(?:currently\s+)?(?:lives?\s+in\s+|resides?\s+in\s+|located\s+in\s+)?([A-Za-z][A-Za-z .'-]{1,55},\s*(?:[A-Z]{2}|[A-Za-z]{4,20}))\b/i.exec(entry);
      if (!cityClaim) continue;
      if (/\b(?:previously|formerly|historically|used to|last known|lived|resided|moved from)\b/i.test(cityClaim[1])) continue;
      const region = extractCityStateHint(cityClaim[1]);
      if (!region) continue;
      // A phone match anywhere else on a multi-person results page is not a match.
      const contactBlock = entry.slice(0, 150);
      const contact = (digits.length === 10 && contactBlock.replace(/\D/g, '').includes(digits))
        || (Boolean(clues.email) && contactBlock.toLowerCase().includes(clues.email!.toLowerCase()));
      const key = `${region.city.toLowerCase()}|${region.state}`;
      const prior = results.get(key) || {
        city: region.city, state: region.state, sourceUrls: [], publishedAt: null,
        independentSourceCount: 0, supportingClaims: [], currentPositionVerified: false as const,
        publishers: new Set<string>(), contact: false,
      };
      const publisher = new URL(url).hostname.replace(/^www\./, '');
      if (!prior.publishers.has(publisher)) {
        prior.publishers.add(publisher);
        prior.sourceUrls.push(url);
        prior.supportingClaims.push({
          sourceUrl: url,
          statement: `${name}${entry.slice(0, cityClaim[0].length).replace(/\s+/g, ' ')}`.slice(0, 220),
          publishedAt,
          identityStatus: contact ? 'public_contact_match_unverified' : 'name_mention_unverified',
        });
      }
      prior.independentSourceCount = prior.publishers.size;
      prior.contact ||= contact;
      if (publishedAt && (!prior.publishedAt || publishedAt > prior.publishedAt)) prior.publishedAt = publishedAt;
      results.set(key, prior);
    }
  }
  return [...results.values()].sort((a, b) => Number(b.contact) - Number(a.contact)
    || b.independentSourceCount - a.independentSourceCount
    || String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')))
    .slice(0, 3).map(({ publishers: _publishers, contact: _contact, ...city }) => city);
}
