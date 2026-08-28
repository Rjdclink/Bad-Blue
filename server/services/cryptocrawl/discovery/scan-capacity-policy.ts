import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { getLatestCexEconomicBarrier } from './cex-economic-barrier.js';

export interface ScanCapacityDecision {
  universeSize: number;
  symbolBudget: number;
  workerConcurrency: number;
  recommendedIntervalMs: number;
  searchDensityPerMinute: number;
  verifiedPositivePerMinute: number;
  eligiblePerMinute: number;
  unexploredFraction: number;
  feeBarrierStatus: 'unknown' | 'fee_blocked' | 'fee_clear';
  feeBarrierCoverage: number;
  reason: string;
}

export interface CexScanCadenceInput {
  positiveDensity: number;
  eligibleDensity: number;
  searchDensity: number;
  feeBlockedWithCoverage: boolean;
  configuredMinimum: number;
  configuredMaximum: number;
  minimumIntervalMs?: number;
  baseIntervalMs?: number;
  maximumIntervalMs?: number;
}

let heldDecision: { observedAt: number; decision: ScanCapacityDecision } | null = null;

function boundedInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(minimum, Math.min(maximum, normalized));
}

function boundedFraction(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Math.max(0.1, Math.min(1, Number.isFinite(parsed) ? parsed : fallback));
}

/**
 * Pure cadence decision used by the live capacity policy and regression tests.
 * Execution is deliberately absent from the output: this function can only tune
 * how soon discovery runs again, never pause an eligible profitable trade.
 */
export function recommendedCexScanIntervalMs(input: CexScanCadenceInput): number {
  const minimumMs = boundedInt(
    input.minimumIntervalMs ?? process.env.CRYPTOCRAWL_SCAN_INTERVAL_MIN_MS,
    2_000,
    1_000,
    10_000,
  );
  const baseMs = boundedInt(
    input.baseIntervalMs ?? process.env.CRYPTOCRAWL_SCAN_INTERVAL_BASE_MS,
    5_000,
    minimumMs,
    30_000,
  );
  const maximumMs = boundedInt(
    input.maximumIntervalMs ?? process.env.CRYPTOCRAWL_SCAN_INTERVAL_MAX_MS,
    15_000,
    baseMs,
    60_000,
  );

  // Activity is measured from real candidate flow rather than fixed wall-clock
  // "high volume" hours. Crypto is global and regime changes do not respect a
  // local schedule. Execution continues independently at all times; only search
  // cadence is adjusted here.
  if (input.eligibleDensity > 0 || input.positiveDensity > 0) return minimumMs;
  if (input.searchDensity < input.configuredMinimum) return Math.max(minimumMs, Math.floor(baseMs * 0.6));
  if (input.feeBlockedWithCoverage) return Math.min(maximumMs, Math.max(baseMs, Math.floor(baseMs * 2)));
  if (input.searchDensity >= input.configuredMaximum * 2) return Math.min(maximumMs, Math.max(baseMs, Math.floor(baseMs * 1.5)));
  return baseMs;
}

/**
 * Dynamic search capacity is intentionally independent from execution capacity.
 * A zero-positive market must not starve the scanner that is needed to find the
 * next positive route. Workers remain tightly bounded; breadth expands by feeding
 * more measured symbols through the same worker pool rather than multiplying
 * sockets/private-account operations without limit.
 *
 * Public CEX discovery is now batched per venue, so the breadth ceiling can be
 * widened substantially without linearly multiplying public HTTP requests. The
 * executable private-account worker pool remains capped at eight to protect
 * account, nonce, order-book and authenticated fee authorities.
 *
 * Once a fresh authenticated taker-fee barrier is repeatedly observed across a
 * meaningful fraction of the configured universe, the scanner retains base
 * discovery breadth and slows only the discovery cadence instead of spending
 * maximum compute rediscovering the same fee-negative condition. It never stops
 * discovery: a market move or fee-tier change is still detected on a bounded
 * future cycle, and execution is never paused merely because market activity is
 * low.
 */
export function getCexScanCapacity(universeSizeInput: number): ScanCapacityDecision {
  const universeSize = Math.max(1, Math.floor(Number.isFinite(universeSizeInput) ? universeSizeInput : 1));
  const holdMs = boundedInt(process.env.CRYPTO_ARBITRAGE_SCAN_CAPACITY_HOLD_MS, 15_000, 1_000, 60_000);
  if (heldDecision && heldDecision.decision.universeSize === universeSize && Date.now() - heldDecision.observedAt <= holdMs) {
    return { ...heldDecision.decision, reason: `${heldDecision.decision.reason}; held to prevent intra-cycle capacity oscillation` };
  }

  const configuredMinimum = boundedInt(process.env.CRYPTO_ARBITRAGE_MIN_SYMBOLS, 12, 1, 128);
  const configuredBase = boundedInt(process.env.CRYPTO_ARBITRAGE_BASE_SYMBOLS, 24, configuredMinimum, 128);
  const configuredMaximum = boundedInt(process.env.CRYPTO_ARBITRAGE_MAX_SYMBOLS, 96, configuredBase, 128);
  const workerMaximum = boundedInt(process.env.CRYPTO_ARBITRAGE_SCAN_CONCURRENCY, 6, 1, 8);
  const feeBarrierCoverageRequired = boundedFraction(process.env.CRYPTO_ARBITRAGE_FEE_BARRIER_COVERAGE, 0.25);
  const metrics = canonicalOpportunityState.getMetrics(60_000);
  const searchDensity = metrics.observedOpportunities;
  const positiveDensity = metrics.verifiedPositiveOpportunities;
  const eligibleDensity = metrics.eligibleOpportunities;
  const feeBarrier = getLatestCexEconomicBarrier(Math.max(30_000, holdMs * 2));
  const feeBlockedWithCoverage = feeBarrier?.status === 'fee_blocked'
    && feeBarrier.coverageFraction >= feeBarrierCoverageRequired
    && searchDensity >= configuredMinimum;

  let desired = configuredBase;
  let reason = 'base measured-universe coverage';
  if (positiveDensity === 0 && feeBlockedWithCoverage) {
    desired = configuredBase;
    reason = `authenticated taker-fee floor exceeds the best sampled gross spread; retain bounded base discovery while waiting for market or fee-tier change (${feeBarrier!.feeReductionNeededBps?.toFixed(2) ?? 'unknown'} bps fee reduction needed before other costs)`;
  } else if (positiveDensity === 0) {
    desired = configuredMaximum;
    reason = 'maximize bounded discovery breadth while verified-positive density is zero and no sufficiently covered fee barrier has been established';
  } else if (searchDensity < configuredMinimum) {
    desired = Math.min(configuredMaximum, Math.max(configuredBase, configuredMinimum * 2));
    reason = 'expand discovery because measured candidate flow is below minimum coverage';
  } else if (searchDensity >= configuredMaximum * 2) {
    desired = configuredBase;
    reason = 'retain bounded base breadth because current measured search throughput is already high';
  } else {
    desired = Math.min(configuredMaximum, configuredBase + Math.ceil((configuredMaximum - configuredBase) / 2));
    reason = 'moderate expansion within configured provider-safe ceiling';
  }

  const symbolBudget = Math.max(1, Math.min(universeSize, desired));
  const workerConcurrency = Math.max(1, Math.min(workerMaximum, symbolBudget));
  const unexploredFraction = universeSize <= symbolBudget ? 0 : (universeSize - symbolBudget) / universeSize;
  const recommendedIntervalMs = recommendedCexScanIntervalMs({
    positiveDensity,
    eligibleDensity,
    searchDensity,
    feeBlockedWithCoverage,
    configuredMinimum,
    configuredMaximum,
  });
  const decision: ScanCapacityDecision = {
    universeSize,
    symbolBudget,
    workerConcurrency,
    recommendedIntervalMs,
    searchDensityPerMinute: searchDensity,
    verifiedPositivePerMinute: positiveDensity,
    eligiblePerMinute: eligibleDensity,
    unexploredFraction,
    feeBarrierStatus: feeBarrier?.status ?? 'unknown',
    feeBarrierCoverage: feeBarrier?.coverageFraction ?? 0,
    reason,
  };
  heldDecision = { observedAt: Date.now(), decision };
  return { ...decision };
}
