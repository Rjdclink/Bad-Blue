import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { buildBpsReductionSuperPlan, type BpsReductionSuperPlan } from '../optimization/bps-reduction-super-engine.js';
import {
  adviseEconomicTransformations,
  type EconomicTransformationAdvice,
} from '../optimization/economic-transformation-engine.js';
import { buildResearchBpsExecutionPlan } from '../optimization/research-bps-execution-tactics.js';
import { getBpsCompressionMeshSnapshot } from './bps-compression-mesh.js';

export interface ApeProfitabilityToolboxPlan {
  advice: EconomicTransformationAdvice;
  superPlan: BpsReductionSuperPlan;
}

function scaledAmount(amount: bigint, factor: number): bigint {
  if (amount <= 0n || !Number.isFinite(factor) || factor <= 0) return 0n;
  const scale = 1_000_000n;
  const numerator = BigInt(Math.max(1, Math.round(factor * Number(scale))));
  const value = amount * numerator / scale;
  return value > 0n ? value : 1n;
}

function uniqueBounded(values: readonly bigint[], ceiling: bigint): bigint[] {
  const seen = new Set<string>();
  const result: bigint[] = [];
  for (const value of values) {
    if (value <= 0n || value > ceiling) continue;
    const key = value.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

/**
 * Reconnects the existing BPS Super Engine and transformation intelligence to the
 * Atomic Profitability Engine strictly as search/scheduling guidance. It never
 * changes canonical economics, grants execution authority, or manufactures BPS.
 */
export function buildApeProfitabilityToolboxPlan(
  opportunity: ZeroCapitalOpportunity,
): ApeProfitabilityToolboxPlan | null {
  const candidate = measuredCandidateRegistry.get(opportunity.id);
  if (!candidate || candidate.topology !== 'ZERO_CAPITAL_ATOMIC') return null;
  const advice = adviseEconomicTransformations(candidate);
  const research = buildResearchBpsExecutionPlan(candidate, advice);
  const superPlan = buildBpsReductionSuperPlan(
    candidate,
    advice,
    research,
    null,
    getBpsCompressionMeshSnapshot(),
  );
  return { advice, superPlan };
}

/**
 * APE owns every live, finite, negative Stage-1 candidate it receives. There is
 * deliberately no fixed BPS entry floor here: profitability is determined only
 * by exact all-in economics after bounded compatible transformations are tried.
 */
export function isApeRescueCandidate(
  opportunity: ZeroCapitalOpportunity,
  graceMs: number,
  now = Date.now(),
): boolean {
  return opportunity.expiresAt + Math.max(0, graceMs) > now
    && opportunity.flashLoanAmount > 0n
    && Number.isFinite(opportunity.netProfitBps)
    && opportunity.expectedProfit <= 0n;
}

export function apePrefersRouteAlternatives(plan: ApeProfitabilityToolboxPlan | null): boolean {
  if (!plan) return false;
  const transforms = new Set(plan.advice.transformations);
  return transforms.has('alternate_route_or_pool')
    && !transforms.has('smaller_or_split_notional');
}

/**
 * Builds a bounded size search from the existing BPS toolbox. Fixed-cost pressure
 * explores larger safe notionals first to dilute gas/relay/flash overhead; impact
 * pressure explores smaller sizes first; Super Engine residual fractions are
 * always retained when applicable. Provider capacity boundaries are first-class
 * probes instead of rejection conditions.
 */
export function buildApeTargetAmounts(input: {
  intended: bigint;
  fundingCeiling: bigint;
  providerCapacityBoundaries: readonly bigint[];
  plan: ApeProfitabilityToolboxPlan | null;
}): bigint[] {
  const { intended, fundingCeiling, providerCapacityBoundaries, plan } = input;
  if (intended <= 0n || fundingCeiling <= 0n) return [];
  const clamped = intended < fundingCeiling ? intended : fundingCeiling;
  const values: bigint[] = [clamped];

  for (const capacity of providerCapacityBoundaries) {
    if (capacity > 0n && capacity <= fundingCeiling) values.push(capacity);
  }

  for (const fraction of plan?.superPlan.residualNotionalFractions ?? []) {
    if (Number.isFinite(fraction) && fraction > 0) values.push(scaledAmount(clamped, fraction));
  }

  const driver = plan?.advice.dominantCostDriver ?? 'unknown';
  if (driver === 'gas' || driver === 'relay' || driver === 'bridge' || driver === 'flash_premium') {
    for (const factor of [8, 5, 3, 2, 1.5, 1.25, 0.75, 0.5]) {
      values.push(scaledAmount(clamped, factor) > fundingCeiling ? fundingCeiling : scaledAmount(clamped, factor));
    }
  } else if (driver === 'slippage_impact' || driver === 'latency_decay') {
    for (const factor of [0.25, 0.35, 0.4, 0.5, 0.6, 0.7, 0.85, 1]) {
      values.push(scaledAmount(clamped, factor));
    }
  } else if (driver === 'exchange_fees') {
    for (const factor of [1, 0.75, 0.5]) values.push(scaledAmount(clamped, factor));
  } else {
    for (const factor of [1, 0.75, 0.5, 0.35, 1.5, 2]) {
      const value = scaledAmount(clamped, factor);
      values.push(value > fundingCeiling ? fundingCeiling : value);
    }
  }

  const bounded = uniqueBounded(values, fundingCeiling);
  if (driver === 'gas' || driver === 'relay' || driver === 'bridge' || driver === 'flash_premium') {
    return bounded.sort((left, right) => left === right ? 0 : left > right ? -1 : 1);
  }
  if (driver === 'slippage_impact' || driver === 'latency_decay') {
    return bounded.sort((left, right) => left === right ? 0 : left < right ? -1 : 1);
  }
  return [
    clamped,
    ...bounded.filter(value => value !== clamped),
  ];
}
