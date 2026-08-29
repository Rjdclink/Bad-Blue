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
  executionVariantsPerSymbol: number;
  estimatedExecutionVariantsPerCycle: number;
  targetExecutionVariantsMin: number;
  targetExecutionVariantsMax: number;
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
 * Conservative local-formation accounting for the no-new-key Kraken/OKX path.
 * The taker verifier has eleven depth/notional points in two ordered directions
 * (22 variants). Maker recovery independently evaluates both ordered directions
 * (2 more). That gives 24 economically distinct forms per measured symbol without
 * inventing maker size variants that the runtime does not actually evaluate.
 *
 * This is search breadth telemetry only. A formed variant is not represented as
 * executable or profitable until its normal fee/depth/freshness/governance gates
 * establish that independently.
 */
function executionVariantsPerSymbol(): number {
  return boundedInt(process.env.CRYPTOCRAWL_EXECUTION_VARIANTS_PER_SYMBOL, 24, 1, 256);
}

function targetExecutionVariantRange(): { min: number; max: number; midpoint: number } {
  const min = boundedInt(process.env.CRYPTOCRAWL_EXECUTION_VARIANTS_MIN, 2_000, 256, 20_000);
  const max = boundedInt(process.env.CRYPTOCRAWL_EXECUTION_VARIANTS_MAX, 4_000, min, 40_000);
  return { min, max, midpoint: Math.floor((min + max) / 2) };
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

  if (input.eligibleDensity > 0 || input.positiveDensity > 0) return minimumMs;
  if (input.searchDensity < input.configuredMinimum) return Math.max(minimumMs, Math.floor(baseMs * 0.6));
  if (input.feeBlockedWithCoverage) return Math.min(maximumMs, Math.max(baseMs, Math.floor(baseMs * 2)));
  if (input.searchDensity >= input.configuredMaximum * 2) return Math.min(maximumMs, Math.max(baseMs, Math.floor(baseMs * 1.5)));
  return baseMs;
}

/**
 * Dynamic search capacity is independent from execution capacity. The breadth
 * objective is expressed in economically distinct local execution formations,
 * not repeated RPC/API calls. Shared measured books and cached authenticated fee
 * evidence are reused by the Computational Beam/Aries/Cryptara path.
 *
 * A taker-fee barrier cannot collapse discovery to a tiny symbol set because the
 * maker route has different economics. Capacity therefore preserves enough symbol
 * breadth to target roughly 2,000-4,000 local execution forms while retaining the
 * same bounded private worker pool and adaptive cadence.
 */
export function getCexScanCapacity(universeSizeInput: number): ScanCapacityDecision {
  const universeSize = Math.max(1, Math.floor(Number.isFinite(universeSizeInput) ? universeSizeInput : 1));
  const holdMs = boundedInt(process.env.CRYPTO_ARBITRAGE_SCAN_CAPACITY_HOLD_MS, 15_000, 1_000, 60_000);
  if (heldDecision && heldDecision.decision.universeSize === universeSize && Date.now() - heldDecision.observedAt <= holdMs) {
    return { ...heldDecision.decision, reason: `${heldDecision.decision.reason}; held to prevent intra-cycle capacity oscillation` };
  }

  const variantsPerSymbol = executionVariantsPerSymbol();
  const variantTarget = targetExecutionVariantRange();
  const derivedMinimumSymbols = Math.max(1, Math.ceil(variantTarget.min / variantsPerSymbol));
  const derivedBaseSymbols = Math.max(derivedMinimumSymbols, Math.ceil(variantTarget.midpoint / variantsPerSymbol));
  const derivedMaximumSymbols = Math.max(derivedBaseSymbols, Math.ceil(variantTarget.max / variantsPerSymbol));

  const configuredMinimum = boundedInt(process.env.CRYPTO_ARBITRAGE_MIN_SYMBOLS, derivedMinimumSymbols, 1, 256);
  const configuredBase = boundedInt(process.env.CRYPTO_ARBITRAGE_BASE_SYMBOLS, derivedBaseSymbols, configuredMinimum, 256);
  const configuredMaximum = boundedInt(process.env.CRYPTO_ARBITRAGE_MAX_SYMBOLS, derivedMaximumSymbols, configuredBase, 256);
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
  let reason = 'execution-variant midpoint coverage using bounded measured inputs';
  if (positiveDensity === 0 && feeBlockedWithCoverage) {
    desired = configuredBase;
    reason = `taker fee barrier observed, but maker/size transformations remain worth searching; preserve ~${variantTarget.midpoint} local execution forms (${feeBarrier!.feeReductionNeededBps?.toFixed(2) ?? 'unknown'} bps taker reduction needed)`;
  } else if (positiveDensity === 0) {
    desired = configuredMaximum;
    reason = 'expand toward the configured 2k-4k execution-variant search envelope while verified-positive density is zero';
  } else if (searchDensity < configuredMinimum) {
    desired = Math.min(configuredMaximum, Math.max(configuredBase, configuredMinimum * 2));
    reason = 'expand discovery because measured candidate flow is below minimum variant coverage';
  } else if (searchDensity >= configuredMaximum * 2) {
    desired = configuredBase;
    reason = 'retain midpoint variant breadth because current measured search throughput is already high';
  } else {
    desired = Math.min(configuredMaximum, configuredBase + Math.ceil((configuredMaximum - configuredBase) / 2));
    reason = 'moderate expansion inside the provider-safe execution-variant envelope';
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
    executionVariantsPerSymbol: variantsPerSymbol,
    estimatedExecutionVariantsPerCycle: symbolBudget * variantsPerSymbol,
    targetExecutionVariantsMin: variantTarget.min,
    targetExecutionVariantsMax: variantTarget.max,
    reason,
  };
  heldDecision = { observedAt: Date.now(), decision };
  return { ...decision };
}
