import { TavilyBudget } from './TavilyBudget';
import { discoveryFetch, discoverySignal } from './DiscoveryDiagnostics';
import { beginDiscoveryAttempt, discoveryErrorType, getDiscoveryDiagnostics, markDiscoveryPartial } from './DiscoveryDiagnostics';
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
  // Live discovery takes the first useful leads. The investigator still verifies
  // sources, and switches to comprehensive discovery when those leads are weak.
  firstUseful?: boolean;
  /** Legal-primary-text mode: do not cancel other engines on a generic web hit. */
  strictLegalSource?: boolean;
  officialFormQuery?: boolean;
  // Native-only callers retain every source lane without buying alternate
  // query suggestions. Existing callers keep the conditional planner.
  allowClaudePlanning?: boolean;
  // A caller with its own bounded query waves must retain its contact clues
  // and source objectives instead of expanding the same subject again.
  queryAlreadyPlanned?: boolean;
  /** Call-site budget guard: skip SerpApi and ScrapingBee when explicitly disabled. */
  allowPaidSearch?: boolean;
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
const laneQueued = new Map<string, number>();
const laneFailures = new Map<string, number>();

const discoveryError = (code: string) => Object.assign(new Error('Discovery request unavailable'), { code });

function skippedProvider(lane: string, code = 'DISCOVERY_UNAVAILABLE'): LegalMeshCandidate[] {
  beginDiscoveryAttempt(lane)('skipped', discoveryError(code));
  return [];
}

function recordProviderFailure(lane: string, error: unknown): void {
  const category = discoveryErrorType(error);
  const failures = (laneFailures.get(lane) || 0) + 1;
  laneFailures.set(lane, failures);
  const unavailable = category === 'dns' || category === 'connection' || category === 'http-404';
  const credentials = category === 'http-401' || category === 'http-403';
  const billing = category === 'http-402' || category === 'http-432' || category === 'http-433';
  const transient = category === 'timeout' || category === 'invalid-response'
    || category === 'upstream-error' || /^http-5\d\d$/.test(category);
  if (unavailable || credentials || billing || (transient && failures >= 2)) {
    const retryAfterMs = credentials || billing ? 24 * 60 * 60_000 : 30_000;
    engineCooldownUntil.set(lane, Math.max(engineCooldownUntil.get(lane) || 0, Date.now() + retryAfterMs));
    console.warn('[LEXARA Search Availability]', JSON.stringify({ lane, status: 'provider-cooldown', category, retryAfterMs }));
  }
}

function engineAvailable(engine: string): boolean {
  return !captchaDisabledEngines.has(engine) && (engineCooldownUntil.get(engine) || 0) <= Date.now();
}

function recordEngineFailure(engine: string, reason: string, retryAfterMs = 180_000): void {
  if (/captcha|human verification|verify you are human/i.test(reason)) {
    captchaDisabledEngines.add(engine);
    console.warn('[LEXARA Search Availability]', JSON.stringify({ engine, status: 'disabled-captcha' }));
  } else if (/HTTP\s+(?:402|43[23])\b|payment\s+required|insufficient\s+(?:credit|quota)|plan\s+limit\s+exceeded/i.test(reason)) {
    const budgetCooldownMs = Math.max(6 * 60 * 60_000, retryAfterMs);
    engineCooldownUntil.set(engine, Math.max(engineCooldownUntil.get(engine) || 0, Date.now() + budgetCooldownMs));
    console.warn('[LEXARA Search Availability]', JSON.stringify({ engine, status: 'plan-limit-cooldown', retryAfterMs: budgetCooldownMs }));
  } else if (/429|rate.?limit|too many|unusual traffic/i.test(reason)) {
    const cooldownMs = Math.max(engine === 'brave' ? 60 * 60_000 : 180_000, retryAfterMs);
    engineCooldownUntil.set(engine, Math.max(engineCooldownUntil.get(engine) || 0, Date.now() + cooldownMs));
    console.warn('[LEXARA Search Availability]', JSON.stringify({ engine, status: 'rate-limit-cooldown', retryAfterMs: cooldownMs }));
  }
}

async function boundedProviderError(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let remaining = 2_000;
  let text = '';
  try {
    while (remaining > 0) {
      const { value, done } = await reader.read();
      if (done) break;
      const part = value.subarray(0, remaining);
      remaining -= part.byteLength;
      text += decoder.decode(part, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function checkDiscoveryResponse(response: Response, engine: string | string[]): Promise<void> {
  if (response.ok) return;
  const retryAfter = response.headers?.get('retry-after');
  const retryAfterMs = retryAfter
    ? (/^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()))
    : 180_000;
  // Record the quota response before attempting to read its optional body.
  // A stalled/erroring body must not erase a provider's Retry-After instruction.
  for (const name of Array.isArray(engine) ? engine : [engine]) {
    recordEngineFailure(name, `HTTP ${response.status}`, Number.isFinite(retryAfterMs) ? retryAfterMs : 180_000);
  }
  if ([401, 402, 403, 429, 432, 433].includes(response.status)) {
    if (response.body) void response.body.cancel().catch(() => undefined);
    throw new Error(`Discovery HTTP ${response.status}`);
  }
  const detail = await boundedProviderError(response).catch(() => '');
  for (const name of Array.isArray(engine) ? engine : [engine]) {
    recordEngineFailure(name, `HTTP ${response.status} ${detail}`, Number.isFinite(retryAfterMs) ? retryAfterMs : 180_000);
  }
  throw new Error(`Discovery HTTP ${response.status}`);
}

async function readDiscoveryJson(response: Response, engine: string | string[]): Promise<any> {
  await checkDiscoveryResponse(response, engine);
  // A challenge/error page served as HTTP 200 is not an empty search result.
  if (/text\/html/i.test(response.headers?.get('content-type') || '')) {
    const detail = await boundedProviderError(response);
    for (const name of Array.isArray(engine) ? engine : [engine]) recordEngineFailure(name, detail);
    throw new SyntaxError('Discovery expected JSON');
  }
  const payload = await response.json();
  if (!payload || typeof payload !== 'object') throw new SyntaxError('Discovery expected an object');
  return payload;
}

function discoveryRows(payload: any, key = 'results'): any[] {
  if (!Array.isArray(payload?.[key])) throw new SyntaxError('Discovery results missing');
  return payload[key];
}

const tavilyBudget = new TavilyBudget(async (key, signal) => readDiscoveryJson(
  await fetch('https://api.tavily.com/usage', {
    signal, headers: { accept: 'application/json', authorization: `Bearer ${key}` },
  }), 'tavily',
));

async function withTimeout<T>(
  lane: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T | null> {
  signal = discoverySignal(signal);
  const finish = beginDiscoveryAttempt(lane);
  if (signal?.aborted) { finish('cancelled'); return null; }
  if (!engineAvailable(lane)) { finish('skipped', discoveryError(captchaDisabledEngines.has(lane) ? 'DISCOVERY_DISABLED' : 'DISCOVERY_COOLDOWN')); return null; }
  // Queue admission and HTTP share one elapsed-time budget. Keep the bounded
  // queue and outage cooldowns without adding a second deadline to live turns.
  const deadline = Date.now() + Math.max(250, timeoutMs);
  if ((laneQueued.get(lane) || 0) >= 16) {
    finish('skipped', discoveryError('DISCOVERY_QUEUE_FULL')); return null;
  }
  laneQueued.set(lane, (laneQueued.get(lane) || 0) + 1);
  const queueDeadline = Math.min(deadline, Date.now() + 2_000);
  let waitedForAdmission = false;
  try {
    // After an outage, admit one recovery probe before restoring parallel work.
    while ((laneInFlight.get(lane) || 0) >= ((laneFailures.get(lane) || 0) > 0 ? 1 : 2)) {
      waitedForAdmission = true;
      if (signal?.aborted) { finish('cancelled'); return null; }
      if (!engineAvailable(lane)) { finish('skipped', discoveryError(captchaDisabledEngines.has(lane) ? 'DISCOVERY_DISABLED' : 'DISCOVERY_COOLDOWN')); return null; }
      if (Date.now() >= queueDeadline) { finish('skipped', discoveryError('DISCOVERY_QUEUE_TIMEOUT')); return null; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  } finally {
    laneQueued.set(lane, Math.max(0, (laneQueued.get(lane) || 1) - 1));
  }
  if (signal?.aborted) { finish('cancelled'); return null; }
  if (!engineAvailable(lane)) { finish('skipped', discoveryError(captchaDisabledEngines.has(lane) ? 'DISCOVERY_DISABLED' : 'DISCOVERY_COOLDOWN')); return null; }
  if (Date.now() >= deadline) { finish('skipped', discoveryError('DISCOVERY_QUEUE_TIMEOUT')); return null; }
  laneInFlight.set(lane, (laneInFlight.get(lane) || 0) + 1);
  finish.dispatch();
  const controller = new AbortController();
  const relay = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', relay, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) timedOut = true;
    controller.abort(new Error('Lexara discovery timeout'));
  }, Math.max(1, deadline - Date.now()));
  try {
    const result = await work(controller.signal);
    finish(controller.signal.aborted ? (timedOut ? 'timeout' : 'cancelled')
      : Array.isArray(result) && result.length === 0 ? 'empty' : 'ok');
    if (!controller.signal.aborted) laneFailures.delete(lane);
    return controller.signal.aborted ? null : result;
  } catch (error) {
    if (!controller.signal.aborted && ['provider-unavailable', 'quota-exhausted', 'budget-unavailable', 'local-rate-limit'].includes(discoveryErrorType(error))) {
      finish('skipped', error); return null;
    }
    recordEngineFailure(lane, error instanceof Error ? error.message : String(error));
    if (!controller.signal.aborted || (timedOut && !waitedForAdmission)) recordProviderFailure(lane,
      timedOut ? Object.assign(new Error('Discovery timeout'), { name: 'TimeoutError' }) : error);
    finish(controller.signal.aborted ? (timedOut ? 'timeout' : 'cancelled') : 'failed', error);
    return null;
  } finally {
    laneInFlight.set(lane, Math.max(0, (laneInFlight.get(lane) || 1) - 1));
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
  if (!key) return skippedProvider('tavily', 'DISCOVERY_NOT_CONFIGURED');
  // Keep the actual objective and venue; research-hint prefixes can otherwise
  // consume the query limit before the user's question is reached.
  const objective = query.match(/\bQuestion(?:\/facts)?:\s*([\s\S]*)/i)?.[1];
  const venue = query.match(/\bJurisdiction(?:\/location)?:\s*([^\n.]{1,110})/i)?.[1];
  const searchQuery = (objective ? [venue, objective].filter(Boolean).join(' ') : query)
    .replace(/\s+/g, ' ').trim().slice(0, 399);
  const result = await withTimeout('tavily', budgetMs, signal, async requestSignal => {
    const admission = await tavilyBudget.reserve(key, requestSignal);
    if (admission !== 'allowed') throw discoveryError({
      'quota-exhausted': 'DISCOVERY_QUOTA_EXHAUSTED',
      'budget-unavailable': 'DISCOVERY_BUDGET_UNAVAILABLE',
      'rate-limit': 'DISCOVERY_LOCAL_RATE_LIMIT',
    }[admission]);
    const r = await discoveryFetch(fetch, 'https://api.tavily.com/search', {
      method: 'POST', signal: requestSignal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      // Tavily accepts search queries under 400 characters, not full legal prompts.
      body: JSON.stringify({ query: searchQuery, search_depth: 'basic', auto_parameters: false, max_results: 10, include_answer: false, include_raw_content: false }),
    });
    const j:any = await readDiscoveryJson(r, 'tavily');
    return discoveryRows(j).flatMap((x:any) => {
      const url=clean(x?.url);
      return url ? [{url,title:String(x?.title||'Tavily result'),excerpt:String(x?.content||'').slice(0,1200),tier:3 as const,provider:'tavily'}] : [];
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
    const response=await discoveryFetch(fetch, endpoint,{signal:requestSignal,headers:{accept:'application/json'}});
    const payload:any=await readDiscoveryJson(response, 'duckDuckGoInstantAnswer');
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
  return (process.env.LEXARA_EMBEDDED_SEARCH === 'true' ? 'http://127.0.0.1:18080' : '')
    || independentSearchBase(process.env.SEARXNG_URL)
    || (process.env.RAILWAY_ENVIRONMENT_ID === '91154a53-01a3-470c-8fdc-c0f13b4702fa'
      ? 'http://lexara-searxng.railway.internal:8080' : '');
}

async function searxng(query: string, signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  const base = lexaraSearxngBase();
  if (!base) return skippedProvider('searxng', 'DISCOVERY_NOT_CONFIGURED');
  // The public Brave web endpoint rejects this Railway origin with 429s.
  // Keep it available by explicit override, but do not send routine queries
  // to a known-blocked upstream. The other existing engines remain active.
  const supported = new Set(['google cse', 'bing', 'yahoo', 'brave']);
  const engines = [...new Set((process.env.LEXARA_SEARXNG_ENGINES
    ?? 'google cse,bing,yahoo').split(',').map(value => value.trim())
    .filter(value => supported.has(value) && engineAvailable(value)))];
  if (!engines.length) return skippedProvider('searxng');
  const result = await withTimeout('searxng', 2_200, signal, async requestSignal => {
    const activeEngines = engines.filter(engineAvailable);
    if (!activeEngines.length) throw discoveryError('DISCOVERY_UNAVAILABLE');
    const endpoint = new URL('/search', base.endsWith('/') ? base : base + '/');
    endpoint.searchParams.set('q', query);
    endpoint.searchParams.set('format', 'json');
    endpoint.searchParams.set('safesearch', '0');
    endpoint.searchParams.set('engines', activeEngines.join(','));
    const response = await discoveryFetch(fetch, endpoint, { signal: requestSignal, headers: { accept: 'application/json' } });
    const payload:any = await readDiscoveryJson(response, 'searxng');
    const failures = Array.isArray(payload?.unresponsive_engines) ? payload.unresponsive_engines : [];
    for (const failure of failures) if (Array.isArray(failure) && engines.includes(failure[0])) recordEngineFailure(String(failure[0]), String(failure[1]));
    const rows = discoveryRows(payload);
    if (!rows.length && failures.length) throw discoveryError('DISCOVERY_PROVIDER_ERROR');
    if (failures.length) markDiscoveryPartial('searxng');
    return rows.slice(0, 12).flatMap((item:any) => {
      const url=clean(item?.url || item?.link);
      return url ? [{url,title:String(item?.title||'SearXNG result'),excerpt:String(item?.content||item?.snippet||'').slice(0,1200),tier:3 as const,provider:'searxng'}] : [];
    });
  });
  return result || [];
}

// The production engine is independently hosted; no custom Railway variable is
// required. Explicit non-retired endpoints remain available for other installs.
function lexaraDdgsBase(): string {
  return (process.env.LEXARA_EMBEDDED_SEARCH === 'true' ? 'http://127.0.0.1:14479' : '')
    || independentSearchBase(process.env.DDGS_URL)
    || (process.env.RAILWAY_ENVIRONMENT_ID === '91154a53-01a3-470c-8fdc-c0f13b4702fa'
      ? 'http://lexara-ddgs.railway.internal:4479' : '');
}

async function ddgsBackend(query: string, backend: string, budgetMs: number, signal?: AbortSignal,
  lane='ddgsBackend'): Promise<LegalMeshCandidate[]> {
  const base = lexaraDdgsBase();
  if (!base) return skippedProvider('ddgsBackend', 'DISCOVERY_NOT_CONFIGURED');
  const result = await withTimeout(lane, budgetMs, signal, async requestSignal => {
    const activeBackend = backend.split(',').filter(engineAvailable).join(',');
    if (!activeBackend) throw discoveryError('DISCOVERY_UNAVAILABLE');
    const endpoint = new URL('/search/text', base.endsWith('/') ? base : base + '/');
    const init = {
      method: 'POST', signal: requestSignal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query, max_results: 12, safesearch: 'off', backend: activeBackend }),
    };
    let response = await discoveryFetch(fetch, endpoint, init);
    // DDGS 9.16.0 maps an empty backend result to HTTP 500. This is not a
    // transient server crash: retrying the SAME query only doubles traffic.
    // Treat that one backend as empty and allow the independent alternatives.
    if (response.status === 500) {
      const detail = await boundedProviderError(response).catch(() => '');
      if (/Search failed:\s*No results found\./i.test(detail)) return [];
      throw new Error('Discovery HTTP 500');
    }
    const payload:any = await readDiscoveryJson(response, ['ddgsBackend', ...activeBackend.split(',')]);
    return discoveryRows(payload).slice(0, 12).flatMap((item:any) => {
      const url=clean(item?.href || item?.url || item?.link);
      return url ? [{url,title:String(item?.title||'DDGS result'),excerpt:String(item?.body||item?.snippet||'').slice(0,1200),tier:3 as const,provider:`ddgs:${activeBackend}`}] : [];
    });
  });
  return result || [];
}

async function ddgs(query: string, signal?: AbortSignal, officialFormQuery = false): Promise<LegalMeshCandidate[]> {
  if (!lexaraDdgsBase()) return skippedProvider('ddgsBackend', 'DISCOVERY_NOT_CONFIGURED');
  // Installed DDGS rejects Bing and silently substitutes auto. Allow only
  // supported backends so an invalid name cannot reopen excluded engines.
  const supported = new Set(['brave', 'google', 'grokipedia', 'mojeek', 'startpage', 'wikipedia', 'yahoo']);
  const permittedBackends = (value: string) => [...new Set(value.split(',').map(x=>x.trim() === 'auto' ? 'yahoo' : x.trim()).filter(x=>supported.has(x) && engineAvailable(x)))].join(',');
  const configuredPrimary = process.env.LEXARA_DDGS_BACKEND?.trim() || 'yahoo';
  // Court-form searches benefit from real web search, not encyclopedia-only
  // backends, and may take longer than ordinary conversational lookup.
  const primary = permittedBackends(officialFormQuery
    ? 'google,' + configuredPrimary
    : process.env.LEXARA_EMBEDDED_SEARCH === 'true'
      ? 'wikipedia,grokipedia,' + configuredPrimary : configuredPrimary);
  const fallback = permittedBackends(process.env.LEXARA_DDGS_FALLBACK_BACKENDS?.trim()
    || (officialFormQuery ? 'mojeek,startpage' : ''));
  if (!primary) return skippedProvider('ddgsBackend');
  // DDGS can drop valid results when several backends share one request and
  // one engine returns HTTP 500. Isolate each engine's timeout and cooldown;
  // retain successful results even when sibling engines are unavailable.
  const firstEngines=primary.split(',').filter(Boolean);
  const first=await Promise.all(firstEngines.map(engine=>ddgsBackend(query,engine,
    officialFormQuery ? 6_500 : (laneFailures.get('ddgsBackend:'+engine)||0)>0 ? 1_500 : 2_200,
    signal,'ddgsBackend:'+engine)));
  const found=fuseRankedCandidates(first);
  if(found.length || !fallback || signal?.aborted) return found;
  const fallbackEngines=fallback.split(',').filter(engine=>engine && !firstEngines.includes(engine));
  const recovered=await Promise.all(fallbackEngines.map(engine=>ddgsBackend(query,engine,
    officialFormQuery ? 4_000 : 900,signal,'ddgsBackend:'+engine)));
  return fuseRankedCandidates(recovered);
}

function lexaraOpenserpBase(): string {
  return (process.env.LEXARA_EMBEDDED_SEARCH === 'true' ? 'http://127.0.0.1:17000' : '')
    || independentSearchBase(process.env.OPENSERP_URL)
    || (process.env.RAILWAY_ENVIRONMENT_ID === '91154a53-01a3-470c-8fdc-c0f13b4702fa'
      ? 'http://lexara-openserp.railway.internal:7000' : '');
}

async function openserp(query: string, signal?: AbortSignal, officialFormQuery = false): Promise<LegalMeshCandidate[]> {
  const base = lexaraOpenserpBase();
  if (!base) return skippedProvider('openserp', 'DISCOVERY_NOT_CONFIGURED');
  const engines = [...new Set((process.env.LEXARA_OPENSERP_ENGINES
    || (officialFormQuery ? 'google,ecosia' : 'google'))
    .split(',').map(value => value.trim()).filter(value =>
      ['bing', 'google', 'baidu', 'ecosia', 'yandex', 'duckduckgo'].includes(value) && engineAvailable(value)))];
  if (!engines.length) return skippedProvider('openserp');
  const result = await withTimeout('openserp', officialFormQuery ? 16_000 : 8_000, signal, async requestSignal => {
    const activeEngines = engines.filter(engineAvailable);
    if (!activeEngines.length) throw discoveryError('DISCOVERY_UNAVAILABLE');
    const endpoint = new URL('/mega/search', base.endsWith('/') ? base : base + '/');
    endpoint.searchParams.set('text', query);
    endpoint.searchParams.set('limit', '12');
    endpoint.searchParams.set('mode', officialFormQuery ? 'fast' : 'balanced');
    endpoint.searchParams.set('engines', activeEngines.join(','));
    let response = await discoveryFetch(fetch, endpoint, { signal: requestSignal, headers: { accept: 'application/json' } });
    // A 200 response that reports failed engines and no results is also a
    // failed search, not evidence that no official form exists.
    let payload:any;
    let needsAlternative=response.status>=500;
    if(response.ok){
      payload=await readDiscoveryJson(response,'openserp');
      // Retain failures from the first attempted engines before the fallback
      // replaces the response. Otherwise CAPTCHA/rate-limit exclusions are
      // silently lost and the bad upstream is queried again next turn.
      const firstFailures=Array.isArray(payload?.meta?.engine_errors) ? payload.meta.engine_errors : [];
      for (const failure of firstFailures) if (activeEngines.includes(failure?.engine))
        recordEngineFailure(String(failure.engine), String(failure.error));
      const initialRows=Array.isArray(payload?.results)?payload.results:payload?.data?.results;
      needsAlternative=Array.isArray(initialRows) && initialRows.length===0
        && (Array.isArray(payload?.meta?.engines_failed) && payload.meta.engines_failed.length>0
          || Array.isArray(payload?.meta?.engine_errors) && payload.meta.engine_errors.length>0);
    }
    if(needsAlternative && !requestSignal.aborted){
      if(response.body) await response.body.cancel().catch(()=>undefined);
      // Only probe engines that were not already tried. Baidu's persistent
      // parser failures cannot be repaired by repeating an identical request.
      const alternatives=(officialFormQuery ? ['bing','yandex'] : ['ecosia','bing'])
        .filter(engine=>!activeEngines.includes(engine) && engineAvailable(engine));
      if(alternatives.length){
        endpoint.searchParams.set('mode','any');
        endpoint.searchParams.set('engines',alternatives.join(','));
        response=await discoveryFetch(fetch,endpoint,{
          signal:requestSignal,headers:{accept:'application/json'},
        });
        payload=undefined;
      }
    }
    if(!payload) payload=await readDiscoveryJson(response,'openserp');
    const failures = Array.isArray(payload?.meta?.engine_errors) ? payload.meta.engine_errors : [];
    const requestedEngines=(endpoint.searchParams.get('engines')||'').split(',');
    for (const failure of failures) if (requestedEngines.includes(failure?.engine)) recordEngineFailure(String(failure.engine), String(failure.error));
    const rows = discoveryRows(Array.isArray(payload?.results) ? payload : payload?.data);
    if (Array.isArray(payload?.meta?.engines_failed) && payload.meta.engines_failed.length) {
      console.info('[LEXARA OpenSERP Coverage]', JSON.stringify({
        respondedCount: Array.isArray(payload.meta.engines_responded) ? payload.meta.engines_responded.length : 0,
        failedCount: payload.meta.engines_failed.length,
      }));
      if (!rows.length) throw discoveryError('DISCOVERY_PROVIDER_ERROR');
      markDiscoveryPartial('openserp');
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
  if(!key) return skippedProvider('serpApi', 'DISCOVERY_NOT_CONFIGURED');
  const seen=new Set(existingUrls);
  const result=await withTimeout('serpApi', 2_500,signal,async requestSignal=>{
    const endpoint=new URL('https://serpapi.com/search.json');
    endpoint.searchParams.set('engine','google'); endpoint.searchParams.set('q',query);
    endpoint.searchParams.set('api_key',key); endpoint.searchParams.set('num','10');
    const response=await discoveryFetch(fetch, endpoint,{signal:requestSignal});
    const payload:any=await readDiscoveryJson(response, 'serpApi');
    // SerpAPI's documented successful empty result also contains an error
    // string. Use its structured status, never text-match a raw error message.
    if (payload.search_metadata?.status === 'Success'
      && payload.search_information?.organic_results_state === 'Fully empty'
      && (!Array.isArray(payload.organic_results) || !payload.organic_results.length)) return [];
    if (payload.error) throw discoveryError('DISCOVERY_PROVIDER_ERROR');
    const rows = discoveryRows(payload, 'organic_results');
    return rows.flatMap((item:any)=>{
      const url=clean(item?.link); return url && !seen.has(url)
        ? [{url,title:String(item?.title||'SerpAPI result'),excerpt:String(item?.snippet||'').slice(0,1200),tier:5 as const,provider:'serpapi'}] : [];
    }).slice(0,10);
  });
  return result||[];
}

async function scrapingBee(query: string, existingUrls: readonly string[], signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  const key=process.env.SCRAPINGBEE_API_KEY?.trim(); if(!key) return skippedProvider('scrapingBee', 'DISCOVERY_NOT_CONFIGURED');
  const seen=new Set(existingUrls);
  const result=await withTimeout('scrapingBee', 2_500,signal,async requestSignal=>{
    const endpoint=new URL('https://app.scrapingbee.com/api/v1/google');
    endpoint.searchParams.set('search',query);
    const response=await discoveryFetch(fetch, endpoint,{signal:requestSignal,headers:{accept:'application/json',authorization:`Bearer ${key}`}});
    const payload:any=await readDiscoveryJson(response, 'scrapingBee');
    return discoveryRows(payload, 'organic_results').flatMap((item:any)=>{
      const url=clean(item?.url); return url && !seen.has(url)
        ? [{url,title:String(item?.title||'ScrapingBee result'),excerpt:String(item?.description||'').slice(0,1200),tier:5 as const,provider:'scrapingbee'}] : [];
    }).slice(0,10);
  });
  return result||[];
}

function commonCrawlUseful(query: string, categories: readonly LexaraSourceCategory[] = []): boolean {
  return categories.includes('news-history') || /\b(?:histor(?:y|ic|ical)?|archive|archived|former|formerly|previous|old|past|prior)\b/i.test(query);
}

async function commonCrawl(query: string, existingUrls: readonly string[], options: LegalMeshSearchOptions, signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  if (!commonCrawlUseful(query, options.categories) || !existingUrls.length) return [];
  const hosts=[...new Set(existingUrls.flatMap(raw=>{try{return [new URL(raw).hostname];}catch{return [];}}))].slice(0,3);
  if(!hosts.length) return [];
  const result=await withTimeout('commonCrawl', 2_500,signal,async requestSignal=>{
    const collections=await discoveryFetch(fetch, 'https://index.commoncrawl.org/collinfo.json',{signal:requestSignal,headers:{accept:'application/json','user-agent':'LegalWhat-Lexara/1.0'}});
    const data:any[]=await readDiscoveryJson(collections, 'commonCrawl');
    if (!Array.isArray(data)) throw new SyntaxError('Discovery collections missing');
    const indexApi=String(data?.[0]?.['cdx-api']||'');
    if(!/^https:\/\/index\.commoncrawl\.org\//i.test(indexApi)) throw new SyntaxError('Discovery collection endpoint invalid');
    let malformedRows = false;
    const groups=await Promise.allSettled(hosts.map(async host=>{
      const endpoint=new URL(indexApi); endpoint.searchParams.set('url',`${host}/*`);
      endpoint.searchParams.set('matchType','domain'); endpoint.searchParams.set('output','json');
      endpoint.searchParams.set('filter','status:200'); endpoint.searchParams.set('limit','8');
      const response=await discoveryFetch(fetch, endpoint,{signal:requestSignal,headers:{accept:'application/x-ndjson,text/plain','user-agent':'LegalWhat-Lexara/1.0'}});
      await checkDiscoveryResponse(response, 'commonCrawl');
      return (await response.text()).split(/\r?\n/).flatMap(line=>{
        if(!line.trim()) return [];
        try { const row=JSON.parse(line); const url=clean(row?.url); return url?[{url,title:'Common Crawl historical capture',tier:5 as const,provider:'commoncrawl'}]:[]; }
        catch { malformedRows = true; return []; }
      });
    }));
    const rows = groups.flatMap(group => group.status === 'fulfilled' ? group.value : []);
    const failed = groups.find(group => group.status === 'rejected');
    if (!rows.length && failed?.status === 'rejected') throw failed.reason;
    if (!rows.length && malformedRows) throw new SyntaxError('Discovery index response invalid');
    if (failed || malformedRows) markDiscoveryPartial('commonCrawl');
    return rows;
  });
  return result||[];
}


/** A search hit is only a legal-authority lead, never verification of the law. */
function containsLegalAuthorityLead(items: readonly LegalMeshCandidate[]): boolean {
  return items.some(item => {
    try {
      const target = new URL(item.url);
      const host = target.hostname.toLowerCase();
      const official = host.endsWith('.gov') || host.endsWith('.us') || host.endsWith('.mil')
        || host === 'supremecourt.gov' || host.endsWith('.uscourts.gov');
      if (!official) return false;
      // A generic .gov directory or search hit is NOT primary legal text.
      // Only concrete statutes, opinions and rules may end the strict lead race.
      const lawPath = /\/(?:docs\/code|statutes?|codes?|laws?|opinions?|rules?|regulations?|cases?)\/|\/content\/pkg\//i.test(target.pathname);
      const lawTitle = /\b(?:code\s+(?:section|§|\d)|statute\s*(?:section|§|\d)|judicial\s+opinion|court\s+(?:opinion|rule)|rule\s+\d|§\s*\d)\b/i.test(item.title || '');
      return lawPath || lawTitle;
    } catch { return false; }
  });
}

async function freeSearch(
  query: string,
  signal?: AbortSignal,
  _firstUseful = false,
  officialFormQuery = false,
  allowPaidSearch = true,
  strictLegalSource = false,
): Promise<LegalMeshCandidate[]> {
  // Fast mode returns leads for prompt verification; full mode retains all
  // bounded providers. An unverified fast lead triggers a full retry upstream.
  const controller = new AbortController();
  const relayAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', relayAbort, { once: true });
  try {
    const providers = [
      // Tavily requires plan credits, including for standard search; never
      // call its usage endpoint or reserve credits in free-only investigations.
      allowPaidSearch ? tavily(query, controller.signal, officialFormQuery ? 5_000 : 2_000) : Promise.resolve([]),
      duckDuckGoInstantAnswer(query, controller.signal),
      searxng(query, controller.signal),
      ddgs(query, controller.signal, officialFormQuery),
      openserp(query, controller.signal, officialFormQuery),
    ];
    if (_firstUseful && !officialFormQuery) {
      const completed: LegalMeshCandidate[][] = [];
      const firstAuthority = Promise.any(providers.map(async provider => {
        const candidates = await provider;
        if (!candidates.length) throw new Error('LEXARA_NO_SEARCH_LEADS');
        completed.push(candidates);
        // Only strict legal research waits for an authoritative lead. Factual
        // and background discovery retain their existing first-hit behavior.
        if (strictLegalSource && !containsLegalAuthorityLead(candidates)) {
          throw new Error('LEXARA_GENERIC_SEARCH_LEADS_ONLY');
        }
        return candidates;
      })).catch(() => [] as LegalMeshCandidate[]);
      let legalGraceTimer: ReturnType<typeof setTimeout> | undefined;
      const first = strictLegalSource
        ? await Promise.race([
            firstAuthority,
            new Promise<LegalMeshCandidate[]>(resolve => {
              legalGraceTimer = setTimeout(() => resolve([]), 2_400);
            }),
          ]).finally(() => clearTimeout(legalGraceTimer))
        : await firstAuthority;
      if (signal?.aborted) throw signal.reason || new DOMException('Discovery cancelled', 'AbortError');
      // Keep complementary evidence already returned by sibling providers.
      if (first.length && strictLegalSource) {
        // A government-looking result is still just a lead. Allow the other
        // independently running engines a short grace window to contribute
        // stronger legislative/court sources before cancelling the slow lanes.
        let graceTimer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          Promise.allSettled(providers).then(() => undefined),
          new Promise<void>(resolve => { graceTimer = setTimeout(resolve, 400); }),
        ]).finally(() => clearTimeout(graceTimer));
      } else if (first.length) {
        // Preserve the original fast-first factual/background path.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      if (signal?.aborted) throw signal.reason || new DOMException('Discovery cancelled', 'AbortError');
      if (first.length || strictLegalSource) controller.abort(new Error('lexara_first_useful_provider'));
      if (strictLegalSource) console.info('[LEXARA Legal Source Leads]', {
        qualifiedLead: first.length > 0,
        candidateCount: completed.flat().length,
      });
      return completed.length ? fuseRankedCandidates(completed) : first;
    }
    const outcomes = await Promise.allSettled(providers);
    if (signal?.aborted) throw signal.reason || new DOMException('Discovery cancelled', 'AbortError');
    const enabled = [allowPaidSearch && Boolean(process.env.TAVILY_API_KEY?.trim()), true, Boolean(lexaraSearxngBase()), Boolean(lexaraDdgsBase()), Boolean(lexaraOpenserpBase())];
    console.info('[LEXARA Discovery Lanes]', JSON.stringify({ requestId: getDiscoveryDiagnostics()?.requestId, statusScope: 'promise-completion-only', results: outcomes.map((outcome, index) => ({ lane: ['tavily', 'duckduckgo-instant-answer', 'searxng', 'ddgs', 'openserp'][index], enabled: enabled[index], candidates: outcome.status === 'fulfilled' ? outcome.value.length : 0, promiseStatus: outcome.status })) }));
    return fuseRankedCandidates(outcomes.flatMap(outcome =>
      outcome.status === 'fulfilled' ? [outcome.value] : []));
  } finally {
    signal?.removeEventListener('abort', relayAbort);
  }
}

async function firstUsefulSearchVariants(
  queries: readonly string[],
  signal?: AbortSignal,
  allowPaidSearch = true,
  strictLegalSource = false,
): Promise<LegalMeshCandidate[]> {
  const controller = new AbortController();
  const relayAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', relayAbort, { once: true });
  try {
    const completed: LegalMeshCandidate[][] = [];
    const first = await Promise.any(queries.map(async query => {
      const candidates = strictLegalSource
        ? await freeSearch(query, controller.signal, true, false, allowPaidSearch, true)
        : await freeSearch(query, controller.signal, true, false, allowPaidSearch);
      if (!candidates.length) throw new Error('LEXARA_NO_QUERY_LEADS');
      completed.push(candidates);
      return candidates;
    })).catch(() => [] as LegalMeshCandidate[]);
    if (signal?.aborted) throw signal.reason || new DOMException('Discovery cancelled', 'AbortError');
    if (first.length) await new Promise<void>(resolve => setTimeout(resolve, 0));
    return completed.length ? fuseRankedCandidates(completed) : first;
  } finally {
    controller.abort(new Error('lexara_first_useful_query'));
    signal?.removeEventListener('abort', relayAbort);
  }
}

async function firstUsefulParallelSearch(
  queries: readonly string[],
  seen: ReadonlySet<string>,
  providerPrefix: 'supplemental' | 'planned',
  signal?: AbortSignal,
  _providerFirstUseful = false,
  allowPaidSearch = true,
): Promise<LegalMeshCandidate[]> {
  const results = _providerFirstUseful
    ? await firstUsefulSearchVariants(queries, signal, allowPaidSearch)
    : fuseRankedCandidates((await Promise.allSettled(
        queries.map(query => freeSearch(query, signal, false, false, allowPaidSearch)),
      )).flatMap(outcome => outcome.status === 'fulfilled' ? [outcome.value] : []));
  return diversify(results
    .filter(item => !seen.has(item.url))
    .map(item => ({ ...item, tier: 5 as const, provider: `${providerPrefix}-${item.provider}` })), 12);
}

export async function discoverLegalMeshTier3(
  query: string,
  signal?: AbortSignal,
  options: LegalMeshSearchOptions = {},
): Promise<LegalMeshCandidate[]> {
  const learnedPatterns=options.queryAlreadyPlanned ? [] : await Promise.race([
    getLexaraLearnedQueryPatterns(options.categories||[],options.jurisdiction,1),
    new Promise<string[]>(resolve=>setTimeout(()=>resolve([]),75)),
  ]);
  const variants=options.queryAlreadyPlanned ? [query] : options.officialFormQuery ? [query] : buildLexaraSourceQueries({
    query,
    subject:options.subject,
    requestedFact:options.requestedFact,
    categories:options.categories,
    jurisdiction:options.jurisdiction,
  });
  // Stored patterns contain prior user wording, not reusable templates. Reuse
  // only curated source-family hints so names/instructions cannot cross turns.
  if(!options.queryAlreadyPlanned && !options.officialFormQuery && learnedPatterns[0]) {
    const hint = getLexaraSourceQueryHints(options.categories || []).find(value => learnedPatterns[0].includes(value));
    if (hint) variants.push(`${query} ${hint}`);
  }
  const uniqueVariants=[...new Set(variants)].slice(0,options.firstUseful ? 2 : 6);
  const groups=options.firstUseful && !options.officialFormQuery
    ? [await (options.strictLegalSource
        ? firstUsefulSearchVariants(uniqueVariants,signal,options.allowPaidSearch !== false,true)
        : firstUsefulSearchVariants(uniqueVariants,signal,options.allowPaidSearch !== false))]
    : await Promise.all(uniqueVariants.map(variant=>freeSearch(variant,signal,false,options.officialFormQuery,options.allowPaidSearch !== false)));
  if (options.officialFormQuery && !options.queryAlreadyPlanned && !signal?.aborted) {
    // Broaden only after the first search lacks a plausible court document.
    const foundCourtFile=groups.flat().some(item=>{
      try {
        const host=new URL(item.url).hostname.toLowerCase();
        return (host.endsWith('.gov') || host.endsWith('.uscourts.gov')
          || /(?:^|\.)courts?\.[a-z]{2}\.us$/.test(host))
          && /(?:\.pdf|\.docx|\/download|\/embeddocument)(?:[?#/]|$)/i.test(item.url)
          && /\b(?:form|petition|motion|application|affidavit|complaint|order)\b/i.test(item.title);
      } catch { return false; }
    });
    if (!foundCourtFile && !/\bsite:\S+/i.test(query)) {
      groups.push(await freeSearch(query + ' site:.gov',signal,false,true,false));
    }
  }
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
      options.allowPaidSearch !== false,
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
      options.allowPaidSearch !== false,
    );
    if(plannedFresh.length) return plannedFresh;
  }

  // Exhausted quotas must not be spent by an investigation that explicitly
  // requests free-only supplemental discovery. Other Lexara callers keep
  // their existing behavior unless they opt into this restriction.
  if (options.allowPaidSearch === false) return [];
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

