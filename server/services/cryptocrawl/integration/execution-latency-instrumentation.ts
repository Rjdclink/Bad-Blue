import logger from '../../../logger.js';
import { centralizedExchangeExecutor } from '../execution/centralized-exchange-executor.js';
import { endToEndLatencyHarness, type LatencyOutcome } from '../runtime/end-to-end-latency-harness.js';

let installed = false;
const SUBMIT_MARKER = '__cryptocrawlLatencyInstrumentedSubmit' as const;
const FETCH_MARKER = '__cryptocrawlLatencyInstrumentedFetch' as const;

type InstrumentableFunction = Function & {
  [SUBMIT_MARKER]?: boolean;
  [FETCH_MARKER]?: boolean;
};

function classifyError(error: unknown): LatencyOutcome {
  const name = error instanceof Error ? error.name.toLowerCase() : '';
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return name.includes('abort') || message.includes('timeout') || message.includes('timed out') ? 'timeout' : 'error';
}

function privateOrderVenue(input: RequestInfo | URL, init?: RequestInit): 'coinbase' | 'kraken' | 'okx' | null {
  let rawUrl: string;
  let method = init?.method?.toUpperCase();
  if (typeof input === 'string') rawUrl = input;
  else if (input instanceof URL) rawUrl = input.toString();
  else {
    rawUrl = input.url;
    method ||= input.method?.toUpperCase();
  }
  if (method !== 'POST') return null;
  try {
    const url = new URL(rawUrl);
    if (url.hostname === 'api.kraken.com' && url.pathname === '/0/private/AddOrder') return 'kraken';
    if ((url.hostname === 'us.okx.com' || url.hostname === 'openapi.okx.com') && url.pathname === '/api/v5/trade/order') return 'okx';
    if (url.hostname === 'api.coinbase.com' && url.pathname === '/api/v3/brokerage/orders') return 'coinbase';
  } catch {
    return null;
  }
  return null;
}

function installPrivateOrderAckFetchInstrumentation(): void {
  if (typeof globalThis.fetch !== 'function') return;
  const currentFetch = globalThis.fetch as InstrumentableFunction;
  if (currentFetch[FETCH_MARKER]) return;
  const originalFetch = globalThis.fetch.bind(globalThis);

  const wrappedFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const venue = privateOrderVenue(input, init);
    if (!venue) return originalFetch(input, init);
    const span = endToEndLatencyHarness.startSpan('exchange_rpc_ack', 'network', {
      backend: 'authenticated_cex_order_http',
      provider: venue,
      venue,
      chain: 'cex',
      worker: 'main_process',
      strategy: 'verified_cex_arbitrage',
    });
    try {
      const response = await originalFetch(input, init);
      span.end(response.ok ? 'ok' : 'error');
      return response;
    } catch (error) {
      span.end(classifyError(error));
      throw error;
    }
  }) as typeof fetch & InstrumentableFunction;
  wrappedFetch[FETCH_MARKER] = true;
  globalThis.fetch = wrappedFetch;
}

function installCanonicalAdapterSubmitInstrumentation(): number {
  const executor = centralizedExchangeExecutor as any;
  const adapters = executor?.options?.adapters as Record<string, any> | undefined;
  if (!adapters || typeof adapters !== 'object') return 0;
  let wrapped = 0;

  for (const [venue, adapter] of Object.entries(adapters)) {
    if (!adapter || typeof adapter.submit !== 'function') continue;
    const currentSubmit = adapter.submit as InstrumentableFunction;
    if (currentSubmit[SUBMIT_MARKER]) continue;
    const originalSubmit = adapter.submit.bind(adapter);
    const instrumentedSubmit = (async (request: any) => {
      const span = endToEndLatencyHarness.startSpan('submit', 'network', {
        backend: 'canonical_cex_settlement_adapter_submit',
        provider: venue,
        venue,
        chain: 'cex',
        symbol: typeof request?.symbol === 'string' ? request.symbol : undefined,
        strategy: 'verified_cex_arbitrage',
        worker: 'main_process',
      });
      try {
        const receipt = await originalSubmit(request);
        span.end('ok', {
          traceId: typeof receipt?.orderId === 'string' ? `${venue}:${receipt.orderId}` : undefined,
        });
        return receipt;
      } catch (error) {
        span.end(classifyError(error));
        throw error;
      }
    }) as InstrumentableFunction;
    instrumentedSubmit[SUBMIT_MARKER] = true;
    adapter.submit = instrumentedSubmit;
    wrapped++;
  }
  return wrapped;
}

/**
 * Installs nested production timing spans:
 * - submit: full canonical adapter submit lifecycle (validation/serialization + I/O)
 * - exchange_rpc_ack: exact authenticated order-creation HTTP round-trip
 *
 * The spans intentionally overlap like normal distributed tracing: the ACK span
 * is a measured network subset of the broader submit stage, not a duplicate
 * synthetic sample. Only exact order-creation URLs are intercepted.
 */
export function ensureExecutionLatencyInstrumentation(): void {
  if (installed) return;
  installed = true;
  installPrivateOrderAckFetchInstrumentation();
  const adaptersWrapped = installCanonicalAdapterSubmitInstrumentation();
  logger.info('[LatencyHarness] Canonical execution stage instrumentation installed', {
    component: 'ExecutionLatencyInstrumentation',
    stages: ['submit', 'exchange_rpc_ack'],
    adaptersWrapped,
    exactOrderCreationHttpOnly: true,
    nestedSpanSemantics: true,
    authority: 'telemetry_only',
    executionAuthority: false,
    settlementAuthorityChanged: false,
  });
}
