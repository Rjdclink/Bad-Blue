import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { getLatestCexEconomicBarrier } from './cex-economic-barrier.js';

export interface ScanCapacityDecision {
  universeSize: number;
  symbolBudget: number;
  workerConcurrency: number;
  searchDensityPerMinute: number;
  verifiedPositivePerMinute: number;
  unexploredFraction: number;
  feeBarrierStatus: 'unknown' | 'fee_blocked' | 'fee_clear';
  feeBarrierCoverage: number;
  reason: string;
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
 * Dynamic search capacity is intentionally independent from execution capacity.
 * A zero-positive market must not starve the scanner that is needed to find the
 * next positive route. Workers remain tightly bounded; breadth expands by feeding
 * more measured symbols through the same worker pool rather than multiplying
 * sockets/private-account operations without limit.
 *
 * Once a fresh authenticated taker-fee barrier is repeatedly observed across a
 * meaningful fraction of the configured universe, the scanner retains base
 * discovery breadth instead of spending maximum compute rediscovering the same
 * fee-negative condition. It never stops discovery: a market move or fee-tier
 * change can therefore be detected on the next bounded cycle.
 */
export function getCexScanCapacity(universeSizeInput: number): ScanCapacityDecision {
  const universeSize = Math.max(1, Math.floor(Number.isFinite(universeSizeInput) ? universeSizeInput : 1));
  const holdMs = boundedInt(process.env.CRYPTO_ARBITRAGE_SCAN_CAPACITY_HOLD_MS, 15_000, 1_000, 60_000);
  if (heldDecision && heldDecision.decision.universeSize === universeSize && Date.now() - heldDecision.observedAt <= holdMs) {
    return { ...heldDecision.decision, reason: `${heldDecision.decision.reason}; held to prevent intra-cycle capacity oscillation` };
  }

  const configuredMinimum = boundedInt(process.env.CRYPTO_ARBITRAGE_MIN_SYMBOLS, 8, 1, 50);
  const configuredBase = boundedInt(process.env.CRYPTO_ARBITRAGE_BASE_SYMBOLS, 16, configuredMinimum, 50);
  const configuredMaximum = boundedInt(process.env.CRYPTO_ARBITRAGE_MAX_SYMBOLS, 32, configuredBase, 50);
  const workerMaximum = boundedInt(process.env.CRYPTO_ARBITRAGE_SCAN_CONCURRENCY, 6, 1, 8);
  const feeBarrierCoverageRequired = boundedFraction(process.env.CRYPTO_ARBITRAGE_FEE_BARRIER_COVERAGE, 0.25);
  const metrics = canonicalOpportunityState.getMetrics(60_000);
  const searchDensity = metrics.observedOpportunities;
  const positiveDensity = metrics.verifiedPositiveOpportunities;
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
    reason = 'maximize bounded discovery while verified-positive density is zero and no sufficiently covered fee barrier has been established';
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
  const decision: ScanCapacityDecision = {
    universeSize,
    symbolBudget,
    workerConcurrency,
    searchDensityPerMinute: searchDensity,
    verifiedPositivePerMinute: positiveDensity,
    unexploredFraction,
    feeBarrierStatus: feeBarrier?.status ?? 'unknown',
    feeBarrierCoverage: feeBarrier?.coverageFraction ?? 0,
    reason,
  };
  heldDecision = { observedAt: Date.now(), decision };
  return { ...decision };
}
