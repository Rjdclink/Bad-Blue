/**
 * Corroborate broad public city references without promoting them into a
 * live position. A name or contact identifier is not location evidence.
 * Two separate source domains must independently associate the same subject
 * with the same city; ambiguous or historical references are not promoted.
 */
import { extractCityStateHint } from '../geoconsole/city-state-geocoder';

export interface RegionalSourceExcerpt {
  url?: string;
  title?: string;
  snippet?: string;
  metadata?: Record<string, unknown>;
}

export interface CorroboratedRegionalCity {
  city: string;
  state: string;
  independentSourceCount: number;
  sourceDomains: string[];
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
  }>();

  for (const item of sources.slice(0, 200)) {
    const domain = sourceDomain(item.url);
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
        if (!/^(?:,\s*)?(?:is\s+)?(?:(?:currently|now)\s+)?(?:lives?|living|resides?|residing|based|located)\s+(?:currently\s+)?(?:in|at)\b/i.test(following)) {
          continue;
        }
        const region = extractCityStateHint(statement);
        if (!region) continue;
        const key = `${region.city.toLowerCase()}|${region.state}`;
        const existing = evidence.get(key) || {
          city: region.city,
          state: region.state,
          domains: new Set<string>(),
          claimsByDomain: new Map<string, Set<string>>(),
        };
        existing.domains.add(domain);
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
    currentPositionVerified: false,
  };
}
