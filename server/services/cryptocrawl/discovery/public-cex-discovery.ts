import logger from '../../../logger.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { getVenueCapability, type CryptoCrawlerCexVenue } from './venue-capability-registry.js';

export type PublicDiscoveryVenue = 'binance' | 'bybit' | 'kucoin' | 'gate' | 'huobi';

export interface PublicCexBboObservation {
  venue: PublicDiscoveryVenue;
  symbol: string;
  bid: number;
  ask: number;
  observedAt: number;
  source: 'public_rest_bbo';
  executable: false;
}

export interface PublicCexDiscoveryBatch {
  startedAt: number;
  completedAt: number;
  symbols: number;
  observations: PublicCexBboObservation[];
  failures: Array<{ venue: PublicDiscoveryVenue; symbol: string; error: string }>;
}

const VENUES: PublicDiscoveryVenue[] = ['binance', 'bybit', 'kucoin', 'gate', 'huobi'];
const cache = new Map<string, { expiresAt: number; value: PublicCexBboObservation | null }>();
const inFlight = new Map<string, Promise<PublicCexBboObservation | null>>();

function finitePositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function splitSymbol(symbol: string): { base: string; quote: string } | null {
  const match = symbol.trim().toUpperCase().match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  return match ? { base: match[1], quote: match[2] } : null;
}

function assertBbo(venue: PublicDiscoveryVenue, symbol: string, bidValue: unknown, askValue: unknown): PublicCexBboObservation {
  const bid = finitePositive(bidValue);
  const ask = finitePositive(askValue);
  if (bid === null || ask === null || ask < bid) throw new Error('public BBO response is missing a valid bid/ask');
  return { venue, symbol, bid, ask, observedAt: Date.now(), source: 'public_rest_bbo', executable: false };
}

async function fetchVenueBbo(venue: PublicDiscoveryVenue, symbol: string): Promise<PublicCexBboObservation> {
  const pair = splitSymbol(symbol);
  if (!pair) throw new Error(`unsupported normalized symbol ${symbol}`);
  const options = { maxRetries: 1, baseDelayMs: 150, maxDelayMs: 500, timeoutMs: 2_500 };

  if (venue === 'binance') {
    const row = await fetchJsonWithRetry<any>(`https://api.binance.com/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(symbol)}`, options);
    return assertBbo(venue, symbol, row?.bidPrice, row?.askPrice);
  }
  if (venue === 'bybit') {
    const payload = await fetchJsonWithRetry<any>(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${encodeURIComponent(symbol)}`, options);
    const row = payload?.result?.list?.[0];
    return assertBbo(venue, symbol, row?.bid1Price, row?.ask1Price);
  }
  if (venue === 'kucoin') {
    const external = `${pair.base}-${pair.quote}`;
    const payload = await fetchJsonWithRetry<any>(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${encodeURIComponent(external)}`, options);
    return assertBbo(venue, symbol, payload?.data?.bestBid, payload?.data?.bestAsk);
  }
  if (venue === 'gate') {
    const external = `${pair.base}_${pair.quote}`;
    const payload = await fetchJsonWithRetry<any>(`https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${encodeURIComponent(external)}&limit=1`, options);
    return assertBbo(venue, symbol, payload?.bids?.[0]?.[0], payload?.asks?.[0]?.[0]);
  }

  const external = `${pair.base}${pair.quote}`.toLowerCase();
  const payload = await fetchJsonWithRetry<any>(`https://api.huobi.pro/market/detail/merged?symbol=${encodeURIComponent(external)}`, options);
  return assertBbo(venue, symbol, payload?.tick?.bid?.[0], payload?.tick?.ask?.[0]);
}

export async function discoverPublicCexBbo(venue: PublicDiscoveryVenue, symbolInput: string): Promise<PublicCexBboObservation | null> {
  const symbol = symbolInput.trim().toUpperCase();
  const capability = getVenueCapability(venue as CryptoCrawlerCexVenue);
  if (!capability.enabled || !capability.publicDiscovery || capability.liveExecution) {
    return null;
  }
  const ttlMs = Math.max(250, Number(process.env.CRYPTOCRAWL_PUBLIC_BBO_CACHE_MS || 1_500));
  const key = `${venue}:${symbol}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value ? { ...cached.value } : null;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = fetchVenueBbo(venue, symbol)
    .then(value => {
      cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      canonicalOpportunityState.recordSearchObservation({
        observationId: `public-cex:${venue}:${symbol}:${value.observedAt}`,
        symbol,
        observedAt: value.observedAt,
        source: `public_cex_${venue}`,
      });
      return { ...value };
    })
    .catch(error => {
      cache.set(key, { value: null, expiresAt: Date.now() + Math.min(ttlMs, 1_000) });
      logger.debug('[PublicCexDiscovery] Public BBO unavailable', {
        component: 'PublicCexDiscovery', venue, symbol,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export async function scanPublicCexUniverse(symbolsInput: readonly string[]): Promise<PublicCexDiscoveryBatch> {
  const startedAt = Date.now();
  const maxSymbols = Math.max(1, Math.min(50, Number(process.env.CRYPTOCRAWL_PUBLIC_DISCOVERY_SYMBOLS || 32)));
  const symbols = [...new Set(symbolsInput.map(symbol => symbol.trim().toUpperCase()).filter(Boolean))].slice(0, maxSymbols);
  const concurrency = Math.max(1, Math.min(12, Number(process.env.CRYPTOCRAWL_PUBLIC_DISCOVERY_CONCURRENCY || 8)));
  const tasks: Array<{ venue: PublicDiscoveryVenue; symbol: string }> = [];
  for (const symbol of symbols) for (const venue of VENUES) tasks.push({ venue, symbol });

  const observations: PublicCexBboObservation[] = [];
  const failures: PublicCexDiscoveryBatch['failures'] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, tasks.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= tasks.length) return;
      const task = tasks[index];
      try {
        const observation = await discoverPublicCexBbo(task.venue, task.symbol);
        if (observation) observations.push(observation);
      } catch (error) {
        failures.push({ venue: task.venue, symbol: task.symbol, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }));

  return { startedAt, completedAt: Date.now(), symbols: symbols.length, observations, failures };
}

export function getPublicDiscoveryVenues(): PublicDiscoveryVenue[] {
  return VENUES.filter(venue => {
    const capability = getVenueCapability(venue as CryptoCrawlerCexVenue);
    return capability.enabled && capability.publicDiscovery && !capability.liveExecution;
  });
}
