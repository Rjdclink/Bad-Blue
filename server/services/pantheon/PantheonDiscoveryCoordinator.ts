import { orchestratedWebSearch } from '../../openRouterWebSearch';
import { supplementalPantheonDiscovery } from './PantheonSupplementalDiscovery';
import { getPantheonLearnedQueryPatterns, getPantheonLearnedSources, rankPantheonDiscoveryUrls } from './PantheonDiscoveryLearning';

export type PantheonDiscoveryLane =
  | 'learned'
  | 'first-party'
  | 'searxng'
  | 'ddgs'
  | 'openserp'
  | 'commoncrawl'
  | 'serpapi'
  | 'scrapingbee';

export interface PantheonDiscoveryCoordinatorResult {
  urls: string[];
  lanesAttempted: PantheonDiscoveryLane[];
  lanesWithResults: PantheonDiscoveryLane[];
}

function canonicalCandidate(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (/\/(?:terms|privacy|disclaimer)(?:[/?#]|$)/i.test(url.pathname)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|gclid|fbclid|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function softTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

async function withTimeout<T>(
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const relay = () => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  else parentSignal?.addEventListener('abort', relay, { once: true });
  const timer = setTimeout(() => controller.abort(), Math.max(100, timeoutMs));
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', relay);
  }
}

async function searxngSearch(query: string, limit: number, timeoutMs: number, signal?: AbortSignal): Promise<string[]> {
  const base = process.env.SEARXNG_URL?.trim();
  if (!base) return [];
  return withTimeout(timeoutMs, signal, async requestSignal => {
    const endpoint = new URL('/search', base.endsWith('/') ? base : base + '/');
    endpoint.searchParams.set('q', query);
    endpoint.searchParams.set('format', 'json');
    endpoint.searchParams.set('safesearch', '0');
    const response = await fetch(endpoint, { signal: requestSignal, headers: { accept: 'application/json' } });
    if (!response.ok) return [];
    const payload: any = await response.json();
    return (Array.isArray(payload?.results) ? payload.results : [])
      .flatMap((item: any) => [item?.url, item?.link].filter(Boolean))
      .map((value: unknown) => canonicalCandidate(String(value)))
      .filter((value: string | null): value is string => Boolean(value))
      .slice(0, limit);
  }).catch(() => []);
}

async function ddgsSearch(query: string, limit: number, timeoutMs: number, signal?: AbortSignal): Promise<string[]> {
  const base = process.env.DDGS_URL?.trim();
  if (!base) return [];
  return withTimeout(timeoutMs, signal, async requestSignal => {
    const endpoint = new URL('/search/text', base.endsWith('/') ? base : base + '/');
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: requestSignal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query, max_results: limit, safesearch: 'off' }),
    });
    if (!response.ok) return [];
    const payload: any = await response.json();
    return (Array.isArray(payload?.results) ? payload.results : [])
      .flatMap((item: any) => [item?.href, item?.url, item?.link].filter(Boolean))
      .map((value: unknown) => canonicalCandidate(String(value)))
      .filter((value: string | null): value is string => Boolean(value))
      .slice(0, limit);
  }).catch(() => []);
}

async function openSerpSearch(query: string, limit: number, timeoutMs: number, signal?: AbortSignal): Promise<string[]> {
  const base = process.env.OPENSERP_URL?.trim();
  if (!base) return [];
  return withTimeout(timeoutMs, signal, async requestSignal => {
    const endpoint = new URL('/mega/search', base.endsWith('/') ? base : base + '/');
    endpoint.searchParams.set('text', query);
    endpoint.searchParams.set('limit', String(limit));
    endpoint.searchParams.set('mode', 'any');
    // Railway's restricted container cannot reliably launch OpenSERP's browser
    // engines. Raw Baidu is verified here; the remaining raw engines are bounded
    // fallbacks inside OpenSERP itself.
    endpoint.searchParams.set('engines', 'baidu,ecosia,yandex,google');
    const response = await fetch(endpoint, { signal: requestSignal, headers: { accept: 'application/json' } });
    if (!response.ok) return [];
    const payload: any = await response.json();
    const resultRows = Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.data?.results)
        ? payload.data.results
        : [];
    return resultRows
      .flatMap((item: any) => [item?.url, item?.link, item?.href].filter(Boolean))
      .map((value: unknown) => canonicalCandidate(String(value)))
      .filter((value: string | null): value is string => Boolean(value))
      .slice(0, limit);
  }).catch(() => []);
}

function commonCrawlUseful(query: string): boolean {
  return /\b(?:histor|archive|archived|former|formerly|previous|old|when did|died|death|deceased|past|prior)\b/i.test(query);
}

async function commonCrawlSearch(
  query: string,
  seeds: readonly string[],
  limit: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!commonCrawlUseful(query) || seeds.length === 0) return [];
  const hosts = [...new Set(seeds.flatMap(seed => {
    try { return [new URL(seed).hostname]; } catch { return []; }
  }))].slice(0, 2);
  if (!hosts.length) return [];

  return withTimeout(timeoutMs, signal, async requestSignal => {
    const collectionResponse = await fetch('https://index.commoncrawl.org/collinfo.json', {
      signal: requestSignal,
      headers: { accept: 'application/json', 'user-agent': 'LegalWhat-Pantheon/1.0' },
    });
    if (!collectionResponse.ok) return [];
    const collections: any[] = await collectionResponse.json();
    const indexApi = String(collections?.[0]?.['cdx-api'] || '');
    if (!/^https?:\/\//i.test(indexApi)) return [];

    const perHost = Math.max(2, Math.ceil(limit / hosts.length));
    const results = await Promise.all(hosts.map(async host => {
      const endpoint = new URL(indexApi);
      endpoint.searchParams.set('url', `${host}/*`);
      endpoint.searchParams.set('matchType', 'domain');
      endpoint.searchParams.set('output', 'json');
      endpoint.searchParams.set('filter', 'status:200');
      endpoint.searchParams.set('limit', String(perHost));
      const response = await fetch(endpoint, {
        signal: requestSignal,
        headers: { accept: 'application/x-ndjson,text/plain', 'user-agent': 'LegalWhat-Pantheon/1.0' },
      });
      if (!response.ok) return [];
      const text = await response.text();
      return text.split(/\r?\n/).flatMap(line => {
        if (!line.trim()) return [];
        try {
          const record = JSON.parse(line);
          const candidate = canonicalCandidate(String(record?.url || ''));
          return candidate ? [candidate] : [];
        } catch {
          return [];
        }
      });
    }));
    return [...new Set(results.flat())].slice(0, limit);
  }).catch(() => []);
}

export async function discoverPantheonSourcesParallel(
  query: string,
  existingUrls: readonly string[],
  options: {
    categories?: readonly string[];
    jurisdiction?: string;
    limit?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    includePaidFallback?: boolean;
  } = {},
): Promise<PantheonDiscoveryCoordinatorResult> {
  const limit = Math.max(1, Math.min(options.limit || 12, 24));
  const timeoutMs = Math.max(250, Math.min(options.timeoutMs || 900, 5_000));
  const seen = new Set(existingUrls.map(url => canonicalCandidate(url)).filter(Boolean) as string[]);
  // Persisted query learning is loaded concurrently and only used if the first
  // free fan-out produces nothing, so database latency never delays a normal hit.
  const learnedPatternPromise = softTimeout(
    getPantheonLearnedQueryPatterns(options.categories || [], options.jurisdiction, 1),
    75,
    [] as string[],
  );
  const effectiveQuery = query;
  const lanesAttempted: PantheonDiscoveryLane[] = [];
  const lanesWithResults: PantheonDiscoveryLane[] = [];

  const lane = async (name: PantheonDiscoveryLane, enabled: boolean, work: () => Promise<string[]>) => {
    if (!enabled) return { name, urls: [] as string[] };
    lanesAttempted.push(name);
    const urls = await work().catch(() => []);
    if (urls.length) lanesWithResults.push(name);
    return { name, urls };
  };

  // All free/applicable lanes launch together. Learned sources are queried in
  // the same fan-out so database latency never serializes network discovery.
  const settled = await Promise.all([
    lane('learned', true, () => softTimeout(
      getPantheonLearnedSources(options.categories || [], options.jurisdiction, limit),
      75,
      [] as string[],
    )),
    lane('first-party', true, async () => {
      // This lane is supplemental only. Credit/provider failure is normalized to
      // an empty lane so registry, learned, self-hosted and Common Crawl lanes
      // remain fully independent.
      const result = await orchestratedWebSearch(effectiveQuery, {
        useOnlinePlugin: true,
        timeout: timeoutMs,
        signal: options.signal,
      }).catch(() => ({ sources: [] as string[] }));
      return result.sources
        .map(url => canonicalCandidate(url))
        .filter((url: string | null): url is string => Boolean(url));
    }),
    lane('searxng', Boolean(process.env.SEARXNG_URL?.trim()), () => searxngSearch(effectiveQuery, limit, timeoutMs, options.signal)),
    lane('ddgs', Boolean(process.env.DDGS_URL?.trim()), () => ddgsSearch(effectiveQuery, limit, timeoutMs, options.signal)),
    lane('openserp', Boolean(process.env.OPENSERP_URL?.trim()), () => openSerpSearch(effectiveQuery, limit, timeoutMs, options.signal)),
    lane('commoncrawl', commonCrawlUseful(query), () => commonCrawlSearch(effectiveQuery, existingUrls, limit, timeoutMs, options.signal)),
  ]);

  const freeUrls = rankPantheonDiscoveryUrls(
    settled.flatMap(result => result.urls)
      .filter(url => !seen.has(url)),
  ).slice(0, limit);

  // Normal successful discovery returns immediately. Learned query patterns are
  // consulted only on a miss, avoiding a serial database dependency.
  if (freeUrls.length || options.includePaidFallback === false) {
    return {
      urls: freeUrls,
      lanesAttempted: [...new Set(lanesAttempted)],
      lanesWithResults: [...new Set(lanesWithResults)],
    };
  }

  const learnedPatterns = await learnedPatternPromise;
  const learnedPattern = learnedPatterns[0] || '';
  if (learnedPattern && !query.toLowerCase().includes(learnedPattern.toLowerCase())) {
    const learnedQuery = `${query} ${learnedPattern}`;
    const retry = await Promise.all([
      lane('first-party', true, async () => {
        const result = await orchestratedWebSearch(learnedQuery, {
          useOnlinePlugin: true,
          timeout: Math.min(timeoutMs, 650),
          signal: options.signal,
        }).catch(() => ({ sources: [] as string[] }));
        return result.sources
          .map(url => canonicalCandidate(url))
          .filter((url: string | null): url is string => Boolean(url));
      }),
      lane('searxng', Boolean(process.env.SEARXNG_URL?.trim()), () => searxngSearch(learnedQuery, limit, Math.min(timeoutMs, 650), options.signal)),
      lane('ddgs', Boolean(process.env.DDGS_URL?.trim()), () => ddgsSearch(learnedQuery, limit, Math.min(timeoutMs, 650), options.signal)),
      lane('openserp', Boolean(process.env.OPENSERP_URL?.trim()), () => openSerpSearch(learnedQuery, limit, Math.min(timeoutMs, 650), options.signal)),
    ]);
    const learnedUrls = rankPantheonDiscoveryUrls(
      retry.flatMap(result => result.urls).filter(url => !seen.has(url)),
    ).slice(0, limit);
    if (learnedUrls.length) {
      return {
        urls: learnedUrls,
        lanesAttempted: [...new Set(lanesAttempted)],
        lanesWithResults: [...new Set(lanesWithResults)],
      };
    }
  }

  // Credit-bearing providers remain a true fallback: they never race free
  // lanes and therefore cannot consume credits when free discovery succeeded.
  const paid = await supplementalPantheonDiscovery(effectiveQuery, existingUrls, {
    limit,
    timeoutMs,
    signal: options.signal,
  });
  if (paid.attempted) {
    const paidLane = paid.provider as 'serpapi' | 'scrapingbee' | undefined;
    if (paidLane) lanesAttempted.push(paidLane);
    if (paidLane && paid.urls.length) lanesWithResults.push(paidLane);
  }
  return {
    urls: rankPantheonDiscoveryUrls(paid.urls.filter(url => !seen.has(url))).slice(0, limit),
    lanesAttempted: [...new Set(lanesAttempted)],
    lanesWithResults: [...new Set(lanesWithResults)],
  };
}
