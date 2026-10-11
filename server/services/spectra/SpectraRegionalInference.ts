/**
 * Corroborate broad public city references without promoting them into a
 * live position. A name or contact identifier is not location evidence.
 * Two separate source domains must independently associate the same subject
 * with the same city; ambiguous or historical references are not promoted.
 */
import { extractCityStateHint, stateCodeInPublisherHostname } from '../geoconsole/city-state-geocoder';
import type { SpectraRetrievedEvidence } from './SpectraPublicRetrieval';
import { publicProfileContactMatch, publicProfileNameMatch } from './SpectraPublicProfileIdentity';

export interface RegionalSourceExcerpt {
  url?: string;
  title?: string;
  snippet?: string;
  metadata?: Record<string, unknown>;
}

/** Fetched search pages remain eligible for city extraction even when a
 * search-result deduper discards their lead. Only page text, not the original
 * snippet or retrieval time, becomes a claim. */
export function retrievedRegionalSources(
  records: readonly SpectraRetrievedEvidence[],
): RegionalSourceExcerpt[] {
  return records.filter(record => typeof record.textExcerpt === 'string' && record.textExcerpt.trim())
    .map(record => ({
      url: record.requestedUrl, title: '', snippet: '',
      metadata: {
        requestedUrl: record.requestedUrl,
        sourceUrl: record.url,
        fetchedExcerpt: record.textExcerpt,
        publishedAt: record.publishedAt,
      },
    }));
}

export interface CorroboratedRegionalCity {
  city: string;
  state: string;
  independentSourceCount: number;
  sourceDomains: string[];
  sourceUrls: string[];
  currentPositionVerified: false;
}

/** A tentative, source-backed city when corroboration is still in progress. */
export interface ProvisionalRegionalCity {
  city: string;
  state: string;
  sourceUrls: string[];
  publishedAt: string | null;
  independentSourceCount: number;
  supportingClaims: Array<{
    sourceUrl: string;
    statement: string;
    publishedAt: string | null;
    identityStatus: 'name_mention_unverified' | 'public_contact_match_unverified';
  }>;
  currentPositionVerified: false;
}

const RESIDENCE_LANGUAGE_RE =
  /\b(?:lives?|living|resides?|residing|resident|based|located)\s+(?:currently\s+)?(?:in|at)\b|\b(?:current\s+city|residence\s+city)\s*[:=]/i;
const HISTORICAL_LANGUAGE_RE =
  /\b(?:formerly|previously|historically|used\s+to|last\s+known|prior\s+to|moved\s+from)\b/i;

// A webpage fetched today can contain a years-old residence claim. The
// retrieval time is never a substitute for a publication date.
const DAY_MS = 86_400_000;
const MAX_DATED_SOURCE_AGE_MS = 730 * DAY_MS;

/** A public bio with the same full name and exact supplied contact can offer
 * a tentative city. The profile has no capture date or authenticated owner. */
export function inferPublicContactProfileCities(
  name: string,
  profiles: readonly SpectraRetrievedEvidence[],
  clues: { email?: string; phone?: string },
): ProvisionalRegionalCity[] {
  const cities = new Map<string, ProvisionalRegionalCity>();
  for (const profile of profiles.slice(0, 12)) {
    if (!publicProfileNameMatch(profile, name) || !publicProfileContactMatch(profile, clues)) continue;
    const bio = String(profile.textExcerpt || '').slice(0, 4_000);
    for (const statement of bio.split(/[\n;!?]|\.(?=\s)/).slice(0, 30)) {
      const mention = /\b(?:based|living|residing|lives?)\s+(?:currently\s+)?(?:in|at)\s+([A-Za-z][A-Za-z .'-]{1,60},\s*[A-Z]{2})\b/gi.exec(statement);
      if (!mention || /\b(?:formerly|previously|historically|used to|moved from)\b/i.test(statement)) continue;
      const region = extractCityStateHint(mention[1]);
      if (!region) continue;
      const key = `${region.city.toLowerCase()}|${region.state}`;
      const claim = {
        sourceUrl: profile.url,
        statement: mention[0].replace(/\s+/g, ' ').trim(),
        publishedAt: null,
        identityStatus: 'public_contact_match_unverified' as const,
      };
      const existing = cities.get(key);
      if (existing) {
        if (!existing.sourceUrls.includes(profile.url)) {
          existing.sourceUrls.push(profile.url);
          existing.supportingClaims.push(claim);
        }
      } else cities.set(key, {
        city: region.city, state: region.state, sourceUrls: [profile.url],
        publishedAt: null, independentSourceCount: 1,
        supportingClaims: [claim], currentPositionVerified: false,
      });
      break;
    }
  }
  return [...cities.values()].slice(0, 3);
}

function hasUsablePublicationDate(
  item: RegionalSourceExcerpt,
  asOfMs: number,
): boolean {
  const reported = item.metadata?.publishedAt
    ?? item.metadata?.datePublished
    ?? item.metadata?.publicationDate;
  if (reported === undefined || reported === null) return true;
  if (typeof reported !== 'string' || !reported.trim()) return false;
  const publishedMs = Date.parse(reported);
  if (!Number.isFinite(publishedMs)) return false;
  const age = asOfMs - publishedMs;
  return age >= -DAY_MS && age <= MAX_DATED_SOURCE_AGE_MS;
}

function normalizedClaim(statement: string): string {
  return statement.toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:]+$/g, '')
    .trim();
}

function sourceDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const labels = url.hostname.toLowerCase().replace(/^www\./, '').split('.');
    if (labels.length < 2) return null;
    // Treat sister subdomains as one publisher, not independent evidence.
    // Be conservative for common country-code second-level domains.
    const lastTwo = labels.slice(-2).join('.');
    const multiPartSuffix = /^(?:co|com|net|org|ac|gov|edu)\.[a-z]{2}$/.test(lastTwo);
    return labels.slice(multiPartSuffix ? -3 : -2).join('.');
  } catch {
    return null;
  }
}

function sourceText(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 3_000) : '';
}

/** Local reporting sometimes identifies a person across adjacent sentences:
 * "A 45-year-old Hartley man was arrested. The arrest of Jane Doe ...".
 * Require the exact name in the immediate follow-up and a publisher that
 * explicitly names its state; a loose city headline alone is insufficient. */
function localNewsResidentClaim(
  text: string, fullName: RegExp, publisherUrl: string,
): { city: string; state: string; statement: string } | null {
  let hostname: string;
  try { hostname = new URL(publisherUrl).hostname; } catch { return null; }
  const state = stateCodeInPublisherHostname(hostname);
  if (!state) return null;
  const lead = /\b(?:a|an)\s+\d{1,3}-year-old\s+([A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){0,2})\s+(?:man|woman|resident)\s+(?:was|is)\s+(?:arrested|charged|jailed)\b/gi;
  for (const match of text.slice(0, 1_500).matchAll(lead)) {
    const following = text.slice(match.index! + match[0].length, match.index! + match[0].length + 450);
    const identity = [...following.matchAll(/\b(?:the\s+)?(?:arrest|jailing|charges?)\s+of\s+/gi)]
      .find(anchor => fullName.exec(following.slice(anchor.index! + anchor[0].length,
        anchor.index! + anchor[0].length + 140))?.index === 0);
    if (!identity) continue;
    const region = extractCityStateHint(`${match[1]}, ${state}`);
    if (!region) continue;
    return {
      city: region.city, state: region.state,
      statement: `${match[0]}; ${following.slice(identity.index, identity.index + identity[0].length + 100).split(/[.!?]/)[0]}`.replace(/\s+/g, ' ').trim().slice(0, 500),
    };
  }
  return null;
}

/**
 * A single retrieved document can support a labeled best guess. Search titles,
 * snippets and retrieval dates do not qualify. This is deliberately separate
 * from the corroborated-city rule and cannot create a live observation.
 */
export function inferProvisionalRegionalCities(
  subject: string,
  sources: readonly RegionalSourceExcerpt[],
  asOf: Date = new Date(),
): ProvisionalRegionalCity[] {
  const name = subject.replace(/\s+/g, ' ').trim();
  const tokens = name.split(' ').filter(Boolean);
  if (!Number.isFinite(asOf.getTime()) || tokens.length < 2 || tokens.length > 5
    || tokens.some(token => !/^[\p{L}][\p{L}'’.-]*$/u.test(token))) return [];
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const fullName = new RegExp(`\\b${escaped}\\b`, 'i');
  const matches = new Map<string, ProvisionalRegionalCity & { publishers: Set<string> }>();

  for (const item of sources.slice(0, 200)) {
    const text = sourceText(item.metadata?.fetchedExcerpt);
    const sourceUrl = item.metadata?.requestedUrl === item.url
      && typeof item.metadata?.sourceUrl === 'string' ? item.metadata.sourceUrl : item.url;
    const publisher = sourceDomain(sourceUrl);
    if (!publisher || !text || !hasUsablePublicationDate(item, asOf.getTime())) continue;
    const rawDate = item.metadata?.publishedAt;
    const publishedAt = typeof rawDate === 'string' && Number.isFinite(Date.parse(rawDate))
      ? new Date(rawDate).toISOString() : null;
    const newsClaim = publishedAt && typeof sourceUrl === 'string'
      ? localNewsResidentClaim(text, fullName, sourceUrl) : null;
    if (newsClaim) {
      const key = `${newsClaim.city.toLowerCase()}|${newsClaim.state}`;
      const prior: ProvisionalRegionalCity & { publishers: Set<string> } = matches.get(key) || {
        city: newsClaim.city, state: newsClaim.state, sourceUrls: [], publishedAt: null,
        independentSourceCount: 0, currentPositionVerified: false as const,
        supportingClaims: [], publishers: new Set<string>(),
      };
      if (!prior.publishers.has(publisher)) {
        prior.publishers.add(publisher);
        prior.sourceUrls.push(sourceUrl!);
        prior.independentSourceCount = prior.publishers.size;
        prior.supportingClaims.push({
          sourceUrl: sourceUrl!, statement: newsClaim.statement,
          publishedAt, identityStatus: 'name_mention_unverified',
        });
      }
      if (!prior.publishedAt || publishedAt > prior.publishedAt) prior.publishedAt = publishedAt;
      matches.set(key, prior);
    }
    for (const statement of text.split(/[\n;!?]|\.(?=\s)/).slice(0, 60)) {
      const named = fullName.exec(statement);
      if (!named || HISTORICAL_LANGUAGE_RE.test(statement)) continue;
      const following = statement.slice(named.index + named[0].length).trimStart();
      const residence = /^(?:,\s*)?(?:is\s+)?(?:(?:currently|now)\s+)?(?:lives?|living|resides?|residing|based|located)\s+(?:currently\s+)?(?:in|at)\s+(.+)$/i.exec(following);
      if (!residence) continue;
      const clause = residence[1].split(/,\s*(?:who|whose|which|but|while|whereas)\b|\s+(?:and|but|while|whereas)\s+(?:works?|commutes?|studies|visits?|travels?|stays?)\b/i)[0].trim();
      if (/^(?:the\s+)?(?:suburbs?\s+of|outskirts\s+of|greater\s+|metro(?:politan)?\s+|near\s+|outside\s+|around\s+)/i.test(clause)) continue;
      const region = extractCityStateHint(clause);
      if (!region) continue;
      const key = `${region.city.toLowerCase()}|${region.state}`;
      const prior: ProvisionalRegionalCity & { publishers: Set<string> } = matches.get(key) || {
        city: region.city, state: region.state, sourceUrls: [], publishedAt: null,
        independentSourceCount: 0, currentPositionVerified: false as const,
        supportingClaims: [],
        publishers: new Set<string>(),
      };
      if (!prior.publishers.has(publisher)) {
        prior.publishers.add(publisher);
        prior.sourceUrls.push(sourceUrl!);
        prior.independentSourceCount = prior.publishers.size;
        prior.supportingClaims.push({
          sourceUrl: sourceUrl!, statement: statement.replace(/\s+/g, ' ').trim().slice(0, 500),
          publishedAt, identityStatus: 'name_mention_unverified',
        });
      }
      if (publishedAt && (!prior.publishedAt || publishedAt > prior.publishedAt)) prior.publishedAt = publishedAt;
      matches.set(key, prior);
    }
  }
  return [...matches.values()]
    .sort((a, b) => b.independentSourceCount - a.independentSourceCount
      || Number(Boolean(b.publishedAt)) - Number(Boolean(a.publishedAt))
      || String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')))
    .slice(0, 3).map(({ publishers: _publishers, ...result }) => result);
}

export function inferCorroboratedRegionalCity(
  subject: string,
  sources: readonly RegionalSourceExcerpt[],
  asOf: Date = new Date(),
): CorroboratedRegionalCity | null {
  if (!Number.isFinite(asOf.getTime())) return null;
  const name = subject.replace(/\s+/g, ' ').trim();
  const nameTokens = name.split(' ').filter(Boolean);
  // General labels, one-word aliases and numbers are insufficient to
  // distinguish identities from similarly named people or places.
  if (
    nameTokens.length < 2 || nameTokens.length > 5 ||
    nameTokens.some(token => !/^[\p{L}][\p{L}'’.-]*$/u.test(token))
  ) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const fullName = new RegExp(`\\b${escaped}\\b`, 'i');
  const evidence = new Map<string, {
    city: string;
    state: string;
    domains: Set<string>;
    claimsByDomain: Map<string, Set<string>>;
    urlsByDomain: Map<string, string>;
  }>();

  for (const item of sources.slice(0, 200)) {
    // If a public retrieval followed a redirect, count the actual publisher,
    // not multiple discovery URLs that all lead to the same final webpage.
    // Only trust the retrieved final URL when it is bound to the original URL.
    const urlForPublisher = item.metadata?.requestedUrl === item.url
      && typeof item.metadata?.sourceUrl === 'string'
      ? item.metadata.sourceUrl : item.url;
    const domain = sourceDomain(urlForPublisher);
    if (!domain || !hasUsablePublicationDate(item, asOf.getTime())) continue;
    const excerpts = [
      sourceText(item.title),
      sourceText(item.snippet),
      sourceText(item.metadata?.fetchedExcerpt),
      sourceText(item.metadata?.fetchedOrCitedText),
    ].filter(Boolean);

    for (const excerpt of excerpts) {
      // Match subject and city in the same statement, not somewhere else
      // on a general page containing other people or locations.
      const statements = excerpt.split(/[\n;!?]|\.(?=\s)/).slice(0, 60);
      for (const statement of statements) {
        const matchedSubject = fullName.exec(statement);
        if (
          !matchedSubject ||
          !RESIDENCE_LANGUAGE_RE.test(statement) ||
          HISTORICAL_LANGUAGE_RE.test(statement)
        ) continue;
        // The residence clause must describe the named subject, rather than
        // someone else mentioned later in the same sentence.
        const following = statement.slice(
          matchedSubject.index + matchedSubject[0].length,
        ).trimStart();
        const residence = /^(?:,\s*)?(?:is\s+)?(?:(?:currently|now)\s+)?(?:lives?|living|resides?|residing|based|located)\s+(?:currently\s+)?(?:in|at)\s+(.+)$/i.exec(following);
        if (!residence) continue;
        // Only the immediate residence clause may establish a city. Parsing
        // the full sentence can silently borrow a city from an employer,
        // companion, interviewee, or even a location preceding the subject.
        const residenceClause = residence[1].split(
          /,\s*(?:who|whose|which|but|while|whereas)\b|\s+(?:and|but|while|whereas)\s+(?:(?:currently|now)\s+)?(?:works?|commutes?|studies|visits?|travels?|stays?|lives?|resides?|is\s+based)\b|\s+(?:with|alongside)\s+(?:(?:their|his|her|a|the)\s+)?(?:friend|colleague|partner|sibling|family|coworker|associate)\b/i,
        )[0].trim();
        // A nearby city or metropolitan area is not the named person's city.
        if (
          !residenceClause
          || /^(?:the\s+)?(?:suburbs?\s+of|outskirts\s+of|greater\s+|metro(?:politan)?\s+|near\s+|outside\s+|around\s+|vicinity\s+of)/i.test(residenceClause)
        ) continue;
        const region = extractCityStateHint(residenceClause);
        if (!region) continue;
        const key = `${region.city.toLowerCase()}|${region.state}`;
        const existing = evidence.get(key) || {
          city: region.city,
          state: region.state,
          domains: new Set<string>(),
          claimsByDomain: new Map<string, Set<string>>(),
          urlsByDomain: new Map<string, string>(),
        };
        existing.domains.add(domain);
        if (typeof urlForPublisher === 'string') existing.urlsByDomain.set(domain, urlForPublisher);
        const claims = existing.claimsByDomain.get(domain) || new Set<string>();
        claims.add(normalizedClaim(statement));
        existing.claimsByDomain.set(domain, claims);
        evidence.set(key, existing);
      }
    }
  }

  const ranked = [...evidence.values()]
    .sort((a, b) => b.domains.size - a.domains.size);
  const winner = ranked[0];
  // Even one independently sourced contradictory city is a reason to
  // abstain: choosing the plurality can turn a stale biography into a
  // confident-looking but wrong present-day association.
  if (!winner || winner.domains.size < 2 || ranked.length !== 1) return null;

  // Copies of the same wording on separate domains are not independent
  // evidence. Count only publishers contributing a distinct statement.
  const uniqueClaims = new Set<string>();
  const independentDomains: string[] = [];
  for (const [domain, claims] of [...winner.claimsByDomain].sort(
    ([first], [second]) => first.localeCompare(second),
  )) {
    const newClaim = [...claims].sort().find(claim => !uniqueClaims.has(claim));
    if (!newClaim) continue;
    uniqueClaims.add(newClaim);
    independentDomains.push(domain);
  }
  if (independentDomains.length < 2) return null;

  return {
    city: winner.city,
    state: winner.state,
    independentSourceCount: independentDomains.length,
    sourceDomains: independentDomains,
    sourceUrls: independentDomains.flatMap(domain => winner.urlsByDomain.get(domain) || []),
    currentPositionVerified: false,
  };
}
