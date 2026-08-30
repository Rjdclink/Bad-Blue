import logger from '../../../logger.js';
import { getLastOrderedMarketUniverseSymbols } from '../discovery/market-universe-controller.js';
import {
  getCachedCexFeeEvidence,
  type CexFeeEvidence,
  type CexFeeVenue,
} from '../intelligence/cex-fee-resolver.js';

export interface AuthenticatedFeeTierSnapshot {
  venue: CexFeeVenue;
  symbol: string;
  takerFeeBps: number;
  makerFeeBps: number | null;
  makerRebateBps: number | null;
  observedAt: number;
  source: CexFeeEvidence['source'];
}

let schedulerInstalled = false;
let timer: NodeJS.Timeout | null = null;
let scanInFlight: Promise<void> | null = null;
let lastScanAt = 0;
const latest = new Map<string, AuthenticatedFeeTierSnapshot>();

function observationIntervalMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_AUTHENTICATED_FEE_OBSERVATION_MS || 300_000);
  return Number.isFinite(parsed) ? Math.max(60_000, Math.min(900_000, Math.trunc(parsed))) : 300_000;
}

function snapshotMaxAgeMs(): number {
  return Math.max(300_000, observationIntervalMs() * 6);
}

function key(venue: CexFeeVenue, symbol: string): string {
  return `${venue}:${symbol.trim().toUpperCase()}`;
}

function store(evidence: CexFeeEvidence): void {
  latest.set(key(evidence.venue, evidence.symbol), {
    venue: evidence.venue,
    symbol: evidence.symbol,
    takerFeeBps: evidence.takerFeeBps,
    makerFeeBps: evidence.makerFeeBps,
    makerRebateBps: evidence.makerRebateBps,
    observedAt: evidence.observedAt,
    source: evidence.source,
  });
}

async function scanOnce(symbolsInput?: readonly string[]): Promise<void> {
  if (scanInFlight) return scanInFlight;
  scanInFlight = (async () => {
    const configured = (process.env.CRYPTO_ARBITRAGE_SYMBOL || 'ETHUSDT').trim().toUpperCase();
    const symbols = [...new Set([
      configured,
      ...(symbolsInput || getLastOrderedMarketUniverseSymbols()).map(symbol => symbol.trim().toUpperCase()).filter(Boolean),
    ])].slice(0, 24);

    // Observation must never create exchange traffic. The canonical fee resolver
    // is the sole authenticated fee authority and refreshes evidence only when
    // discovery/execution actually requires it. This observer consumes only
    // already-fresh cache entries so telemetry cannot create rate-limit pressure.
    const venues: CexFeeVenue[] = ['coinbase', 'kraken', 'okx'];
    let cacheHits = 0;
    for (const venue of venues) {
      for (const symbol of symbols) {
        const evidence = getCachedCexFeeEvidence(venue, symbol);
        if (!evidence) continue;
        cacheHits += 1;
        store(evidence);
      }
    }
    lastScanAt = Date.now();

    const fresh = [...latest.values()].filter(value => Date.now() - value.observedAt <= snapshotMaxAgeMs());
    logger.info('[AuthenticatedFeeTier] Canonical authenticated fee/rebate telemetry observed', {
      component: 'AuthenticatedFeeTierOptimizationWiring',
      symbols: symbols.length,
      cacheHits,
      freshSnapshots: fresh.length,
      activeMakerRebates: fresh
        .filter(item => (item.makerRebateBps ?? 0) > 0)
        .map(item => ({ venue: item.venue, symbol: item.symbol, makerRebateBps: item.makerRebateBps })),
      observationIntervalMs: observationIntervalMs(),
      feeAuthority: 'cex_fee_resolver_only',
      directPrivateExchangeRequests: false,
      observationGeneratesExchangeTraffic: false,
      planRepricingAuthority: false,
      rebateAloneCanForceMakerMode: false,
      minimumOrderNotionalTierAssumed: false,
      executionAuthority: false,
    });
  })().finally(() => { scanInFlight = null; });
  return scanInFlight;
}

function scheduleNext(): void {
  if (process.env.NO_INTERVALS === 'true') return;
  timer = setTimeout(async () => {
    timer = null;
    await scanOnce().catch(error => {
      logger.debug('[AuthenticatedFeeTier] Canonical fee telemetry observation deferred', {
        component: 'AuthenticatedFeeTierOptimizationWiring',
        error: error instanceof Error ? error.message : String(error),
      });
    });
    scheduleNext();
  }, observationIntervalMs());
  timer.unref?.();
}

export function getAuthenticatedFeeTierSnapshot(): AuthenticatedFeeTierSnapshot[] {
  const cutoff = Date.now() - snapshotMaxAgeMs();
  return [...latest.values()]
    .filter(item => item.observedAt >= cutoff)
    .map(item => ({ ...item }));
}

export function ensureAuthenticatedFeeTierOptimizationWiring(): void {
  if (schedulerInstalled) return;
  schedulerInstalled = true;
  void scanOnce().catch(error => {
    logger.debug('[AuthenticatedFeeTier] Initial canonical fee telemetry observation deferred', {
      component: 'AuthenticatedFeeTierOptimizationWiring',
      error: error instanceof Error ? error.message : String(error),
    });
  }).finally(scheduleNext);

  logger.info('[AuthenticatedFeeTier] Cache-only canonical fee telemetry observer installed', {
    component: 'AuthenticatedFeeTierOptimizationWiring',
    observationIntervalMs: observationIntervalMs(),
    feeAuthority: 'cex_fee_resolver_only',
    privateRateAuthority: 'existing_exchange_rate_lanes_and_fee_cache',
    signedMakerEconomics: true,
    observationGeneratesExchangeTraffic: false,
    rebateAloneCanForceMakerMode: false,
    planRepricingAuthority: false,
    executionAuthority: false,
  });
}

export function getAuthenticatedFeeObservationStatus(): {
  lastScanAt: number;
  scanInFlight: boolean;
  snapshots: number;
} {
  return {
    lastScanAt,
    scanInFlight: Boolean(scanInFlight),
    snapshots: getAuthenticatedFeeTierSnapshot().length,
  };
}
