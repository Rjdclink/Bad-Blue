import logger from '../../../logger.js';
import { getOkxExecutionRestBaseUrl } from '../intelligence/okx-region-authority.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';

export type FundingDiscoveryVenue = 'okx' | 'kraken_futures' | 'binance_futures';
export type FundingRateKind = 'current_estimate' | 'current_continuous_rate' | 'last_settled_reference' | 'settlement_rate';

export interface FundingRateObservation {
  venue: FundingDiscoveryVenue;
  symbol: string;
  instrumentId: string;
  fundingRate: number;
  fundingRateKind: FundingRateKind;
  fundingRateLocked: boolean;
  fundingTime: number | null;
  nextFundingTime: number | null;
  spotReferencePrice: number | null;
  perpReferencePrice: number | null;
  entryBasisBps: number | null;
  observedAt: number;
  executableWithCurrentSpotCredentials: boolean;
  provenance: string[];
}

export interface FundingDiscoveryBatch {
  startedAt: number;
  completedAt: number;
  requestedSymbols: number;
  observations: FundingRateObservation[];
  failures: Array<{ venue: FundingDiscoveryVenue; error: string }>;
}

const REQUEST_OPTIONS = { maxRetries: 1, baseDelayMs: 200, maxDelayMs: 800, timeoutMs: 3_000 };
const BINANCE_JURISDICTION_COOLDOWN_MS = Math.max(
  60_000,
  Math.min(24 * 60 * 60_000, Number(process.env.CRYPTOCRAWL_BINANCE_JURISDICTION_COOLDOWN_MS || 60 * 60_000)),
);
let binanceJurisdictionUnavailableUntil: number | null = null;
let binanceJurisdictionFailureCount = 0;

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positive(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function canonicalBase(value: string): string {
  const upper = value.trim().toUpperCase();
  return upper === 'XBT' ? 'BTC' : upper === 'XDG' ? 'DOGE' : upper;
}

function canonicalPair(base: string, quote: string): string {
  return `${canonicalBase(base)}${quote.trim().toUpperCase()}`;
}

function splitCanonicalSymbol(symbol: string): { base: string; quote: 'USDT' | 'USDC' | 'USD' } | null {
  const match = symbol.trim().toUpperCase().match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  return match ? { base: match[1], quote: match[2] as 'USDT' | 'USDC' | 'USD' } : null;
}

function midpoint(bid: unknown, ask: unknown, fallback?: unknown): number | null {
  const b = positive(bid);
  const a = positive(ask);
  if (b !== null && a !== null && a >= b) return (a + b) / 2;
  return positive(fallback);
}

function basisBps(perp: number | null, spot: number | null): number | null {
  if (perp === null || spot === null || spot <= 0) return null;
  return Math.abs(perp - spot) / spot * 10_000;
}

function nextUtcHour(now: number): number {
  return (Math.floor(now / 3_600_000) + 1) * 3_600_000;
}

function binanceFundingDiscoveryEnabled(): boolean {
  return process.env.CRYPTOCRAWL_BINANCE_FUTURES_DISCOVERY?.trim().toLowerCase() === 'true';
}

function isBinanceJurisdictionFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP\s*451\b|restricted location|eligibility/i.test(message);
}

async function fetchBinanceFunding(symbols: Set<string>): Promise<FundingRateObservation[]> {
  const now = Date.now();
  if (binanceJurisdictionUnavailableUntil !== null && binanceJurisdictionUnavailableUntil > now) {
    return [];
  }
  if (binanceJurisdictionUnavailableUntil !== null && binanceJurisdictionUnavailableUntil <= now) {
    binanceJurisdictionUnavailableUntil = null;
  }

  let payload: any[];
  try {
    payload = await fetchJsonWithRetry<any[]>('https://fapi.binance.com/fapi/v1/premiumIndex', REQUEST_OPTIONS);
  } catch (error) {
    if (!isBinanceJurisdictionFailure(error)) throw error;
    binanceJurisdictionFailureCount += 1;
    binanceJurisdictionUnavailableUntil = Date.now() + BINANCE_JURISDICTION_COOLDOWN_MS;
    logger.warn('[FundingDiscovery] Binance Futures jurisdiction circuit opened after HTTP 451/eligibility rejection', {
      component: 'FundingRateDiscovery',
      executionAuthority: false,
      failureCount: binanceJurisdictionFailureCount,
      cooldownMs: BINANCE_JURISDICTION_COOLDOWN_MS,
      retryAt: binanceJurisdictionUnavailableUntil,
      reason: 'jurisdiction_or_eligibility_unavailable',
    });
    throw error;
  }

  if (!Array.isArray(payload)) throw new Error('Binance USD-M premium index response was not an array');
  const observedAt = Date.now();
  return payload.flatMap(row => {
    const symbol = String(row?.symbol || '').trim().toUpperCase();
    if (!symbols.has(symbol)) return [];
    const fundingRate = finite(row?.lastFundingRate);
    if (fundingRate === null) return [];
    const spotReferencePrice = positive(row?.indexPrice);
    const perpReferencePrice = positive(row?.markPrice);
    const nextFundingTime = finite(row?.nextFundingTime);
    return [{
      venue: 'binance_futures' as const,
      symbol,
      instrumentId: symbol,
      fundingRate,
      fundingRateKind: 'last_settled_reference' as const,
      fundingRateLocked: false,
      fundingTime: null,
      nextFundingTime: nextFundingTime !== null && nextFundingTime > 0 ? nextFundingTime : null,
      spotReferencePrice,
      perpReferencePrice,
      entryBasisBps: basisBps(perpReferencePrice, spotReferencePrice),
      observedAt,
      executableWithCurrentSpotCredentials: false,
      provenance: ['binance_usdm_public_premium_index', 'public_no_auth', 'last_funding_rate_not_execution_guarantee'],
    }];
  });
}

async function fetchKrakenFunding(symbols: Set<string>): Promise<FundingRateObservation[]> {
  const payload = await fetchJsonWithRetry<any>('https://futures.kraken.com/derivatives/api/v3/tickers', REQUEST_OPTIONS);
  if (payload?.result !== 'success' || !Array.isArray(payload?.tickers)) throw new Error('Kraken Futures tickers response was unavailable');
  const observedAt = Date.now();
  return payload.tickers.flatMap((row: any) => {
    if (String(row?.tag || '').toLowerCase() !== 'perpetual') return [];
    const pair = String(row?.pair || '').trim().toUpperCase().match(/^([A-Z0-9]+):([A-Z0-9]+)$/);
    if (!pair) return [];
    const symbol = canonicalPair(pair[1], pair[2]);
    if (!symbols.has(symbol)) return [];
    const fundingRate = finite(row?.fundingRate);
    if (fundingRate === null) return [];
    const spotReferencePrice = positive(row?.indexPrice);
    const perpReferencePrice = positive(row?.markPrice);
    return [{
      venue: 'kraken_futures' as const,
      symbol,
      instrumentId: String(row?.symbol || '').trim().toUpperCase(),
      fundingRate,
      fundingRateKind: 'current_continuous_rate' as const,
      fundingRateLocked: false,
      fundingTime: null,
      nextFundingTime: nextUtcHour(observedAt),
      spotReferencePrice,
      perpReferencePrice,
      entryBasisBps: basisBps(perpReferencePrice, spotReferencePrice),
      observedAt,
      executableWithCurrentSpotCredentials: false,
      provenance: ['kraken_futures_public_tickers', 'public_no_auth', 'separate_derivatives_credentials_required_for_execution'],
    }];
  });
}

async function fetchOkxFunding(symbols: Set<string>): Promise<FundingRateObservation[]> {
  const baseUrl = await getOkxExecutionRestBaseUrl();
  const [spotPayload, swapPayload] = await Promise.all([
    fetchJsonWithRetry<any>(`${baseUrl}/api/v5/market/tickers?instType=SPOT`, REQUEST_OPTIONS),
    fetchJsonWithRetry<any>(`${baseUrl}/api/v5/market/tickers?instType=SWAP`, REQUEST_OPTIONS),
  ]);
  if (spotPayload?.code !== '0' || swapPayload?.code !== '0') throw new Error('OKX regional ticker snapshot was unavailable');

  const spotBySymbol = new Map<string, any>();
  for (const row of Array.isArray(spotPayload?.data) ? spotPayload.data : []) {
    const parts = String(row?.instId || '').trim().toUpperCase().split('-');
    if (parts.length !== 2) continue;
    spotBySymbol.set(canonicalPair(parts[0], parts[1]), row);
  }
  const swapBySymbol = new Map<string, any>();
  for (const row of Array.isArray(swapPayload?.data) ? swapPayload.data : []) {
    const parts = String(row?.instId || '').trim().toUpperCase().split('-');
    if (parts.length !== 3 || parts[2] !== 'SWAP') continue;
    swapBySymbol.set(canonicalPair(parts[0], parts[1]), row);
  }

  const selected = [...symbols]
    .map(symbol => ({ symbol, pair: splitCanonicalSymbol(symbol), swap: swapBySymbol.get(symbol), spot: spotBySymbol.get(symbol) }))
    .filter((entry): entry is { symbol: string; pair: NonNullable<ReturnType<typeof splitCanonicalSymbol>>; swap: any; spot: any } =>
      !!entry.pair && !!entry.swap && !!entry.spot)
    .slice(0, Math.max(1, Math.min(50, Number(process.env.CRYPTOCRAWL_FUNDING_OKX_SYMBOLS || 24))));

  const concurrency = Math.max(1, Math.min(6, Number(process.env.CRYPTOCRAWL_FUNDING_OKX_CONCURRENCY || 2)));
  const observations = new Array<FundingRateObservation>();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, selected.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= selected.length) return;
      const entry = selected[index];
      const instId = `${entry.pair.base}-${entry.pair.quote}-SWAP`;
      try {
        const payload = await fetchJsonWithRetry<any>(
          `${baseUrl}/api/v5/public/funding-rate?instId=${encodeURIComponent(instId)}`,
          REQUEST_OPTIONS,
        );
        const row = payload?.code === '0' ? payload?.data?.[0] : null;
        if (!row) continue;
        const displayedRate = finite(row?.fundingRate);
        const settlementRate = String(row?.settState || '').toLowerCase() === 'processing' ? finite(row?.settFundingRate) : null;
        const fundingRate = settlementRate ?? displayedRate;
        if (fundingRate === null) continue;
        const spotReferencePrice = midpoint(entry.spot?.bidPx, entry.spot?.askPx, entry.spot?.last);
        const perpReferencePrice = midpoint(entry.swap?.bidPx, entry.swap?.askPx, entry.swap?.last);
        const observedAt = Date.now();
        observations.push({
          venue: 'okx',
          symbol: entry.symbol,
          instrumentId: instId,
          fundingRate,
          fundingRateKind: settlementRate !== null ? 'settlement_rate' : 'current_estimate',
          fundingRateLocked: settlementRate !== null,
          fundingTime: finite(row?.fundingTime),
          nextFundingTime: finite(row?.nextFundingTime),
          spotReferencePrice,
          perpReferencePrice,
          entryBasisBps: basisBps(perpReferencePrice, spotReferencePrice),
          observedAt,
          executableWithCurrentSpotCredentials: true,
          provenance: [
            'okx_regional_public_funding_rate',
            'okx_regional_spot_and_swap_tickers',
            'public_no_auth_market_data',
            settlementRate !== null ? 'settlement_rate_exposed_during_processing' : 'funding_rate_can_change_before_settlement',
          ],
        });
      } catch (error) {
        logger.debug('[FundingDiscovery] OKX funding instrument unavailable', {
          component: 'FundingRateDiscovery',
          symbol: entry.symbol,
          instrumentId: instId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }));
  return observations;
}

export async function discoverFundingRates(symbolInputs: readonly string[]): Promise<FundingDiscoveryBatch> {
  const startedAt = Date.now();
  const maxSymbols = Math.max(1, Math.min(128, Number(process.env.CRYPTOCRAWL_FUNDING_SYMBOLS || 64)));
  const symbols = new Set(
    [...new Set(symbolInputs.map(symbol => symbol.trim().toUpperCase()).filter(symbol => !!splitCanonicalSymbol(symbol)))]
      .slice(0, maxSymbols),
  );
  const failures: FundingDiscoveryBatch['failures'] = [];
  const tasks: Array<{ venue: FundingDiscoveryVenue; promise: Promise<FundingRateObservation[]> }> = [
    { venue: 'kraken_futures', promise: fetchKrakenFunding(symbols) },
    { venue: 'okx', promise: fetchOkxFunding(symbols) },
  ];
  if (binanceFundingDiscoveryEnabled()) {
    tasks.push({ venue: 'binance_futures', promise: fetchBinanceFunding(symbols) });
  }
  const settled = await Promise.allSettled(tasks.map(task => task.promise));
  const observations: FundingRateObservation[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') observations.push(...result.value);
    else failures.push({
      venue: tasks[index].venue,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  });
  return {
    startedAt,
    completedAt: Date.now(),
    requestedSymbols: symbols.size,
    observations,
    failures,
  };
}
