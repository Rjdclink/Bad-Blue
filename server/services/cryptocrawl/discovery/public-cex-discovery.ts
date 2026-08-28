import logger from '../../../logger.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { getVenueCapability, type CryptoCrawlerCexVenue } from './venue-capability-registry.js';

export type PublicDiscoveryVenue = 'coinbase' | 'binance' | 'bybit' | 'kucoin' | 'gate' | 'huobi';

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

const VENUES: PublicDiscoveryVenue[] = ['coinbase', 'binance', 'bybit', 'kucoin', 'gate', 'huobi'];
type VenueSnapshot = Map<string, PublicCexBboObservation>;
const snapshotCache = new Map<PublicDiscoveryVenue, { expiresAt: number; value: VenueSnapshot }>();
const snapshotInFlight = new Map<PublicDiscoveryVenue, Promise<VenueSnapshot>>();

function finitePositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function splitSymbol(symbol: string): { base: string; quote: string } | null {
  const match = symbol.trim().toUpperCase().match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  return match ? { base: match[1], quote: match[2] } : null;
}

function canonicalExternalSymbol(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const compact = raw.trim().toUpperCase().replace(/[-_/]/g, '');
  return splitSymbol(compact) ? compact : null;
}

function assertBbo(
  venue: PublicDiscoveryVenue,
  symbol: string,
  bidValue: unknown,
  askValue: unknown,
  observedAt: number,
): PublicCexBboObservation {
  const bid = finitePositive(bidValue);
  const ask = finitePositive(askValue);
  if (bid === null || ask === null || ask < bid) throw new Error('public BBO response is missing a valid bid/ask');
  return { venue, symbol, bid, ask, observedAt, source: 'public_rest_bbo', executable: false };
}

function snapshotTtlMs(): number {
  return Math.max(250, Math.min(10_000, Number(process.env.CRYPTOCRAWL_PUBLIC_BBO_CACHE_MS || 1_500)));
}

function addSnapshotRow(
  output: VenueSnapshot,
  venue: PublicDiscoveryVenue,
  rawSymbol: unknown,
  bid: unknown,
  ask: unknown,
  observedAt: number,
): void {
  const symbol = canonicalExternalSymbol(rawSymbol);
  if (!symbol) return;
  try {
    output.set(symbol, assertBbo(venue, symbol, bid, ask, observedAt));
  } catch {
    // One malformed/inactive pair must not discard a full-venue snapshot.
  }
}

async function fetchVenueSnapshotUncached(venue: PublicDiscoveryVenue): Promise<VenueSnapshot> {
  const options = {
    init: { headers: { accept: 'application/json', 'cache-control': 'no-cache' } },
    maxRetries: 1,
    baseDelayMs: 150,
    maxDelayMs: 750,
    timeoutMs: 3_500,
  };
  const observedAt = Date.now();
  const output: VenueSnapshot = new Map();

  if (venue === 'coinbase') {
    const payload = await fetchJsonWithRetry<any>(
      'https://api.coinbase.com/api/v3/brokerage/market/products?product_type=SPOT&limit=1000',
      options,
    );
    for (const row of Array.isArray(payload?.products) ? payload.products : []) {
      // Coinbase Advanced Trade exposes exact product quote currencies. Preserve
      // that currency in the canonical symbol; USD, USDC and USDT are never
      // treated as interchangeable execution assets.
      addSnapshotRow(output, venue, row?.product_id, row?.best_bid_price, row?.best_ask_price, observedAt);
    }
    return output;
  }

  if (venue === 'binance') {
    const rows = await fetchJsonWithRetry<any[]>('https://api.binance.com/api/v3/ticker/bookTicker', options);
    for (const row of Array.isArray(rows) ? rows : []) addSnapshotRow(output, venue, row?.symbol, row?.bidPrice, row?.askPrice, observedAt);
    return output;
  }

  if (venue === 'bybit') {
    const payload = await fetchJsonWithRetry<any>('https://api.bybit.com/v5/market/tickers?category=spot', options);
    for (const row of Array.isArray(payload?.result?.list) ? payload.result.list : []) {
      addSnapshotRow(output, venue, row?.symbol, row?.bid1Price, row?.ask1Price, observedAt);
    }
    return output;
  }

  if (venue === 'kucoin') {
    const payload = await fetchJsonWithRetry<any>('https://api.kucoin.com/api/v1/market/allTickers', options);
    for (const row of Array.isArray(payload?.data?.ticker) ? payload.data.ticker : []) {
      addSnapshotRow(output, venue, row?.symbol, row?.buy ?? row?.bestBid, row?.sell ?? row?.bestAsk, observedAt);
    }
    return output;
  }

  if (venue === 'gate') {
    const rows = await fetchJsonWithRetry<any[]>('https://api.gateio.ws/api/v4/spot/tickers', options);
    for (const row of Array.isArray(rows) ? rows : []) {
      addSnapshotRow(output, venue, row?.currency_pair, row?.highest_bid, row?.lowest_ask, observedAt);
    }
    return output;
  }

  const payload = await fetchJsonWithRetry<any>('https://api.huobi.pro/market/tickers', options);
  for (const row of Array.isArray(payload?.data) ? payload.data : []) {
    addSnapshotRow(output, venue, row?.symbol, row?.bid, row?.ask, observedAt);
  }
  return output;
}

async function getVenueSnapshot(venue: PublicDiscoveryVenue): Promise<VenueSnapshot> {
  const capability = getVenueCapability(venue as CryptoCrawlerCexVenue);
  if (!capability.enabled || !capability.publicDiscovery || capability.liveExecution) return new Map();

  const cached = snapshotCache.get(venue);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const existing = snapshotInFlight.get(venue);
  if (existing) return existing;

  const promise = fetchVenueSnapshotUncached(venue)
    .then(value => {
      snapshotCache.set(venue, { value, expiresAt: Date.now() + snapshotTtlMs() });
      return value;
    })
    .finally(() => snapshotInFlight.delete(venue));
  snapshotInFlight.set(venue, promise);
  return promise;
}

function recordSearchObservation(observation: PublicCexBboObservation): void {
  canonicalOpportunityState.recordSearchObservation({
    observationId: `public-cex:${observation.venue}:${observation.symbol}:${observation.observedAt}`,
    symbol: observation.symbol,
    observedAt: observation.observedAt,
    source: `public_cex_${observation.venue}`,
  });
}

/**
 * Compatibility single-symbol lookup backed by one all-ticker venue snapshot.
 * This avoids one HTTP request per symbol while preserving the existing API.
 */
export async function discoverPublicCexBbo(
  venue: PublicDiscoveryVenue,
  symbolInput: string,
): Promise<PublicCexBboObservation | null> {
  const symbol = symbolInput.trim().toUpperCase();
  if (!splitSymbol(symbol)) return null;
  try {
    const observation = (await getVenueSnapshot(venue)).get(symbol) || null;
    if (observation) recordSearchObservation(observation);
    return observation ? { ...observation } : null;
  } catch (error) {
    logger.debug('[PublicCexDiscovery] Public venue snapshot unavailable', {
      component: 'PublicCexDiscovery',
      venue,
      symbol,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Broad discovery costs approximately one public request per venue per cache
 * window rather than venues x symbols requests. This makes 50+ pair discovery
 * practical without adding API keys or multiplying provider load linearly.
 */
export async function scanPublicCexUniverse(symbolsInput: readonly string[]): Promise<PublicCexDiscoveryBatch> {
  const startedAt = Date.now();
  const maxSymbols = Math.max(64, Math.min(128, Number(process.env.CRYPTOCRAWL_PUBLIC_DISCOVERY_SYMBOLS || 96)));
  const symbols = [...new Set(symbolsInput.map(symbol => symbol.trim().toUpperCase()).filter(symbol => !!splitSymbol(symbol)))].slice(0, maxSymbols);
  const requested = new Set(symbols);
  const observations: PublicCexBboObservation[] = [];
  const failures: PublicCexDiscoveryBatch['failures'] = [];

  const settled = await Promise.allSettled(VENUES.map(async venue => ({ venue, snapshot: await getVenueSnapshot(venue) })));
  for (let index = 0; index < settled.length; index++) {
    const result = settled[index];
    const venue = VENUES[index];
    if (result.status === 'rejected') {
      failures.push({
        venue,
        symbol: '*',
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
      continue;
    }
    for (const [symbol, observation] of result.value.snapshot.entries()) {
      if (!requested.has(symbol)) continue;
      observations.push({ ...observation });
      recordSearchObservation(observation);
    }
  }

  logger.debug('[PublicCexDiscovery] Batched public BBO scan completed', {
    component: 'PublicCexDiscovery',
    requestedSymbols: symbols.length,
    venues: VENUES.length,
    publicHttpRequestsUpperBound: VENUES.length,
    observations: observations.length,
    failures: failures.length,
  });

  return { startedAt, completedAt: Date.now(), symbols: symbols.length, observations, failures };
}

export function getPublicDiscoveryVenues(): PublicDiscoveryVenue[] {
  return VENUES.filter(venue => {
    const capability = getVenueCapability(venue as CryptoCrawlerCexVenue);
    return capability.enabled && capability.publicDiscovery && !capability.liveExecution;
  });
}
