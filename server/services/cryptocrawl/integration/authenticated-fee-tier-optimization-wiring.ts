import logger from '../../../logger.js';
import { getLastOrderedMarketUniverseSymbols } from '../discovery/market-universe-controller.js';
import {
  getCachedCexFeeEvidence,
  type CexFeeEvidence,
  type CexFeeVenue,
} from '../intelligence/cex-fee-resolver.js';
import { ensureUniversalFeeOvercompensationEngine } from '../optimization/universal-fee-overcompensation-engine.js';
import { ensureCexFeeRecoveryWiring, getCexFeeRecoveryWiringStatus } from './cex-fee-recovery-wiring.js';

export interface AuthenticatedFeeTierSnapshot {
  venue: CexFeeVenue;
  symbol: string;
  takerFeeBps: number;
  makerFeeBps: number | null;
  makerRebateBps: number | null;
  observedAt: number;
  source: CexFeeEvidence['source'];
}

export interface AuthenticatedFeeTierTrajectory {
  venue: CexFeeVenue;
  symbol: string;
  samples: number;
  firstObservedAt: number;
  lastObservedAt: number;
  takerImprovementBps: number;
  makerImprovementBps: number | null;
  makerRebateImprovementBps: number | null;
  bestObservedImprovementBps: number;
  authority: 'authenticated_fee_history_advisory_only';
  futureSavingsEconomicAuthority: false;
  executionAuthority: false;
}

let schedulerInstalled = false;
let timer: NodeJS.Timeout | null = null;
let scanInFlight: Promise<void> | null = null;
let lastScanAt = 0;
const latest = new Map<string, AuthenticatedFeeTierSnapshot>();
const history = new Map<string, AuthenticatedFeeTierSnapshot[]>();

function observationIntervalMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_AUTHENTICATED_FEE_OBSERVATION_MS || 300_000);
  return Number.isFinite(parsed) ? Math.max(60_000, Math.min(900_000, Math.trunc(parsed))) : 300_000;
}

function snapshotMaxAgeMs(): number {
  return Math.max(300_000, observationIntervalMs() * 6);
}

function historyLimit(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_AUTHENTICATED_FEE_HISTORY_SAMPLES || 48);
  return Number.isFinite(parsed) ? Math.max(4, Math.min(288, Math.trunc(parsed))) : 48;
}

function key(venue: CexFeeVenue, symbol: string): string {
  return `${venue}:${symbol.trim().toUpperCase()}`;
}

function snapshot(evidence: CexFeeEvidence): AuthenticatedFeeTierSnapshot {
  return {
    venue: evidence.venue,
    symbol: evidence.symbol,
    takerFeeBps: evidence.takerFeeBps,
    makerFeeBps: evidence.makerFeeBps,
    makerRebateBps: evidence.makerRebateBps,
    observedAt: evidence.observedAt,
    source: evidence.source,
  };
}

function store(evidence: CexFeeEvidence): void {
  const next = snapshot(evidence);
  const id = key(evidence.venue, evidence.symbol);
  latest.set(id, next);
  const samples = history.get(id) || [];
  const previous = samples[samples.length - 1];
  if (previous?.observedAt === next.observedAt) return;
  samples.push(next);
  samples.sort((left, right) => left.observedAt - right.observedAt);
  if (samples.length > historyLimit()) samples.splice(0, samples.length - historyLimit());
  history.set(id, samples);
}

function improvement(first: number | null, last: number | null, rebate = false): number | null {
  if (first === null || last === null || !Number.isFinite(first) || !Number.isFinite(last)) return null;
  return rebate ? last - first : first - last;
}

function trajectory(samples: readonly AuthenticatedFeeTierSnapshot[]): AuthenticatedFeeTierTrajectory | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const takerImprovementBps = improvement(first.takerFeeBps, last.takerFeeBps) ?? 0;
  const makerImprovementBps = improvement(first.makerFeeBps, last.makerFeeBps);
  const makerRebateImprovementBps = improvement(first.makerRebateBps, last.makerRebateBps, true);
  const bestObservedImprovementBps = Math.max(
    0,
    takerImprovementBps,
    makerImprovementBps ?? 0,
    makerRebateImprovementBps ?? 0,
  );
  return {
    venue: last.venue,
    symbol: last.symbol,
    samples: samples.length,
    firstObservedAt: first.observedAt,
    lastObservedAt: last.observedAt,
    takerImprovementBps,
    makerImprovementBps,
    makerRebateImprovementBps,
    bestObservedImprovementBps,
    authority: 'authenticated_fee_history_advisory_only',
    futureSavingsEconomicAuthority: false,
    executionAuthority: false,
  };
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
    const trajectories = getAuthenticatedFeeTierTrajectory();
    logger.info('[AuthenticatedFeeTier] Canonical authenticated fee/rebate telemetry observed', {
      component: 'AuthenticatedFeeTierOptimizationWiring',
      symbols: symbols.length,
      cacheHits,
      freshSnapshots: fresh.length,
      trajectoryCount: trajectories.length,
      improvingAuthenticatedFeeSurfaces: trajectories
        .filter(item => item.bestObservedImprovementBps > 0)
        .sort((left, right) => right.bestObservedImprovementBps - left.bestObservedImprovementBps)
        .slice(0, 12)
        .map(item => ({ venue: item.venue, symbol: item.symbol, improvementBps: item.bestObservedImprovementBps })),
      activeMakerRebates: fresh
        .filter(item => (item.makerRebateBps ?? 0) > 0)
        .map(item => ({ venue: item.venue, symbol: item.symbol, makerRebateBps: item.makerRebateBps })),
      observationIntervalMs: observationIntervalMs(),
      feeAuthority: 'cex_fee_resolver_only',
      feeRecoveryObserverInstalled: getCexFeeRecoveryWiringStatus().installed,
      universalFeeOvercompensationInstalled: true,
      directPrivateExchangeRequests: false,
      observationGeneratesExchangeTraffic: false,
      organicVolumeOnly: true,
      losingTradeForFutureTierSavingsAllowed: false,
      washOrSelfTradeAllowed: false,
      futureSavingsEconomicAuthority: false,
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

export function getAuthenticatedFeeTierTrajectory(): AuthenticatedFeeTierTrajectory[] {
  const cutoff = Date.now() - Math.max(snapshotMaxAgeMs(), observationIntervalMs() * historyLimit());
  return [...history.values()]
    .map(samples => samples.filter(sample => sample.observedAt >= cutoff))
    .map(trajectory)
    .filter((item): item is AuthenticatedFeeTierTrajectory => item !== null)
    .sort((left, right) => right.bestObservedImprovementBps - left.bestObservedImprovementBps)
    .map(item => ({ ...item }));
}

export function ensureAuthenticatedFeeTierOptimizationWiring(): void {
  if (schedulerInstalled) return;
  schedulerInstalled = true;
  // The fee-recovery observer and universal overcompensation sidecar attach to
  // the already-canonical fee lifecycle; neither creates order authority or a
  // competing economics pipeline.
  ensureCexFeeRecoveryWiring();
  ensureUniversalFeeOvercompensationEngine();
  void scanOnce().catch(error => {
    logger.debug('[AuthenticatedFeeTier] Initial canonical fee telemetry observation deferred', {
      component: 'AuthenticatedFeeTierOptimizationWiring',
      error: error instanceof Error ? error.message : String(error),
    });
  }).finally(scheduleNext);

  logger.info('[AuthenticatedFeeTier] Cache-only canonical fee telemetry observer installed', {
    component: 'AuthenticatedFeeTierOptimizationWiring',
    observationIntervalMs: observationIntervalMs(),
    historySamples: historyLimit(),
    feeAuthority: 'cex_fee_resolver_only',
    feeRecoveryAuthority: 'embedded_canonical_fees_plus_received_only_recovery_observer',
    universalFeeOvercompensation: 'all_measured_topologies_plus_recursive_external_discovery_advisory',
    privateRateAuthority: 'existing_exchange_rate_lanes_and_fee_cache',
    signedMakerEconomics: true,
    organicAuthenticatedFeeTrajectory: true,
    observationGeneratesExchangeTraffic: false,
    artificialVolumeGeneration: false,
    losingTradeForFutureFeeSavingsAllowed: false,
    washOrSelfTradeAllowed: false,
    futureSavingsEconomicAuthority: false,
    rebateAloneCanForceMakerMode: false,
    planRepricingAuthority: false,
    executionAuthority: false,
  });
}

export function getAuthenticatedFeeObservationStatus(): {
  lastScanAt: number;
  scanInFlight: boolean;
  snapshots: number;
  trajectories: number;
  feeRecoveryInstalled: boolean;
} {
  return {
    lastScanAt,
    scanInFlight: Boolean(scanInFlight),
    snapshots: getAuthenticatedFeeTierSnapshot().length,
    trajectories: getAuthenticatedFeeTierTrajectory().length,
    feeRecoveryInstalled: getCexFeeRecoveryWiringStatus().installed,
  };
}
