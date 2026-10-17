import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Request as ExpressRequest, Response as ExpressResponse, NextFunction } from 'express';

const requestSignals = new AsyncLocalStorage<AbortSignal>();

/** A disconnected/completed acquisition must not leave upstream work running. */
export function discoveryRequestLifetime(req: ExpressRequest, res: ExpressResponse, next: NextFunction): void {
  const controller = new AbortController();
  const stop = () => {
    clearTimeout(timer);
    req.removeListener('aborted', stop);
    res.removeListener('close', stop);
    res.removeListener('finish', stop);
    controller.abort(new DOMException('Acquisition ended', 'AbortError'));
  };
  const timer = setTimeout(stop, 180_000);
  timer.unref?.();
  req.once('aborted', stop);
  res.once('close', stop);
  res.once('finish', stop);
  if (req.aborted || res.destroyed) stop();
  requestSignals.run(controller.signal, next);
}

export function discoverySignal(signal?: AbortSignal | null): AbortSignal | undefined {
  const request = requestSignals.getStore();
  return request && signal ? AbortSignal.any([request, signal]) : request || signal || undefined;
}

export function throwIfDiscoveryCancelled(): void {
  requestSignals.getStore()?.throwIfAborted();
}

/** Explicit transport injection preserves fixtures and avoids patching global fetch. */
export function discoveryFetch(transport: typeof fetch, input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  const request = requestSignals.getStore();
  if (!request) return transport(input, init);
  request.throwIfAborted();
  const local = init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
  return transport(input, { ...init, signal: discoverySignal(local) });
}

export type DiscoveryOutcome = 'ok' | 'empty' | 'failed' | 'timeout' | 'cancelled' | 'skipped';
type Counts = Record<DiscoveryOutcome, number> & { pending: number; dispatched: number; partial: number };
type ProviderCounts = Counts & { provider: string; errors: Record<string, number> };
interface DiscoveryContext {
  requestId: string;
  providers: Map<string, ProviderCounts>;
}
const contexts = new AsyncLocalStorage<DiscoveryContext>();
const counts = (): Counts => ({ ok: 0, empty: 0, failed: 0, timeout: 0, cancelled: 0, skipped: 0, pending: 0, dispatched: 0, partial: 0 });
const providerNames: Record<string, string> = {
  firecrawlKeyless: 'firecrawl-keyless', jinaReader: 'jina-reader', crawl4ai: 'crawl4ai',
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
    const local: Record<string, string> = {
      DISCOVERY_NOT_CONFIGURED: 'not-configured', DISCOVERY_DISABLED: 'disabled', DISCOVERY_COOLDOWN: 'cooldown',
      DISCOVERY_QUOTA_EXHAUSTED: 'quota-exhausted', DISCOVERY_BUDGET_UNAVAILABLE: 'budget-unavailable',
      DISCOVERY_LOCAL_RATE_LIMIT: 'local-rate-limit',
      DISCOVERY_QUEUE_FULL: 'queue-capacity', DISCOVERY_QUEUE_TIMEOUT: 'queue-timeout',
      DISCOVERY_UNAVAILABLE: 'provider-unavailable', DISCOVERY_PROVIDER_ERROR: 'upstream-error',
    };
    if (Object.prototype.hasOwnProperty.call(local, code)) return local[code];
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
  const provider = lane.startsWith('ddgsBackend:') ? 'ddgs'
    : Object.prototype.hasOwnProperty.call(providerNames, lane) ? providerNames[lane] : 'other';
  let row = context?.providers.get(provider);
  if (context && !row) {
    row = { provider, ...counts(), errors: {} };
    context.providers.set(provider, row);
  }
  if (row) row.pending++;
  const started = performance.now();
  let completed = false;
  const finish = (outcome: DiscoveryOutcome, error?: unknown) => {
    if (completed) return;
    completed = true;
    const errorType = outcome === 'timeout' ? 'timeout'
      : outcome === 'failed' || (outcome === 'skipped' && error) ? discoveryErrorType(error) : undefined;
    if (row) {
      row.pending--;
      row[outcome]++;
      if (errorType) row.errors[errorType] = (row.errors[errorType] || 0) + 1;
    }
    if (errorType && outcome !== 'skipped') console.warn('[Discovery Feed]', JSON.stringify({
      requestId: context?.requestId, provider, outcome, errorType,
      durationMs: Math.round(performance.now() - started),
    }));
  };
  let dispatched = false;
  finish.dispatch = () => {
    if (!completed && !dispatched) { dispatched = true; if (row) row.dispatched++; }
  };
  return finish;
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
    countingUnit: 'provider-attempt' as const,
    ...totals,
    // Request success is not evidence verification or complete source coverage.
    hasFailures: totals.failed + totals.timeout > 0,
    incomplete: totals.pending + totals.skipped + totals.cancelled + totals.partial > 0,
    providers,
  };
}

export function markDiscoveryPartial(lane: string): void {
  const provider = lane.startsWith('ddgsBackend:') ? 'ddgs'
    : Object.prototype.hasOwnProperty.call(providerNames, lane) ? providerNames[lane] : 'other';
  const row = contexts.getStore()?.providers.get(provider);
  if (row) row.partial++;
}

export async function withDiscoveryDiagnostics<T>(work: () => Promise<T>): Promise<T> {
  return contexts.run({ requestId: randomUUID(), providers: new Map() }, async () => {
    try { return await work(); }
    finally { console.info('[SPECTRA Feed Summary]', JSON.stringify(getDiscoveryDiagnostics())); }
  });
}
