import type { HarmonyProviderPolicy } from '../../aiHarmonyModelRegistry';
import { GoogleGenAI } from '@google/genai';
import { getPantheonLearnedQueryPatterns, getPantheonLearnedSources, rankPantheonDiscoveryUrls } from './PantheonDiscoveryLearning';
import { planPantheonResearchQueries } from './PantheonResearchAssist';

export type PantheonDiscoveryLane =
  | 'learned'
  | 'gemini-google'
  | 'searxng'
  | 'ddgs'
  | 'openserp'
  | 'commoncrawl'

export interface PantheonDiscoveryEvidence {
  url: string;
  title?: string;
  snippet?: string;
  lane: PantheonDiscoveryLane;
}
export interface PantheonDiscoveryCoordinatorResult {
  urls: string[];
  evidence: PantheonDiscoveryEvidence[];
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

export function buildPantheonSearchQueryVariants(query: string): string[] {
  return [...new Set(query
    .split(/\s*\|\s*/)
    .map(variant => variant.replace(/\s+/g, ' ').trim())
    .filter(Boolean))]
    .slice(0, 4);
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

async function geminiGoogleSearch(query: string, limit: number, timeoutMs: number, signal?: AbortSignal): Promise<PantheonDiscoveryEvidence[]> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return [];
  if (signal?.aborted) return [];
  try {
    const client = new GoogleGenAI({ apiKey });
    const response = await withTimeout(timeoutMs, signal, requestSignal => client.models.generateContent({
      model: process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash',
      contents: [{ role: 'user', parts: [{ text: query }] }],
      config: {
        temperature: 0,
        tools: [{ googleSearch: {} }],
        abortSignal: requestSignal,
      },
    }));
    if (!response || signal?.aborted) return [];
    const grounding = response.candidates?.[0]?.groundingMetadata;
    const chunks = grounding?.groundingChunks || [];
    const supports = grounding?.groundingSupports || [];
    const seen = new Set<string>();
    return chunks.flatMap((chunk: any, index: number) => {
      const url = canonicalCandidate(String(chunk?.web?.uri || ''));
      if (!url || seen.has(url)) return [];
      seen.add(url);
      return [{
        url,
        title: String(chunk?.web?.title || '').trim().slice(0, 240) || undefined,
        // A generated answer may cite several pages. Attach only the segments
        // that Gemini explicitly attributed to this particular search result.
        snippet: supports.filter((support: any) => support.groundingChunkIndices?.includes(index))
          .map((support: any) => String(support.segment?.text || '').trim())
          .filter(Boolean).join(' ').slice(0, 1200) || undefined,
        lane: 'gemini-google' as const,
      }];
    }).slice(0, limit);
  } catch {
    return [];
  }
}

async function searxngSearch(query: string, limit: number, timeoutMs: number, signal?: AbortSignal): Promise<PantheonDiscoveryEvidence[]> {
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
    return (Array.isArray(payload?.results) ? payload.results : []).flatMap((item: any) => {
      const url = canonicalCandidate(String(item?.url || item?.link || ''));
      return url ? [{ url, title: String(item?.title || '').trim().slice(0, 240) || undefined, snippet: String(item?.content || item?.snippet || '').trim().slice(0, 1200) || undefined, lane: 'searxng' as const }] : [];
    }).slice(0, limit);
  }).catch(() => []);
}

async function ddgsSearch(query: string, limit: number, timeoutMs: number, signal?: AbortSignal): Promise<PantheonDiscoveryEvidence[]> {
      const base = process.env.DDGS_URL?.trim();
      if (!base) return [];
      const preferredBackend = [...new Set(
        (process.env.PANTHEON_DDGS_BACKEND?.trim() || 'auto')
          .split(',')
          .map(engine => engine.trim())
          .filter(Boolean),
      )].join(',');
      const preferredEngines = new Set(preferredBackend.split(','));
      const fallbackBackend = [...new Set(
        (process.env.PANTHEON_DDGS_FALLBACK_BACKENDS?.trim() || 'auto')
          .split(',')
          .map(engine => engine.trim())
          .filter(engine => engine && !preferredEngines.has(engine)),
      )].join(',');
      const deadline = Date.now() + timeoutMs;
      const requestBackend = (backend: string, budgetMs: number) => withTimeout(budgetMs, signal, async requestSignal => {
        const endpoint = new URL('/search/text', base.endsWith('/') ? base : base + '/');
        const response = await fetch(endpoint, {
          method: 'POST', signal: requestSignal,
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ query, max_results: limit, safesearch: 'off', backend }),
        });
        if (!response.ok) return [];
        const payload: any = await response.json();
        return (Array.isArray(payload?.results) ? payload.results : []).flatMap((item: any) => {
          const url = canonicalCandidate(String(item?.href || item?.url || item?.link || ''));
          return url ? [{ url, title: String(item?.title || '').trim().slice(0, 240) || undefined, snippet: String(item?.body || item?.snippet || '').trim().slice(0, 1200) || undefined, lane: 'ddgs' as const }] : [];
        }).slice(0, limit);
      }).catch(() => [] as PantheonDiscoveryEvidence[]);
      // Bound the preferred backend, then use the configured independent fallback group.
      const first = await requestBackend(preferredBackend, Math.max(300, Math.floor(timeoutMs * 0.55)));
      if (first.length || signal?.aborted) return first;
      const remaining = deadline - Date.now();
      return fallbackBackend && remaining >= 100 ? requestBackend(fallbackBackend, remaining) : [];
    }
    async function openSerpSearch(query: string, limit: number, timeoutMs: number, signal?: AbortSignal): Promise<PantheonDiscoveryEvidence[]> {
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
    return resultRows.flatMap((item: any) => {
      const url = canonicalCandidate(String(item?.url || item?.link || item?.href || ''));
      return url ? [{ url, title: String(item?.title || '').trim().slice(0, 240) || undefined, snippet: String(item?.description || item?.snippet || item?.text || '').trim().slice(0, 1200) || undefined, lane: 'openserp' as const }] : [];
    }).slice(0, limit);
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

function pantheonSourceFamily(raw: string): string {
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
    const parts = host.split('.').filter(Boolean);
    // Group ordinary subdomains under their parent source family while keeping
    // government/court hosts independently addressable.
    if (parts.length <= 2 || /\.gov$|\.us$/.test(host)) return host;
    return parts.slice(-2).join('.');
  } catch {
    return raw.toLowerCase();
  }
}

export function prioritizePantheonDiscoveryEvidenceGroups(
  evidenceGroups: readonly (readonly PantheonDiscoveryEvidence[])[],
  seen: ReadonlySet<string>,
  limit: number,
): PantheonDiscoveryEvidence[] {
  const evidenceByUrl = new Map<string, PantheonDiscoveryEvidence>();
  const rankedUrls: string[] = [];
  for (const group of evidenceGroups) {
    for (const item of group) if (!evidenceByUrl.has(item.url)) evidenceByUrl.set(item.url, item);
    rankedUrls.push(...rankPantheonDiscoveryUrls(group.map(item => item.url).filter(url => !seen.has(url))));
  }

  // A broad crawler fan-out is not broad research when every URL belongs to
  // the same source family. First take one result per independent family, then
  // fill remaining capacity with at most two URLs from any family.
  const uniqueRanked = [...new Set(rankedUrls)];
  const selected: string[] = [];
  const familyCounts = new Map<string, number>();
  for (const url of uniqueRanked) {
    const family = pantheonSourceFamily(url);
    if ((familyCounts.get(family) || 0) > 0) continue;
    selected.push(url);
    familyCounts.set(family, 1);
    if (selected.length >= Math.max(0, limit)) break;
  }
  if (selected.length < Math.max(0, limit)) {
    for (const url of uniqueRanked) {
      if (selected.includes(url)) continue;
      const family = pantheonSourceFamily(url);
      const count = familyCounts.get(family) || 0;
      if (count >= 2) continue;
      selected.push(url);
      familyCounts.set(family, count + 1);
      if (selected.length >= Math.max(0, limit)) break;
    }
  }
  return selected.flatMap(url => {
    const item = evidenceByUrl.get(url);
    return item ? [item] : [];
  });
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
    providerPolicy?: HarmonyProviderPolicy;
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
  const queryVariants = buildPantheonSearchQueryVariants(query);
  const effectiveQuery = queryVariants[0] || query;
  const lanesAttempted: PantheonDiscoveryLane[] = [];
  const lanesWithResults: PantheonDiscoveryLane[] = [];

  const lane = async (name: PantheonDiscoveryLane, enabled: boolean, work: () => Promise<Array<string | PantheonDiscoveryEvidence>>) => {
    if (!enabled) return { name, urls: [] as string[], evidence: [] as PantheonDiscoveryEvidence[] };
    lanesAttempted.push(name);
    const raw = await work().catch(() => []);
    const evidence = raw.flatMap(item => typeof item === 'string'
      ? (canonicalCandidate(item) ? [{ url: canonicalCandidate(item)!, lane: name }] : [])
      : [{ ...item, lane: name }]);
    const uniqueEvidence = [...new Map(evidence.map(item => [item.url, item])).values()];
    const urls = uniqueEvidence.map(item => item.url);
    if (urls.length) lanesWithResults.push(name);
    return { name, urls, evidence: uniqueEvidence };
  };

  // All free/applicable lanes launch together. Learned sources are queried in
  // the same fan-out so database latency never serializes network discovery.
  const settled = await Promise.all([
    lane('learned', true, () => softTimeout(
      getPantheonLearnedSources(options.categories || [], options.jurisdiction, limit),
      75,
      [] as string[],
    )),
    lane('gemini-google', Boolean(process.env.GEMINI_API_KEY?.trim()), async () => (
      await Promise.all(queryVariants.map(q => geminiGoogleSearch(q, limit, timeoutMs, options.signal)))
    ).flat()),
    lane('searxng', Boolean(process.env.SEARXNG_URL?.trim()), async () => (await Promise.all(queryVariants.map(q => searxngSearch(q, limit, timeoutMs, options.signal)))).flat()),
    lane('ddgs', Boolean(process.env.DDGS_URL?.trim()), async () => (await Promise.all(queryVariants.map(q => ddgsSearch(q, limit, timeoutMs, options.signal)))).flat()),
    lane('openserp', Boolean(process.env.OPENSERP_URL?.trim()), async () => (await Promise.all(queryVariants.map(q => openSerpSearch(q, limit, timeoutMs, options.signal)))).flat()),
    lane('commoncrawl', commonCrawlUseful(query), () => commonCrawlSearch(effectiveQuery, existingUrls, limit, timeoutMs, options.signal)),
  ]);

  // Fresh query-specific results outrank archives and learned source history.
  const evidenceGroups = [
    settled.filter(result => result.name !== 'learned' && result.name !== 'commoncrawl').flatMap(result => result.evidence),
    settled.filter(result => result.name === 'commoncrawl').flatMap(result => result.evidence),
    settled.filter(result => result.name === 'learned').flatMap(result => result.evidence),
  ];
  const freeEvidence = prioritizePantheonDiscoveryEvidenceGroups(evidenceGroups, seen, limit);
  const freeUrls = freeEvidence.map(item => item.url);

  // Normal successful discovery returns immediately. Learned query patterns are
  // consulted only on a miss, avoiding a serial database dependency.
  if (freeUrls.length) {
    return {
      urls: freeUrls,
      evidence: freeEvidence,
      lanesAttempted: [...new Set(lanesAttempted)],
      lanesWithResults: [...new Set(lanesWithResults)],
    };
  }

  const learnedPatterns = await learnedPatternPromise;
  const learnedPattern = learnedPatterns[0] || '';
  if (learnedPattern && !query.toLowerCase().includes(learnedPattern.toLowerCase())) {
    const learnedQuery = `${query} ${learnedPattern}`;
    const retry = await Promise.all([
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
        evidence: retry.flatMap(result => result.evidence).filter(item => learnedUrls.includes(item.url)),
        lanesAttempted: [...new Set(lanesAttempted)],
        lanesWithResults: [...new Set(lanesWithResults)],
      };
    }
  }

  // The assistants suggest better queries only after independent search has
  // missed. They cannot replace the search lanes or manufacture source evidence.
  // Legal authority discovery is separate from Pantheon's background team.
  if (options.providerPolicy !== 'legalwhat' && !options.signal?.aborted) {
    const plan = await planPantheonResearchQueries(query, { signal: options.signal, timeoutMs: 7_000 });
    if (plan.queries.length) {
      const expanded = await Promise.all(plan.queries.map(async alternate => Promise.all([
        lane('gemini-google', Boolean(process.env.GEMINI_API_KEY?.trim()), () => geminiGoogleSearch(alternate, limit, timeoutMs, options.signal)),
        lane('searxng', Boolean(process.env.SEARXNG_URL?.trim()), () => searxngSearch(alternate, limit, timeoutMs, options.signal)),
        lane('ddgs', Boolean(process.env.DDGS_URL?.trim()), () => ddgsSearch(alternate, limit, timeoutMs, options.signal)),
        lane('openserp', Boolean(process.env.OPENSERP_URL?.trim()), () => openSerpSearch(alternate, limit, timeoutMs, options.signal)),
      ])));
      const evidence = prioritizePantheonDiscoveryEvidenceGroups(
        [expanded.flatMap(results => results.flatMap(result => result.evidence))], seen, limit);
      if (evidence.length) return {
        urls: evidence.map(item => item.url), evidence,
        lanesAttempted: [...new Set(lanesAttempted)], lanesWithResults: [...new Set(lanesWithResults)],
      };
    }
  }

  // Paid search remains disabled; a miss is not a negative factual finding.
  return {
    urls: [],
    evidence: [],
    lanesAttempted: [...new Set(lanesAttempted)],
    lanesWithResults: [...new Set(lanesWithResults)],
  };
}
