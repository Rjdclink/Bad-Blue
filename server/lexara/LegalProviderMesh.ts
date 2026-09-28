import { discoverPantheonSourcesParallel } from '../services/pantheon/PantheonDiscoveryCoordinator';

export type LegalMeshTier = 1 | 2 | 3 | 4 | 5 | 6;
export interface LegalMeshCandidate { url: string; title: string; excerpt?: string; tier: LegalMeshTier; provider: string; }

const clean = (v: unknown) => {
  try { const u = new URL(String(v || '').trim()); return /^https?:$/.test(u.protocol) ? u.toString() : null; } catch { return null; }
};

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
      const url=clean(x.url); return url ? [{url,title:String(x.title||'Tavily legal result'),excerpt:String(x.content||'').slice(0,900),tier:3 as const,provider:'tavily'}] : [];
    });
  } catch { return []; }
}

export async function discoverLegalMeshTier3(query: string, signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  const [existing, tavilyResults] = await Promise.all([
    discoverPantheonSourcesParallel(query, [], { limit: 16, timeoutMs: 2200, signal, includePaidFallback: false, providerPolicy: 'legalwhat' }),
    tavily(query, signal),
  ]);
  const evidenceByUrl = new Map(existing.evidence.map(item => [item.url, item]));
  const mapped: LegalMeshCandidate[] = existing.urls.map(url => {
    const evidence = evidenceByUrl.get(url);
    return {
      url,
      title: evidence?.title || 'Independent legal discovery result',
      excerpt: evidence?.snippet,
      tier: 3 as const,
      provider: evidence?.lane === 'gemini-google' ? 'gemini-google-grounding' : `independent-discovery:${evidence?.lane || 'unknown'}`,
    };
  });
  const seen=new Set<string>(); return [...tavilyResults,...mapped].filter(x => !seen.has(x.url) && seen.add(x.url));
}

export async function discoverLegalMeshSupplemental(query: string, existingUrls: readonly string[], signal?: AbortSignal): Promise<LegalMeshCandidate[]> {
  const result = await discoverPantheonSourcesParallel(query, existingUrls, { limit: 12, timeoutMs: 2500, signal, includePaidFallback: true, providerPolicy: 'legalwhat' });
  return result.urls.map(url => ({ url, title: 'Supplemental legal discovery result', tier: 5 as const, provider: 'supplemental-discovery' }));
}

export function legalMeshSufficient(items: LegalMeshCandidate[]): boolean {
  if (!items.length) return false;
  const authoritative = items.some(x => {
    try { const h=new URL(x.url).hostname.toLowerCase(); return h.endsWith('.gov') || h.endsWith('.uscourts.gov') || h.includes('courtlistener.com'); } catch { return false; }
  });
  return authoritative || items.filter(x => x.excerpt?.trim()).length >= 2;
}
