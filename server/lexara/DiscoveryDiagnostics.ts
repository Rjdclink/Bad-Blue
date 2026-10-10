import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export type DiscoveryOutcome = 'ok' | 'empty' | 'failed' | 'timeout' | 'cancelled' | 'skipped';
type Counts = Record<DiscoveryOutcome, number> & { pending: number };
type ProviderCounts = Counts & { provider: string; errors: Record<string, number> };
interface DiscoveryContext {
  requestId: string;
  providers: Map<string, ProviderCounts>;
}
const contexts = new AsyncLocalStorage<DiscoveryContext>();
const counts = (): Counts => ({ ok: 0, empty: 0, failed: 0, timeout: 0, cancelled: 0, skipped: 0, pending: 0 });
const providerNames: Record<string, string> = {
  tavily: 'tavily', duckDuckGoInstantAnswer: 'duckduckgo-instant-answer',
  searxng: 'searxng', ddgsBackend: 'ddgs', openserp: 'openserp',
  serpApi: 'serpapi', scrapingBee: 'scrapingbee', commonCrawl: 'common-crawl',
};

// Return bounded categories only. URLs, response bodies, queries, credentials,
// and exception messages must never enter these diagnostic payloads.
export function discoveryErrorType(error: unknown): string {
  const seen = new Set<unknown>();
  let current: any = error;
  for (let depth = 0; current && depth < 5 && !seen.has(current); depth++) {
    seen.add(current);
    const code = String(current.code || '');
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
    if (['ECONNREFUSED', 'ECONNRESET', 'UND_ERR_SOCKET'].includes(code)) return 'connection';
    if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(code)
      || current.name === 'TimeoutError') return 'timeout';
    if (current.name === 'SyntaxError') return 'invalid-response';
    const http = /^Discovery HTTP ([45]\d{2})$/.exec(String(current.message || ''));
    if (http) return `http-${http[1]}`;
    current = current.cause;
  }
  return 'request-failed';
}

export function beginDiscoveryAttempt(lane: string) {
  const context = contexts.getStore();
  // Only fixed code-defined lane labels are emitted, never caller-supplied text.
  const provider = providerNames[lane] || 'other';
  let row = context?.providers.get(provider);
  if (context && !row) {
    row = { provider, ...counts(), errors: {} };
    context.providers.set(provider, row);
  }
  if (row) row.pending++;
  const started = performance.now();
  let completed = false;
  return (outcome: DiscoveryOutcome, error?: unknown) => {
    if (completed) return;
    completed = true;
    const errorType = outcome === 'timeout' ? 'timeout'
      : outcome === 'failed' ? discoveryErrorType(error) : undefined;
    if (row) {
      row.pending--;
      row[outcome]++;
      if (errorType) row.errors[errorType] = (row.errors[errorType] || 0) + 1;
    }
    if (errorType) console.warn('[Discovery Feed]', JSON.stringify({
      requestId: context?.requestId, provider, outcome, errorType,
      durationMs: Math.round(performance.now() - started),
    }));
  };
}

export function getDiscoveryDiagnostics() {
  const context = contexts.getStore();
  if (!context) return undefined;
  const totals = counts();
  const providers = [...context.providers.values()].map(row => ({ ...row, errors: { ...row.errors } }));
  for (const row of providers) {
    for (const key of Object.keys(totals) as (keyof Counts)[]) totals[key] += row[key];
  }
  return {
    requestId: context.requestId,
    scope: 'discovery-http' as const,
    ...totals,
    // Request success is not evidence verification or complete source coverage.
    hasFailures: totals.failed + totals.timeout > 0,
    incomplete: totals.pending + totals.skipped + totals.cancelled > 0,
    providers,
  };
}

export async function withDiscoveryDiagnostics<T>(work: () => Promise<T>): Promise<T> {
  return contexts.run({ requestId: randomUUID(), providers: new Map() }, async () => {
    try { return await work(); }
    finally { console.info('[SPECTRA Feed Summary]', JSON.stringify(getDiscoveryDiagnostics())); }
  });
}
