import type { SpectraRetrievedEvidence } from './SpectraPublicRetrieval';
import { createSpectraRetrievalDiagnostics, type SpectraRetrievalDiagnostic } from './SpectraRetrievalDiagnostics';

const states = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));
const tokens = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) || [];

export function isPublicPlaceTarget(target: string): boolean {
  return target.length <= 200 && !/[@\d]/.test(target)
    && /\b(museum|library|aquarium|zoo|botanical garden|national park|state park|airport|stadium|city hall)\b/i.test(target)
    && tokens(target).length >= 3;
}

export function assessPublicPlacePage(target: string, page: SpectraRetrievedEvidence) {
  const titleWords = new Set(tokens(page.title || ''));
  const nameWords = tokens(target).filter(word => !['the', 'of', 'and', 'in'].includes(word));
  if (!nameWords.every(word => titleWords.has(word))) return { status: 'name-unmatched' as const };
  const cities = new Map<string, { city: string; state: string }>();
  for (const block of page.addressBlocks || []) {
    // Require an address block, a street, and a postal city on its own line.
    // Prose, search snippets and footer addresses are never address evidence.
    if (!/\b(?:street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|boulevard|blvd\.?|way|lane|ln\.?)\b/i.test(block)) continue;
    for (const line of block.split('\n')) {
      const match = /^([A-Za-z][A-Za-z .'-]{1,60}),?\s+([A-Z]\.?[A-Z]\.?)\s+\d{5}(?:-\d{4})?$/.exec(line.trim());
      if (!match) continue;
      const city = match[1].replace(/,$/, '').trim();
      const state = match[2].replace(/\./g, '');
      if (states.has(state)) cities.set(`${city.toLowerCase()}|${state}`, { city, state });
    }
  }
  if (cities.size !== 1) return { status: cities.size ? 'conflicting-addresses' as const : 'no-supported-address' as const };
  return { status: 'supported' as const, ...[...cities.values()][0] };
}

interface PlaceDependencies {
  discover: (query: string, signal: AbortSignal) => Promise<Array<{ url: string }>>;
  retrieve: (urls: string[], signal: AbortSignal, onDiagnostic?: (row: SpectraRetrievalDiagnostic) => void) => Promise<SpectraRetrievedEvidence[]>;
  geocode: (city: string) => Promise<{ latitude: number; longitude: number; accuracyMeters: number } | null>;
}

async function bounded<T>(work: (signal: AbortSignal) => Promise<T>, ms: number, fallback: T): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      work(controller.signal).catch(() => fallback),
      new Promise<T>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(fallback); }, ms); }),
    ]);
  } finally { clearTimeout(timer!); controller.abort(); }
}

export async function acquirePublicPlace(target: string, details: string, deps: PlaceDependencies) {
  if (!isPublicPlaceTarget(target)) throw new Error('Public-place mode requires the name of a museum, library, park, or other supported public venue.');
  const suppliedUrls = (details.match(/https?:\/\/[^\s<>"']+/g) || []).slice(0, 3);
  // One focused search, with an independent retrieval budget. Supplied public
  // source links are read first; they are evidence leads, not trusted facts.
  const discovered = await bounded(signal => deps.discover(`"${target}" visitor address location`, signal), 10_000, []);
  const urls = [...new Set([...suppliedUrls, ...discovered.map(item => item.url)])].slice(0, 8);
  const retrievalDiagnostics = createSpectraRetrievalDiagnostics(urls.length);
  const pages = await bounded(signal => deps.retrieve(urls, signal, retrievalDiagnostics.record), 5_000, []);
  const retrieval = retrievalDiagnostics.finish();
  const sources = pages.map(page => ({
    url: page.url, title: page.title || page.url, retrievedAt: page.retrievedAt,
    publishedAt: page.publishedAt, ...assessPublicPlacePage(target, page),
  }));
  const supported = sources.filter(source => source.status === 'supported');
  const rejectionReasons: Record<string, number> = {};
  for (const source of sources) {
    if (source.status !== 'supported') rejectionReasons[source.status] = (rejectionReasons[source.status] || 0) + 1;
  }
  const distinctRetrievedUrls = new Set(pages.map(page => page.url)).size;
  const cities = new Set(supported.map(source => `${source.city!.toLowerCase()}|${source.state}`));
  const conflict = cities.size > 1 || sources.some(source => source.status === 'conflicting-addresses');
  const first = !conflict && cities.size === 1 ? supported[0] : undefined;
  const region = first ? await bounded(() => deps.geocode(`${first.city}, ${first.state}`), 8_000, null) : null;
  const valid = region && Number.isFinite(region.latitude) && Math.abs(region.latitude) <= 90
    && Number.isFinite(region.longitude) && Math.abs(region.longitude) <= 180
    && Number.isFinite(region.accuracyMeters) && region.accuracyMeters > 0;
  const candidates = valid && first ? [{
    latitude: region.latitude, longitude: region.longitude,
    label: `${first.city}, ${first.state} (source-reported public venue city; city-level map)`,
    confidence: 0, basis: 'regional_context' as const,
    accuracyMeters: Math.max(1_000, region.accuracyMeters),
  }] : [];
  const outcome = conflict ? 'conflicting-addresses' : !first ? 'no-supported-address'
    : !valid ? 'geocoding-unavailable' : 'public-place-city';
  return { candidates, sources, diagnostics: {
    selected: urls.length, retrieved: pages.length, supported: supported.length, outcome,
    retrieval, rejectionReasons, distinctRetrievedUrls,
    duplicateRetrievedUrls: pages.length - distinctRetrievedUrls,
  } };
}
