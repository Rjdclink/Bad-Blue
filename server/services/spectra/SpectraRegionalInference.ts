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

function sourceDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.hostname.toLowerCase().replace(/^www\./, '') || null;
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
): CorroboratedRegionalCity | null {
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
  const evidence = new Map<string, { city: string; state: string; domains: Set<string> }>();

  for (const item of sources.slice(0, 200)) {
    const domain = sourceDomain(item.url);
    if (!domain) continue;
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
        if (
          !fullName.test(statement) ||
          !RESIDENCE_LANGUAGE_RE.test(statement) ||
          HISTORICAL_LANGUAGE_RE.test(statement)
        ) continue;
        const region = extractCityStateHint(statement);
        if (!region) continue;
        const key = `${region.city.toLowerCase()}|${region.state}`;
        const existing = evidence.get(key) || {
          city: region.city,
          state: region.state,
          domains: new Set<string>(),
        };
        existing.domains.add(domain);
        evidence.set(key, existing);
      }
    }
  }

  const ranked = [...evidence.values()]
    .sort((a, b) => b.domains.size - a.domains.size);
  const winner = ranked[0];
  if (
    !winner || winner.domains.size < 2 ||
    (ranked[1] && ranked[1].domains.size >= winner.domains.size)
  ) return null;

  return {
    city: winner.city,
    state: winner.state,
    independentSourceCount: winner.domains.size,
    sourceDomains: [...winner.domains].sort(),
    currentPositionVerified: false,
  };
}
