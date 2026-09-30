export type LegalMeshTier = 1 | 2 | 3 | 4 | 5 | 6;
export interface LegalMeshCandidate { url: string; title: string; excerpt?: string; tier: LegalMeshTier; provider: string; }

const clean = (v: unknown) => {
  try {
    const u = new URL(String(v || '').trim());
    return /^https?:$/.test(u.protocol) ? u.toString() : null;
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

async function tavily(query: string, signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) return [];
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, search_depth: 'basic', max_results: 8, include_answer: false, include_raw_content: false }),
    });
    if (!r.ok) return [];
    const j:any = await r.json();
    return (j.results || []).flatMap((x:any) => {
      const url=clean(x.url);
      return url ? [{url,title:String(x.title||'Tavily legal result'),excerpt:String(x.content||'').slice(0,900),tier:3 as const,provider:'tavily'}] : [];
    });
  } catch {
    return [];
  }
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
      return url ? [{url,title:String(item?.title||'SearXNG legal result'),excerpt:String(item?.content||item?.snippet||'').slice(0,900),tier:3 as const,provider:'searxng'}] : [];
    });
  });
  return result || [];
}

async function ddgs(query: string, signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  const base = process.env.DDGS_URL?.trim();
  if (!base) return [];
  const result = await withTimeout(2_200, signal, async requestSignal => {
    const endpoint = new URL('/search/text', base.endsWith('/') ? base : base + '/');
    const response = await fetch(endpoint, {
      method: 'POST', signal: requestSignal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query, max_results: 12, safesearch: 'off', backend: process.env.LEXARA_DDGS_BACKEND?.trim() || 'auto' }),
    });
    if (!response.ok) return [];
    const payload:any = await response.json();
    return (Array.isArray(payload?.results) ? payload.results : []).slice(0, 12).flatMap((item:any) => {
      const url=clean(item?.href || item?.url || item?.link);
      return url ? [{url,title:String(item?.title||'DDGS legal result'),excerpt:String(item?.body||item?.snippet||'').slice(0,900),tier:3 as const,provider:'ddgs'}] : [];
    });
  });
  return result || [];
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
      return url ? [{url,title:String(item?.title||'OpenSERP legal result'),excerpt:String(item?.description||item?.snippet||item?.text||'').slice(0,900),tier:3 as const,provider:'openserp'}] : [];
    });
  });
  return result || [];
}

async function discoverDirect(query: string, signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  const groups = await Promise.all([
    tavily(query, signal),
    searxng(query, signal),
    ddgs(query, signal),
    openserp(query, signal),
  ]);
  const seen = new Set<string>();
  return groups.flat().filter(item => !seen.has(item.url) && seen.add(item.url));
}

export async function discoverLegalMeshTier3(query: string, signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  return discoverDirect(query, signal);
}

export async function discoverLegalMeshSupplemental(query: string, existingUrls: readonly string[], signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  const seen = new Set(existingUrls.map(value => clean(value)).filter(Boolean) as string[]);
  return (await discoverDirect(query, signal))
    .filter(item => !seen.has(item.url))
    .map(item => ({ ...item, tier: 5 as const, provider: `supplemental-${item.provider}` }));
}

export function legalMeshSufficient(items: LegalMeshCandidate[]): boolean {
  if (!items.length) return false;
  const authoritative = items.some(x => {
    try {
      const h=new URL(x.url).hostname.toLowerCase();
      return h.endsWith('.gov') || h.endsWith('.uscourts.gov') || h.includes('courtlistener.com');
    } catch {
      return false;
    }
  });
  return authoritative || items.filter(x => x.excerpt?.trim()).length >= 2;
}
