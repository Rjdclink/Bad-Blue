import {
  buildLexaraSourceQueries,
  getLexaraPublicSources,
  getLexaraSourceQueryHints,
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
  // Compatibility flag for live discovery. All bounded provider/query results
  // are retained until the investigator evaluates identity and factual evidence.
  firstUseful?: boolean;
  officialFormQuery?: boolean;
  // Native-only callers retain every source lane without buying alternate
  // query suggestions. Existing callers keep the conditional planner.
  allowClaudePlanning?: boolean;
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
    // Invalid provider URLs are ordinary search noise; there is no request
    // controller in this URL-normalization scope.
    return null;
  }
};

function independentSearchBase(value: string | undefined): string {
  const base = String(value || '').trim();
  if (!base) return '';
  try {
    const host = new URL(base).hostname.toLowerCase();
    if (/^pantheon-(?:ddgs|searxng|openserp)\.railway\.internal$/.test(host)) return '';
  } catch {
    return base;
  }
  return base;
}

// Known CAPTCHA sources are excluded explicitly; never use automatic backend
// selection that can silently reintroduce them.
const captchaDisabledEngines = new Set(['duckduckgo']);
const engineCooldownUntil = new Map<string, number>();
const laneInFlight = new Map<string, number>();

function engineAvailable(engine: string): boolean {
  return !captchaDisabledEngines.has(engine) && (engineCooldownUntil.get(engine) || 0) <= Date.now();
}

function recordEngineFailure(engine: string, reason: string, retryAfterMs = 180_000): void {
  if (/captcha|human verification|verify you are human/i.test(reason)) {
    captchaDisabledEngines.add(engine);
    console.warn('[LEXARA Search Availability]', JSON.stringify({ engine, status: 'disabled-captcha' }));
  } else if (/429|rate.?limit|too many|unusual traffic/i.test(reason)) {
    engineCooldownUntil.set(engine, Math.max(engineCooldownUntil.get(engine) || 0, Date.now() + Math.max(180_000, retryAfterMs)));
    console.warn('[LEXARA Search Availability]', JSON.stringify({ engine, status: 'rate-limit-cooldown', retryAfterMs: Math.max(180_000, retryAfterMs) }));
  }
}

async function checkDiscoveryResponse(response: Response, engine: string | string[]): Promise<void> {
  if (response.ok) return;
  const retryAfter = response.headers?.get('retry-after');
  const retryAfterMs = retryAfter
    ? (/^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()))
    : 180_000;
  const detail = typeof response.text === 'function' ? (await response.text()).slice(0, 2000) : '';
  for (const name of Array.isArray(engine) ? engine : [engine]) {
    recordEngineFailure(name, `HTTP ${response.status} ${detail}`, Number.isFinite(retryAfterMs) ? retryAfterMs : 180_000);
  }
  throw new Error(`Discovery HTTP ${response.status}`);
}

async function withTimeout<T>(
  lane: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T | null> {
  if (!engineAvailable(lane)) return null;
  const controller = new AbortController();
  const relay = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', relay, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Lexara discovery timeout')), Math.max(250, timeoutMs));
  let acquired = false;
  try {
    while ((laneInFlight.get(lane) || 0) >= 2 && !controller.signal.aborted && engineAvailable(lane)) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (controller.signal.aborted || !engineAvailable(lane)) return null;
    laneInFlight.set(lane, (laneInFlight.get(lane) || 0) + 1);
    acquired = true;
    return await work(controller.signal);
  } catch (error) {
    recordEngineFailure(lane, error instanceof Error ? error.message : String(error));
    console.warn('[LEXARA Discovery]', JSON.stringify({ lane, outcome: controller.signal.aborted ? 'cancelled-or-timeout' : 'failed', error: error instanceof Error ? error.message : String(error), causeCode: (error as any)?.cause?.code || undefined }));
    return null;
  } finally {
    if (acquired) laneInFlight.set(lane, Math.max(0, (laneInFlight.get(lane) || 1) - 1));
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

export function mergeLegalMeshCandidateEvidence(existing: LegalMeshCandidate, incoming: LegalMeshCandidate): LegalMeshCandidate {
  const excerpts = [...new Set([existing.excerpt, incoming.excerpt].map(value => String(value || '').trim()).filter(Boolean))];
  return { ...existing, excerpt: excerpts.join('\n').slice(0, 4800) || undefined };
}

function fuseRankedCandidates(groups: readonly LegalMeshCandidate[][]): LegalMeshCandidate[] {
  const scores = new Map<string, number>();
  const byUrl = new Map<string, LegalMeshCandidate>();
  for (const group of groups) {
    group.forEach((item, index) => {
      const existing = byUrl.get(item.url);
      byUrl.set(item.url, existing ? mergeLegalMeshCandidateEvidence(existing, item) : item);
      scores.set(item.url, (scores.get(item.url) || 0) + 1 / (60 + index + 1));
    });
  }
  return [...byUrl.values()].sort((left, right) =>
    (scores.get(right.url) || 0) - (scores.get(left.url) || 0));
}

function diversify(items: LegalMeshCandidate[], limit = 16): LegalMeshCandidate[] {
  const merged = new Map<string, LegalMeshCandidate>();
  for (const item of items) {
    const existing = merged.get(item.url);
    merged.set(item.url, existing ? mergeLegalMeshCandidateEvidence(existing, item) : item);
  }
  const byUrl = [...merged.values()];
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

async function tavily(query: string, signal?: AbortSignal, budgetMs = 2_000): Promise<LegalMeshCandidate[]> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) return [];
  // Keep the actual objective and venue; research-hint prefixes can otherwise
  // consume the query limit before the user's question is reached.
  const objective = query.match(/\bQuestion(?:\/facts)?:\s*([\s\S]*)/i)?.[1];
  const venue = query.match(/\bJurisdiction(?:\/location)?:\s*([^\n.]{1,110})/i)?.[1];
  const searchQuery = (objective ? [venue, objective].filter(Boolean).join(' ') : query)
    .replace(/\s+/g, ' ').trim().slice(0, 399);
  const result = await withTimeout('tavily', budgetMs, signal, async requestSignal => {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST', signal: requestSignal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      // Tavily accepts search queries under 400 characters, not full legal prompts.
      body: JSON.stringify({ query: searchQuery, search_depth: 'basic', max_results: 10, include_answer: false, include_raw_content: false }),
    });
    await checkDiscoveryResponse(r, 'tavily');
    const j:any = await r.json();
    return (j.results || []).flatMap((x:any) => {
      const url=clean(x.url);
      return url ? [{url,title:String(x.title||'Tavily result'),excerpt:String(x.content||'').slice(0,1200),tier:3 as const,provider:'tavily'}] : [];
    });
  });
  return result || [];
}

async function duckDuckGoInstantAnswer(query: string, signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  const result=await withTimeout('duckDuckGoInstantAnswer', 1_500,signal,async requestSignal=>{
    const endpoint=new URL('https://api.duckduckgo.com/');
    endpoint.searchParams.set('q',query);
    endpoint.searchParams.set('format','json');
    endpoint.searchParams.set('no_html','1');
    endpoint.searchParams.set('no_redirect','1');
    const response=await fetch(endpoint,{signal:requestSignal,headers:{accept:'application/json'}});
    if(!response.ok) throw new Error(`Discovery HTTP ${response.status}`);
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

function lexaraSearxngBase(): string {
  return independentSearchBase(process.env.SEARXNG_URL)
    || (process.env.RAILWAY_ENVIRONMENT_ID === '91154a53-01a3-470c-8fdc-c0f13b4702fa'
      ? 'http://lexara-searxng.railway.internal:8080' : '');
}

async function searxng(query: string, signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  const base = lexaraSearxngBase();
  if (!base) return [];
  const result = await withTimeout('searxng', 2_200, signal, async requestSignal => {
    const engines = ['google cse', 'brave', 'bing'].filter(engineAvailable);
    if (!engines.length) return [];
    const endpoint = new URL('/search', base.endsWith('/') ? base : base + '/');
    endpoint.searchParams.set('q', query);
    endpoint.searchParams.set('format', 'json');
    endpoint.searchParams.set('safesearch', '0');
    endpoint.searchParams.set('engines', engines.join(','));
    const response = await fetch(endpoint, { signal: requestSignal, headers: { accept: 'application/json' } });
    await checkDiscoveryResponse(response, 'searxng');
    const payload:any = await response.json();
    for (const [engine, reason] of payload?.unresponsive_engines || []) recordEngineFailure(String(engine), String(reason));
    return (Array.isArray(payload?.results) ? payload.results : []).slice(0, 12).flatMap((item:any) => {
      const url=clean(item?.url || item?.link);
      return url ? [{url,title:String(item?.title||'SearXNG result'),excerpt:String(item?.content||item?.snippet||'').slice(0,1200),tier:3 as const,provider:'searxng'}] : [];
    });
  });
  return result || [];
}

// The production engine is independently hosted; no custom Railway variable is
// required. Explicit non-retired endpoints remain available for other installs.
function lexaraDdgsBase(): string {
  return independentSearchBase(process.env.DDGS_URL)
    || (process.env.RAILWAY_ENVIRONMENT_ID === '91154a53-01a3-470c-8fdc-c0f13b4702fa'
      ? 'http://lexara-ddgs.railway.internal:4479' : '');
}

async function ddgsBackend(query: string, backend: string, budgetMs: number, signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  const base = lexaraDdgsBase();
  if (!base) return [];
  const result = await withTimeout('ddgsBackend', budgetMs, signal, async requestSignal => {
    const endpoint = new URL('/search/text', base.endsWith('/') ? base : base + '/');
    const response = await fetch(endpoint, {
      method: 'POST', signal: requestSignal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query, max_results: 12, safesearch: 'off', backend }),
    });
    await checkDiscoveryResponse(response, ['ddgsBackend', ...backend.split(',')]);
    const payload:any = await response.json();
    return (Array.isArray(payload?.results) ? payload.results : []).slice(0, 12).flatMap((item:any) => {
      const url=clean(item?.href || item?.url || item?.link);
      return url ? [{url,title:String(item?.title||'DDGS result'),excerpt:String(item?.body||item?.snippet||'').slice(0,1200),tier:3 as const,provider:`ddgs:${backend}`}] : [];
    });
  });
  return result || [];
}

async function ddgs(query: string, signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  if (!lexaraDdgsBase()) return [];
  // Installed DDGS rejects Bing and silently substitutes auto. Allow only
  // supported backends so an invalid name cannot reopen excluded engines.
  const supported = new Set(['brave', 'google', 'grokipedia', 'mojeek', 'startpage', 'wikipedia', 'yahoo']);
  const permittedBackends = (value: string) => [...new Set(value.split(',').map(x=>x.trim() === 'auto' ? 'yahoo' : x.trim()).filter(x=>supported.has(x) && engineAvailable(x)))].join(',');
  const primary = permittedBackends(process.env.LEXARA_DDGS_BACKEND?.trim() || 'yahoo');
  const fallback = permittedBackends(process.env.LEXARA_DDGS_FALLBACK_BACKENDS?.trim() || '');
  if (!primary) return [];
  const first = await ddgsBackend(query, primary, 2_200, signal);
  return first.length || !fallback ? first : ddgsBackend(query, fallback, 900, signal);
}

function lexaraOpenserpBase(): string {
  return independentSearchBase(process.env.OPENSERP_URL)
    || (process.env.RAILWAY_ENVIRONMENT_ID === '91154a53-01a3-470c-8fdc-c0f13b4702fa'
      ? 'http://lexara-openserp.railway.internal:7000' : '');
}

async function openserp(query: string, signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  const base = lexaraOpenserpBase();
  if (!base) return [];
  const result = await withTimeout('openserp', 3_000, signal, async requestSignal => {
    const engines = ['baidu'].filter(engineAvailable);
    if (!engines.length) return [];
    const endpoint = new URL('/mega/search', base.endsWith('/') ? base : base + '/');
    endpoint.searchParams.set('text', query);
    endpoint.searchParams.set('limit', '12');
    endpoint.searchParams.set('mode', 'balanced');
    endpoint.searchParams.set('engines', engines.join(','));
    const response = await fetch(endpoint, { signal: requestSignal, headers: { accept: 'application/json' } });
    await checkDiscoveryResponse(response, 'openserp');
    const payload:any = await response.json();
    for (const failure of payload?.meta?.engine_errors || []) recordEngineFailure(String(failure.engine), String(failure.error));
    const rows = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload?.data?.results) ? payload.data.results : [];
    if (Array.isArray(payload?.meta?.engines_failed) && payload.meta.engines_failed.length) {
      console.info('[LEXARA OpenSERP Coverage]', JSON.stringify({
        responded: payload.meta.engines_responded || [],
        failed: payload.meta.engines_failed,
        errors: (payload.meta.engine_errors || []).map((item:any) => ({ engine: item.engine, error: item.error })),
      }));
    }
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
  const result=await withTimeout('serpApi', 2_500,signal,async requestSignal=>{
    const endpoint=new URL('https://serpapi.com/search.json');
    endpoint.searchParams.set('engine','google'); endpoint.searchParams.set('q',query);
    endpoint.searchParams.set('api_key',key); endpoint.searchParams.set('num','10');
    const response=await fetch(endpoint,{signal:requestSignal}); if(!response.ok) throw new Error(`Discovery HTTP ${response.status}`);
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
  const result=await withTimeout('scrapingBee', 2_500,signal,async requestSignal=>{
    const google=`https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`;
    const endpoint=new URL('https://app.scrapingbee.com/api/v1/');
    endpoint.searchParams.set('api_key',key); endpoint.searchParams.set('url',google); endpoint.searchParams.set('render_js','false');
    const response=await fetch(endpoint,{signal:requestSignal}); if(!response.ok) throw new Error(`Discovery HTTP ${response.status}`);
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
  const result=await withTimeout('commonCrawl', 2_500,signal,async requestSignal=>{
    const collections=await fetch('https://index.commoncrawl.org/collinfo.json',{signal:requestSignal,headers:{accept:'application/json','user-agent':'LegalWhat-Lexara/1.0'}});
    if(!collections.ok) return [];
    const data:any[]=await collections.json(); const indexApi=String(data?.[0]?.['cdx-api']||'');
    if(!/^https?:\/\//i.test(indexApi)) return [];
    const groups=await Promise.all(hosts.map(async host=>{
      const endpoint=new URL(indexApi); endpoint.searchParams.set('url',`${host}/*`);
      endpoint.searchParams.set('matchType','domain'); endpoint.searchParams.set('output','json');
      endpoint.searchParams.set('filter','status:200'); endpoint.searchParams.set('limit','8');
      const response=await fetch(endpoint,{signal:requestSignal,headers:{accept:'application/x-ndjson,text/plain','user-agent':'LegalWhat-Lexara/1.0'}});
      if(!response.ok) throw new Error(`Discovery HTTP ${response.status}`);
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
  _firstUseful = false,
  officialFormQuery = false,
): Promise<LegalMeshCandidate[]> {
  // Discovery URLs are leads, not verified answers. Preserve every bounded
  // provider result; only the investigator's evidence gate may end research.
  const controller = new AbortController();
  const relayAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', relayAbort, { once: true });
  try {
    const outcomes = await Promise.allSettled([
      tavily(query, controller.signal, officialFormQuery ? 5_000 : 2_000),
      duckDuckGoInstantAnswer(query, controller.signal),
      searxng(query, controller.signal),
      ddgs(query, controller.signal),
      openserp(query, controller.signal),
    ]);
    if (signal?.aborted) throw signal.reason || new DOMException('Discovery cancelled', 'AbortError');
    const enabled = [Boolean(process.env.TAVILY_API_KEY?.trim()), true, Boolean(lexaraSearxngBase()), Boolean(lexaraDdgsBase()), Boolean(lexaraOpenserpBase())];
    console.info('[LEXARA Discovery Lanes]', JSON.stringify({ results: outcomes.map((outcome, index) => ({ lane: ['tavily', 'duckduckgo-instant-answer', 'searxng', 'ddgs', 'openserp'][index], enabled: enabled[index], candidates: outcome.status === 'fulfilled' ? outcome.value.length : 0, settled: outcome.status })) }));
    return fuseRankedCandidates(outcomes.flatMap(outcome =>
      outcome.status === 'fulfilled' ? [outcome.value] : []));
  } finally {
    signal?.removeEventListener('abort', relayAbort);
  }
}

async function firstUsefulSearchVariants(
  queries: readonly string[],
  signal?: AbortSignal,
): Promise<LegalMeshCandidate[]> {
  const outcomes = await Promise.allSettled(queries.map(query => freeSearch(query, signal)));
  if (signal?.aborted) throw signal.reason || new DOMException('Discovery cancelled', 'AbortError');
  return fuseRankedCandidates(outcomes.flatMap(outcome =>
    outcome.status === 'fulfilled' ? [outcome.value] : []));
}

async function firstUsefulParallelSearch(
  queries: readonly string[],
  seen: ReadonlySet<string>,
  providerPrefix: 'supplemental' | 'planned',
  signal?: AbortSignal,
  _providerFirstUseful = false,
): Promise<LegalMeshCandidate[]> {
  const results = await firstUsefulSearchVariants(queries, signal);
  return diversify(results
    .filter(item => !seen.has(item.url))
    .map(item => ({ ...item, tier: 5 as const, provider: `${providerPrefix}-${item.provider}` })), 12);
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
  const variants=options.officialFormQuery ? [query, `${query} site:.gov`] : buildLexaraSourceQueries({
    query,
    subject:options.subject,
    requestedFact:options.requestedFact,
    categories:options.categories,
    jurisdiction:options.jurisdiction,
  });
  // Stored patterns contain prior user wording, not reusable templates. Reuse
  // only curated source-family hints so names/instructions cannot cross turns.
  if(!options.officialFormQuery && learnedPatterns[0]) {
    const hint = getLexaraSourceQueryHints(options.categories || []).find(value => learnedPatterns[0].includes(value));
    if (hint) variants.push(`${query} ${hint}`);
  }
  const uniqueVariants=[...new Set(variants)].slice(0,options.firstUseful ? 2 : 6);
  const groups=options.firstUseful
    ? [await firstUsefulSearchVariants(uniqueVariants,signal)]
    : await Promise.all(uniqueVariants.map(variant=>freeSearch(variant,signal,false,options.officialFormQuery)));
  const learnedSources=await Promise.race([
    getLexaraLearnedSources(options.categories||[],options.jurisdiction,8),
    new Promise<string[]>(resolve=>setTimeout(()=>resolve([]),75)),
  ]);
  const learnedCandidates=learnedSources.map(url=>({url,title:'Previously successful Lexara source',tier:3 as const,provider:'lexara-learned'}));
  const combined=[...fuseRankedCandidates(groups),...(options.officialFormQuery ? [] : learnedCandidates)];
  if (options.officialFormQuery) {
    const generic = new Set(['what','which','current','official','form','forms','must','used','start','case','court','county','local','required','there','does','have','from','with','filing','document','answer','briefly']);
    const tokens = [...new Set(query.toLowerCase().match(/[a-z0-9]+/g) || [])].filter(word => word.length > 3 && !generic.has(word));
    const score = (item: LegalMeshCandidate) => {
      const words = new Set((item.title + ' ' + (item.excerpt || '') + ' ' + item.url).toLowerCase().match(/[a-z0-9]+/g) || []);
      const overlap = tokens.filter(word => words.has(word)).length;
      return overlap * 3 + (isPreferredOfficialCandidate(item, options) ? 2 : 0);
    };
    return combined.sort((a,b) => score(b)-score(a)).slice(0,18);
  }
  // Subject relevance precedes domain authority: generic government roots are
  // fallback leads, not evidence about this person. This only orders retrieval;
  // the investigator still applies the unchanged identity and evidence gates.
  const tokens = String(options.subject || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  const subjectRelevance = (item: LegalMeshCandidate): number => {
    if (tokens.length < 2) return 0;
    const words = new Set((item.title + ' ' + (item.excerpt || '') + ' ' + item.url).toLowerCase().match(/[a-z0-9]+/g) || []);
    if (!words.has(tokens[0]) || !words.has(tokens[tokens.length - 1])) return 0;
    return tokens.every(token => words.has(token)) ? 2 : 1;
  };
  const exact = diversify(combined.filter(item => subjectRelevance(item) === 2), 18);
  const partial = diversify(combined.filter(item => subjectRelevance(item) === 1), 18);
  const relevantUrls = new Set([...exact, ...partial].map(item => item.url));
  const unmatched = combined.filter(item => !relevantUrls.has(item.url));
  const preferred=diversify(unmatched.filter(item => isPreferredOfficialCandidate(item, options)), 8);
  const preferredUrls = new Set(preferred.map(item => item.url));
  const remainder = diversify(unmatched.filter(item => !preferredUrls.has(item.url)), 18);
  return [...exact, ...partial, ...preferred, ...remainder].slice(0, 18);
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
      getLexaraSourceQueryHints(options.categories || []).slice(0, 2).map(hint=>`${query} ${hint}`),
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
  const planned=options.allowClaudePlanning === false
    ? { queries: [], providers: [] }
    : await planLexaraResearchQueries(query,{
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
