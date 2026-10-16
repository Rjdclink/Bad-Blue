/** City-level clues explicitly declared on retrieved public social profiles.
 * An undated profile label is not a timestamped location or proof of ownership.
 */
import type { ProvisionalRegionalCity, RegionalSourceExcerpt } from './SpectraRegionalInference';

export interface SocialProfileCitySource {
  url: string;
  title?: string;
  textExcerpt?: string;
  structuredRecord?: unknown;
}

type ParsedCity = { city: string; state: string };

function profilePublisher(raw: unknown): { url: string; publisher: string } | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, '');
    const path = url.pathname;
    const reservedPath = /^\/(?:search|login|groups|watch|reels?|videos?|stories|events|marketplace|explore|home|notifications|messages|settings)(?:\/|$)/i.test(path);
    if (reservedPath) return null;
    const facebook = host === 'facebook.com' && (
      /^\/profile\.php$/i.test(path)
      || /^\/people\/[^/]+\/\d+\/?$/i.test(path)
      || /^\/[a-z\d_.-]+(?:\/about)?\/?$/i.test(path)
    );
    const instagram = host === 'instagram.com' && /^\/[a-z\d_.]+\/?$/i.test(path);
    const twitter = (host === 'x.com' || host === 'twitter.com')
      && /^\/[a-z\d_]{1,20}\/?$/i.test(path);
    const tiktok = host === 'tiktok.com' && /^\/@[a-z\d_.]+\/?$/i.test(path);
    const threads = host === 'threads.net' && /^\/@[a-z\d_.]+\/?$/i.test(path);
    const bluesky = host === 'bsky.app' && /^\/profile\/[^/]+\/?$/i.test(path);
    const linkedin = host === 'linkedin.com' && /^\/in\/[^/]+\/?$/i.test(path);
    if (!(facebook || instagram || twitter || tiktok || threads || bluesky || linkedin)) return null;
    return { url: url.href, publisher: host };
  } catch {
    return null;
  }
}

const DECLARED_CITY =
  /\b(?:lives?\s+in|resides?\s+in|based\s+in|current\s+city\s*[:=])\s*([A-Za-z][A-Za-z .'-]{1,55},\s*(?:[A-Z]{2}|[A-Za-z]{4,20}))\b/i;
// Only small amounts of profile navigation can separate the name and its
// own location label. This prevents using another person's city in a feed.
const PROFILE_NAV =
  /^(?:(?:intro|about|details|profile|posts|photos|friends|followers|public|information)\b[\s·•|,:-]*|[\s·•|,:-]+){0,12}/i;

function normalizedName(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

function cityFromFetchedProfile(
  subject: string, text: string,
  parseCity: (value: string) => ParsedCity | null,
): { city: ParsedCity; statement: string } | null {
  const escaped = subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const nameMatch = new RegExp('\\b' + escaped + '\\b', 'i').exec(text);
  if (!nameMatch || nameMatch.index > 1_200) return null;
  const after = text.slice(nameMatch.index + nameMatch[0].length,
    nameMatch.index + nameMatch[0].length + 200).trimStart();
  const navigational = PROFILE_NAV.exec(after)?.[0] || '';
  const claim = DECLARED_CITY.exec(after.slice(navigational.length));
  if (!claim || claim.index !== 0) return null;
  const city = parseCity(claim[1]);
  return city ? { city, statement: (nameMatch[0] + ' ' + claim[0]).slice(0, 180) } : null;
}

/** One profile label is a provisional city, never a verified live device fix. */
export function inferPublicSocialCities(
  subject: string,
  pages: readonly RegionalSourceExcerpt[],
  apiProfiles: readonly SocialProfileCitySource[],
  parseCity: (value: string) => ParsedCity | null,
): ProvisionalRegionalCity[] {
  const name = subject.replace(/\s+/g, ' ').trim();
  if (name.length > 130 || !/^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){1,5}$/u.test(name)) return [];
  const matches = new Map<string, ProvisionalRegionalCity & { publishers: Set<string> }>();
  const add = (source: { url: string; publisher: string }, city: ParsedCity, statement: string) => {
    const key = city.city.toLowerCase() + '|' + city.state.toUpperCase();
    const prior = matches.get(key) || {
      city: city.city, state: city.state.toUpperCase(),
      independentSourceCount: 0, sourceUrls: [], publishedAt: null,
      currentPositionVerified: false as const, supportingClaims: [],
      publishers: new Set<string>(),
    };
    if (prior.publishers.has(source.publisher)) return;
    prior.publishers.add(source.publisher);
    prior.independentSourceCount = prior.publishers.size;
    prior.sourceUrls.push(source.url);
    prior.supportingClaims.push({
      sourceUrl: source.url, statement, publishedAt: null,
      identityStatus: 'name_mention_unverified' as const,
    });
    matches.set(key, prior);
  };

  // Search-result snippets and social posts never count as profile statements.
  for (const page of pages.slice(0, 200)) {
    const actualUrl = page.metadata?.requestedUrl === page.url
      && typeof page.metadata?.sourceUrl === 'string' ? page.metadata.sourceUrl : page.url;
    const source = profilePublisher(actualUrl);
    if (!source || typeof page.metadata?.fetchedExcerpt !== 'string') continue;
    const text = page.metadata.fetchedExcerpt.replace(/\s+/g, ' ').slice(0, 8_000);
    const claim = cityFromFetchedProfile(name, text, parseCity);
    if (claim) add(source, claim.city, claim.statement);
  }

  // API-returned profile descriptions have a directly sourced display name.
  // An exact displayed name without corroborating contact remains unverified.
  for (const profile of apiProfiles.slice(0, 20)) {
    const source = profilePublisher(profile.url);
    if (!source || !/profile/i.test(String(profile.title || ''))) continue;
    const object = profile.structuredRecord;
    if (!object || typeof object !== 'object' || Array.isArray(object)) continue;
    const actor = object as Record<string, unknown>;
    const display = actor.displayName ?? actor.display_name;
    if (typeof display !== 'string' || normalizedName(display) !== normalizedName(name)) continue;
    const description = String(profile.textExcerpt || '').slice(0, 4_000);
    const claim = DECLARED_CITY.exec(description);
    if (!claim || /\b(?:formerly|previously|historically|used to|moved from)\b/i.test(description.slice(Math.max(0, claim.index - 30), claim.index))) continue;
    const city = parseCity(claim[1]);
    if (city) add(source, city, (display + ' ' + claim[0]).slice(0, 180));
  }

  return [...matches.values()]
    .sort((a, b) => b.independentSourceCount - a.independentSourceCount)
    .slice(0, 3)
    .map(({ publishers: _publishers, ...result }) => result);
}
