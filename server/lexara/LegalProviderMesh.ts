import {
  buildLexaraSourceQueries,
  getLexaraPublicSources,
  type LexaraSourceCategory,
} from './LexaraPublicSourceRegistry';
import {
  getLexaraLearnedQueryPatterns,
  getLexaraLearnedSources,
  rankLexaraDiscoveryUrls,
} from './LexaraDiscoveryLearning';
import { planLexaraResearchQueries } from './LexaraResearchAssist';

export type LegalMeshTier = 1 | 2 | 3 | 4 | 5 | 6;
export interface LegalMeshCandidate {
  url: string;
  title: string;
  excerpt?: string;
  tier: LegalMeshTier;
  provider: string;
  sourceCategory?: LexaraSourceCategory;
}

export interface LegalMeshSearchOptions {
  categories?: readonly LexaraSourceCategory[];
  jurisdiction?: string;
  subject?: string;
  requestedFact?: string;
  // Live Lexara background turns can return as soon as one independent
  // provider/query variant yields useful candidates. Default false preserves
  // comprehensive discovery for legal research, SPECTRA and other callers.
  firstUseful?: boolean;
}

const clean = (v: unknown) => {
  try {
    const u = new URL(String(v || '').trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    if (/\/(?:terms|privacy|disclaimer)(?:[/?#]|$)/i.test(u.pathname)) return null;
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) if (/^(?:utm_|gclid|fbclid|mc_)/i.test(key)) u.searchParams.delete(key);
    return u.toString();
  } catch {
    return null;
  }
};

async function withTimeout<T>(
  timeoutMs: number,
  signal: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T | null> {
  const controller = new AbortController();
  const relay = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', relay, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Lexara discovery timeout')), Math.max(250, timeoutMs));
  try {
    return await work(controller.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
}

function sourceFamily(raw: string): string {
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
    const parts = host.split('.').filter(Boolean);
    if (parts.length <= 2 || /\.gov$|\.us$/.test(host)) return host;
    return parts.slice(-2).join('.');
  } catch {
    return raw.toLowerCase();
  }
}

function isPreferredOfficialCandidate(item: LegalMeshCandidate, options: LegalMeshSearchOptions): boolean {
  if (!options.requestedFact || options.requestedFact === 'none') return false;
  let host = '';
  try {
    host = new URL(item.url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  if (host.endsWith('.gov') || host.endsWith('.mil') || host.endsWith('.uscourts.gov')) return true;
  const preferredHosts = getLexaraPublicSources(options.categories || [], options.jurisdiction)
    .filter(source => source.authority !== 'discovery')
    .flatMap(source => {
      try {
        return [new URL(source.root).hostname.toLowerCase().replace(/^www\./, '')];
      } catch {
        return [];
      }
    });
  return preferredHosts.some(preferred => host === preferred || host.endsWith(`.${preferred}`));
}

function fuseRankedCandidates(groups: readonly LegalMeshCandidate[][]): LegalMeshCandidate[] {
  const scores = new Map<string, number>();
  const byUrl = new Map<string, LegalMeshCandidate>();
  for (const group of groups) {
    group.forEach((item, index) => {
      if (!byUrl.has(item.url)) byUrl.set(item.url, item);
      scores.set(item.url, (scores.get(item.url) || 0) + 1 / (60 + index + 1));
    });
  }
  return [...byUrl.values()].sort((left, right) =>
    (scores.get(right.url) || 0) - (scores.get(left.url) || 0));
}

function diversify(items: LegalMeshCandidate[], limit = 16): LegalMeshCandidate[] {
  const byUrl = [...new Map(items.map(item => [item.url, item])).values()];
  const ranked = rankLexaraDiscoveryUrls(byUrl.map(item => item.url));
  const itemByUrl = new Map(byUrl.map(item => [item.url, item]));
  const selected: LegalMeshCandidate[] = [];
  const familyCounts = new Map<string, number>();
  for (const url of ranked) {
    const item = itemByUrl.get(url);
    if (!item) continue;
    const family = sourceFamily(url);
    if ((familyCounts.get(family) || 0) > 0) continue;
    selected.push(item);
    familyCounts.set(family, 1);
    if (selected.length >= limit) return selected;
  }
  for (const url of ranked) {
    const item = itemByUrl.get(url);
    if (!item || selected.includes(item)) continue;
    const family = sourceFamily(url);
    const count = familyCounts.get(family) || 0;
    if (count >= 2) continue;
    selected.push(item);
    familyCounts.set(family, count + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

async function tavily(query: string, signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) return [];
  const result = await withTimeout(2_000, signal, async requestSignal => {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST', signal: requestSignal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, search_depth: 'basic', max_results: 10, include_answer: false, include_raw_content: false }),
    });
    if (!r.ok) return [];
    const j:any = await r.json();
    return (j.results || []).flatMap((x:any) => {
      const url=clean(x.url);
      return url ? [{url,title:String(x.title||'Tavily result'),excerpt:String(x.content||'').slice(0,1200),tier:3 as const,provider:'tavily'}] : [];
    });
  });
  return result || [];
}

async function duckDuckGoInstantAnswer(query: string, signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  const result=await withTimeout(1_500,signal,async requestSignal=>{
    const endpoint=new URL('https://api.duckduckgo.com/');
    endpoint.searchParams.set('q',query);
    endpoint.searchParams.set('format','json');
    endpoint.searchParams.set('no_html','1');
    endpoint.searchParams.set('no_redirect','1');
    const response=await fetch(endpoint,{signal:requestSignal,headers:{accept:'application/json'}});
    if(!response.ok) return [];
    const payload:any=await response.json();
    const candidates:LegalMeshCandidate[]=[];
    const abstractUrl=clean(payload?.AbstractURL);
    const abstract=String(payload?.AbstractText||payload?.Abstract||'').trim();
    if(abstractUrl && abstract){
      candidates.push({
        url:abstractUrl,
        title:String(payload?.Heading||payload?.AbstractSource||'DuckDuckGo Instant Answer').slice(0,240),
        excerpt:abstract.slice(0,1200),
        tier:3 as const,
        provider:'duckduckgo-instant-answer',
      });
    }
    return candidates;
  });
  return result||[];
}

async function searxng(query: string, signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  const base = process.env.SEARXNG_URL?.trim();
  if (!base) return [];
  const result = await withTimeout(2_200, signal, async requestSignal => {
    const endpoint = new URL('/search', base.endsWith('/') ? base : base + '/');
    endpoint.searchParams.set('q', query);
    endpoint.searchParams.set('format', 'json');
    endpoint.searchParams.set('safesearch', '0');
    const response = await fetch(endpoint, { signal: requestSignal, headers: { accept: 'application/json' } });
    if (!response.ok) return [];
    const payload:any = await response.json();
    return (Array.isArray(payload?.results) ? payload.results : []).slice(0, 12).flatMap((item:any) => {
      const url=clean(item?.url || item?.link);
      return url ? [{url,title:String(item?.title||'SearXNG result'),excerpt:String(item?.content||item?.snippet||'').slice(0,1200),tier:3 as const,provider:'searxng'}] : [];
    });
  });
  return result || [];
}

async function ddgsBackend(query: string, backend: string, budgetMs: number, signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  const base = process.env.DDGS_URL?.trim();
  if (!base) return [];
  const result = await withTimeout(budgetMs, signal, async requestSignal => {
    const endpoint = new URL('/search/text', base.endsWith('/') ? base : base + '/');
    const response = await fetch(endpoint, {
      method: 'POST', signal: requestSignal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query, max_results: 12, safesearch: 'off', backend }),
    });
    if (!response.ok) return [];
    const payload:any = await response.json();
    return (Array.isArray(payload?.results) ? payload.results : []).slice(0, 12).flatMap((item:any) => {
      const url=clean(item?.href || item?.url || item?.link);
      return url ? [{url,title:String(item?.title||'DDGS result'),excerpt:String(item?.body||item?.snippet||'').slice(0,1200),tier:3 as const,provider:`ddgs:${backend}`}] : [];
    });
  });
  return result || [];
}

async function ddgs(query: string, signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  if (!process.env.DDGS_URL?.trim()) return [];
  const primary = [...new Set((process.env.LEXARA_DDGS_BACKEND?.trim() || 'auto').split(',').map(x=>x.trim()).filter(Boolean))].join(',');
  const fallback = [...new Set((process.env.LEXARA_DDGS_FALLBACK_BACKENDS?.trim() || 'auto').split(',').map(x=>x.trim()).filter(x=>x && x!==primary))].join(',');
  const first = await ddgsBackend(query, primary, 1_300, signal);
  return first.length || !fallback ? first : ddgsBackend(query, fallback, 900, signal);
}

async function openserp(query: string, signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  const base = process.env.OPENSERP_URL?.trim();
  if (!base) return [];
  const result = await withTimeout(2_200, signal, async requestSignal => {
    const endpoint = new URL('/mega/search', base.endsWith('/') ? base : base + '/');
    endpoint.searchParams.set('text', query);
    endpoint.searchParams.set('limit', '12');
    endpoint.searchParams.set('mode', 'any');
    endpoint.searchParams.set('engines', 'baidu,ecosia,yandex,google');
    const response = await fetch(endpoint, { signal: requestSignal, headers: { accept: 'application/json' } });
    if (!response.ok) return [];
    const payload:any = await response.json();
    const rows = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload?.data?.results) ? payload.data.results : [];
    return rows.slice(0, 12).flatMap((item:any) => {
      const url=clean(item?.url || item?.link || item?.href);
      return url ? [{url,title:String(item?.title||'OpenSERP result'),excerpt:String(item?.description||item?.snippet||item?.text||'').slice(0,1200),tier:3 as const,provider:'openserp'}] : [];
    });
  });
  return result || [];
}

async function serpApi(query: string, existingUrls: readonly string[], signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  const key=process.env.SERPAPI_KEY?.trim() || process.env.SERPAPI_API_KEY?.trim();
  if(!key) return [];
  const seen=new Set(existingUrls);
  const result=await withTimeout(2_500,signal,async requestSignal=>{
    const endpoint=new URL('https://serpapi.com/search.json');
    endpoint.searchParams.set('engine','google'); endpoint.searchParams.set('q',query);
    endpoint.searchParams.set('api_key',key); endpoint.searchParams.set('num','10');
    const response=await fetch(endpoint,{signal:requestSignal}); if(!response.ok) return [];
    const payload:any=await response.json();
    return (payload.organic_results||[]).flatMap((item:any)=>{
      const url=clean(item?.link); return url && !seen.has(url)
        ? [{url,title:String(item?.title||'SerpAPI result'),excerpt:String(item?.snippet||'').slice(0,1200),tier:5 as const,provider:'serpapi'}] : [];
    }).slice(0,10);
  });
  return result||[];
}

async function scrapingBee(query: string, existingUrls: readonly string[], signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  const key=process.env.SCRAPINGBEE_API_KEY?.trim(); if(!key) return [];
  const seen=new Set(existingUrls);
  const result=await withTimeout(2_500,signal,async requestSignal=>{
    const google=`https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`;
    const endpoint=new URL('https://app.scrapingbee.com/api/v1/');
    endpoint.searchParams.set('api_key',key); endpoint.searchParams.set('url',google); endpoint.searchParams.set('render_js','false');
    const response=await fetch(endpoint,{signal:requestSignal}); if(!response.ok) return [];
    const html=await response.text();
    return [...html.matchAll(/href=["'](?:\/url\?q=)?(https?:\/\/[^"'& ]+)/gi)].flatMap(match=>{
      const url=clean(match[1]); return url && !/google\.com/i.test(url) && !seen.has(url)
        ? [{url,title:'ScrapingBee Google result',tier:5 as const,provider:'scrapingbee'}] : [];
    }).slice(0,10);
  });
  return result||[];
}

function commonCrawlUseful(query: string, categories: readonly LexaraSourceCategory[] = []): boolean {
  return categories.includes('news-history') || /\b(?:histor|archive|archived|former|formerly|previous|old|past|prior)\b/i.test(query);
}

async function commonCrawl(query: string, existingUrls: readonly string[], options: LegalMeshSearchOptions, signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  if (!commonCrawlUseful(query, options.categories) || !existingUrls.length) return [];
  const hosts=[...new Set(existingUrls.flatMap(raw=>{try{return [new URL(raw).hostname];}catch{return [];}}))].slice(0,3);
  if(!hosts.length) return [];
  const result=await withTimeout(2_500,signal,async requestSignal=>{
    const collections=await fetch('https://index.commoncrawl.org/collinfo.json',{signal:requestSignal,headers:{accept:'application/json','user-agent':'LegalWhat-Lexara/1.0'}});
    if(!collections.ok) return [];
    const data:any[]=await collections.json(); const indexApi=String(data?.[0]?.['cdx-api']||'');
    if(!/^https?:\/\//i.test(indexApi)) return [];
    const groups=await Promise.all(hosts.map(async host=>{
      const endpoint=new URL(indexApi); endpoint.searchParams.set('url',`${host}/*`);
      endpoint.searchParams.set('matchType','domain'); endpoint.searchParams.set('output','json');
      endpoint.searchParams.set('filter','status:200'); endpoint.searchParams.set('limit','8');
      const response=await fetch(endpoint,{signal:requestSignal,headers:{accept:'application/x-ndjson,text/plain','user-agent':'LegalWhat-Lexara/1.0'}});
      if(!response.ok) return [];
      return (await response.text()).split(/\r?\n/).flatMap(line=>{
        if(!line.trim()) return []; try{const row=JSON.parse(line); const url=clean(row?.url); return url?[{url,title:'Common Crawl historical capture',tier:5 as const,provider:'commoncrawl'}]:[];}catch{return [];}
      });
    }));
    return groups.flat();
  });
  return result||[];
}

async function freeSearch(
  query: string,
  signal?: AbortSignal,
  firstUseful = false,
): Promise<LegalMeshCandidate[]> {
  // One parent listener per query variant prevents the shared turn signal from
  // accumulating a listener for every parallel search provider.
  const controller = new AbortController();
  const relayAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', relayAbort, { once: true });
  const providerSearches = [
    () => tavily(query,controller.signal),
    () => duckDuckGoInstantAnswer(query,controller.signal),
    () => searxng(query,controller.signal),
    () => ddgs(query,controller.signal),
    () => openserp(query,controller.signal),
  ];
  try {
    if (firstUseful) {
      const providerAttempts = providerSearches.map(search =>
        search().then(results => {
          if (!results.length) throw new Error('Lexara search provider returned no candidates');
          return results;
        }),
      );
      try {
        const firstUsefulResults = await Promise.any(providerAttempts);
        controller.abort(new Error('Lexara first useful provider result selected'));
        return firstUsefulResults;
      } catch (error) {
        if (signal?.aborted) {
          const reason = signal.reason;
          if (reason instanceof Error || reason instanceof DOMException) throw reason;
          throw new DOMException(typeof reason === 'string' ? reason : 'Lexara discovery cancelled', 'AbortError');
        }
        return [];
      }
    }

    const groups=await Promise.all(providerSearches.map(search => search()));
    return fuseRankedCandidates(groups);
  } finally {
    signal?.removeEventListener('abort', relayAbort);
  }
}

async function firstUsefulSearchVariants(
  queries: readonly string[],
  signal?: AbortSignal,
): Promise<LegalMeshCandidate[]> {
  if (!queries.length) return [];

  const controller = new AbortController();
  const relayAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', relayAbort, { once: true });

  try {
    const variantAttempts = queries.map(query =>
      freeSearch(query, controller.signal, true).then(results => {
        if (!results.length) throw new Error('Lexara search variant returned no candidates');
        return results;
      }),
    );
    const firstUsefulResults = await Promise.any(variantAttempts);
    controller.abort(new Error('Lexara first useful query variant selected'));
    return firstUsefulResults;
  } catch (error) {
    if (signal?.aborted) {
      const reason = signal.reason;
      if (reason instanceof Error || reason instanceof DOMException) throw reason;
      throw new DOMException(typeof reason === 'string' ? reason : 'Lexara discovery cancelled', 'AbortError');
    }
    return [];
  } finally {
    signal?.removeEventListener('abort', relayAbort);
  }
}

async function firstUsefulParallelSearch(
  queries: readonly string[],
  seen: ReadonlySet<string>,
  providerPrefix: 'supplemental' | 'planned',
  signal?: AbortSignal,
  providerFirstUseful = false,
): Promise<LegalMeshCandidate[]> {
  if (!queries.length) return [];

  const controller = new AbortController();
  const relayAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', relayAbort, { once: true });

  try {
    const attempts = queries.map(query =>
      freeSearch(query, controller.signal, providerFirstUseful).then(results => {
        const fresh = results
          .filter(item => !seen.has(item.url))
          .map(item => ({ ...item, tier: 5 as const, provider: `${providerPrefix}-${item.provider}` }));
        if (!fresh.length) throw new Error('Lexara search variant returned no fresh candidates');
        return diversify(fresh, 12);
      }),
    );

    const firstUseful = await Promise.any(attempts);
    controller.abort(new Error('Lexara first useful supplemental result selected'));
    return firstUseful;
  } catch (error) {
    if (signal?.aborted) {
      const reason = signal.reason;
      if (reason instanceof Error || reason instanceof DOMException) throw reason;
      throw new DOMException(typeof reason === 'string' ? reason : 'Lexara discovery cancelled', 'AbortError');
    }
    return [];
  } finally {
    signal?.removeEventListener('abort', relayAbort);
  }
}

export async function discoverLegalMeshTier3(
  query: string,
  signal?: AbortSignal,
  options: LegalMeshSearchOptions = {},
): Promise<LegalMeshCandidate[]> {
  const learnedPatterns=await Promise.race([
    getLexaraLearnedQueryPatterns(options.categories||[],options.jurisdiction,1),
    new Promise<string[]>(resolve=>setTimeout(()=>resolve([]),75)),
  ]);
  const variants=buildLexaraSourceQueries({
    query,
    subject:options.subject,
    requestedFact:options.requestedFact,
    categories:options.categories,
    jurisdiction:options.jurisdiction,
  });
  if(learnedPatterns[0]) variants.push(`${query} ${learnedPatterns[0]}`);
  const uniqueVariants=[...new Set(variants)].slice(0,6);
  const groups=options.firstUseful
    ? [await firstUsefulSearchVariants(uniqueVariants,signal)]
    : await Promise.all(uniqueVariants.map(variant=>freeSearch(variant,signal)));
  const learnedSources=await Promise.race([
    getLexaraLearnedSources(options.categories||[],options.jurisdiction,8),
    new Promise<string[]>(resolve=>setTimeout(()=>resolve([]),75)),
  ]);
  const learnedCandidates=learnedSources.map(url=>({url,title:'Previously successful Lexara source',tier:3 as const,provider:'lexara-learned'}));
  const combined=[...fuseRankedCandidates(groups),...learnedCandidates];
  const preferred=diversify(combined.filter(item=>isPreferredOfficialCandidate(item,options)),8);
  const preferredUrls=new Set(preferred.map(item=>item.url));
  const remainder=diversify(combined.filter(item=>!preferredUrls.has(item.url)),18);
  return [...preferred,...remainder].slice(0,18);
}

export async function discoverLegalMeshSupplemental(
  query: string,
  existingUrls: readonly string[],
  signal?: AbortSignal,
  options: LegalMeshSearchOptions = {},
): Promise<LegalMeshCandidate[]> {
  const seen=new Set(existingUrls.map(value=>clean(value)).filter(Boolean) as string[]);
  const historical=await commonCrawl(query,existingUrls,options,signal);
  const historicalNew=historical.filter(item=>!seen.has(item.url));
  if(historicalNew.length) return diversify(historicalNew,12);

  const learnedPatterns=await getLexaraLearnedQueryPatterns(options.categories||[],options.jurisdiction,2);
  if(learnedPatterns.length){
    const learnedFresh=await firstUsefulParallelSearch(
      learnedPatterns.map(pattern=>`${query} ${pattern}`),
      seen,
      'supplemental',
      signal,
      options.firstUseful === true,
    );
    if(learnedFresh.length) return learnedFresh;
  }

  // Only after independent search + learned-pattern retries miss, let the
  // Claude-led redundant reasoning mesh suggest alternate queries. These
  // suggestions are never evidence; every result is still independently searched.
  const planned=await planLexaraResearchQueries(query,{
    subject:options.subject,
    requestedFact:options.requestedFact,
    jurisdiction:options.jurisdiction,
    signal,
  });
  if(planned.queries.length){
    const plannedFresh=await firstUsefulParallelSearch(
      planned.queries,
      seen,
      'planned',
      signal,
      options.firstUseful === true,
    );
    if(plannedFresh.length) return plannedFresh;
  }

  const paid=await serpApi(query,existingUrls,signal);
  if(paid.length) return diversify(paid,12);
  return diversify(await scrapingBee(query,existingUrls,signal),12);
}

export function legalMeshSufficient(items: LegalMeshCandidate[]): boolean {
  if (!items.length) return false;
  const authoritative = items.some(x => {
    try {
      const h=new URL(x.url).hostname.toLowerCase();
      return h.endsWith('.gov') || h.endsWith('.uscourts.gov') || h.includes('courtlistener.com')
        || h.includes('nursys.com') || h.includes('ncsbn.org') || h.includes('finra.org');
    } catch {
      return false;
    }
  });
  return authoritative || items.filter(x => x.excerpt?.trim()).length >= 2;
}

export function getLexaraSearchMeshSourceRoots(categories: readonly LexaraSourceCategory[] = [], jurisdiction?: string): string[] {
  return getLexaraPublicSources(categories,jurisdiction).map(source=>source.root);
}
