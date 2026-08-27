import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';

export interface ScanCapacityDecision {
  universeSize: number;
  symbolBudget: number;
  workerConcurrency: number;
  searchDensityPerMinute: number;
  verifiedPositivePerMinute: number;
  unexploredFraction: number;
  reason: string;
}

function boundedInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(minimum, Math.min(maximum, normalized));
}

/**
 * Dynamic search capacity is intentionally independent from execution capacity.
 * A zero-positive market must not starve the scanner that is needed to find the
 * next positive route. Workers remain tightly bounded; breadth expands by feeding
 * more measured symbols through the same worker pool rather than multiplying
 * sockets/private-account operations without limit.
 */
export function getCexScanCapacity(universeSizeInput: number): ScanCapacityDecision {
  const universeSize = Math.max(1, Math.floor(Number.isFinite(universeSizeInput) ? universeSizeInput : 1));
  const configuredMinimum = boundedInt(process.env.CRYPTO_ARBITRAGE_MIN_SYMBOLS, 8, 1, 50);
  const configuredBase = boundedInt(process.env.CRYPTO_ARBITRAGE_BASE_SYMBOLS, 16, configuredMinimum, 50);
  const configuredMaximum = boundedInt(process.env.CRYPTO_ARBITRAGE_MAX_SYMBOLS, 32, configuredBase, 50);
  const workerMaximum = boundedInt(process.env.CRYPTO_ARBITRAGE_SCAN_CONCURRENCY, 6, 1, 8);
  const metrics = canonicalOpportunityState.getMetrics(60_000);
  const searchDensity = metrics.observedOpportunities;
  const positiveDensity = metrics.verifiedPositiveOpportunities;

  // Expand coverage when measured search throughput is weak or when no positive
  // candidate has appeared. If throughput is already healthy, retain enough spare
  // capacity to rotate through the measured universe without an abrupt API spike.
  let desired = configuredBase;
  let reason = 'base measured-universe coverage';
  if (positiveDensity === 0 && searchDensity < configuredBase) {
    desired = configuredMaximum;
    reason = 'expand discovery because verified-positive density is zero and measured search coverage is low';
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

  return {
    universeSize,
    symbolBudget,
    workerConcurrency,
    searchDensityPerMinute: searchDensity,
    verifiedPositivePerMinute: positiveDensity,
    unexploredFraction,
    reason,
  };
}
