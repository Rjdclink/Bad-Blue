import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { buildBpsReductionSuperPlan, type BpsReductionSuperPlan } from '../optimization/bps-reduction-super-engine.js';
import {
  adviseEconomicTransformations,
  type EconomicTransformationAdvice,
} from '../optimization/economic-transformation-engine.js';
import {
  HYPERDYNAMIC_BPS_SOLUTIONS,
  type HyperdynamicBpsPlan,
} from '../optimization/hyperdynamic-bps-solution-engine.js';
import { buildResearchBpsExecutionPlan } from '../optimization/research-bps-execution-tactics.js';
import { getBpsCompressionMeshSnapshot } from './bps-compression-mesh.js';

export interface ApeProfitabilityToolboxPlan {
  advice: EconomicTransformationAdvice;
  superPlan: BpsReductionSuperPlan;
  hyperdynamic: HyperdynamicBpsPlan | null;
  hyperdynamicCatalogSize: number;
  activeHyperdynamicSolutionKeys: string[];
}

type CachedToolboxPlan = {
  generation: string;
  expiresAt: number;
  plan: ApeProfitabilityToolboxPlan | null;
};

const residentToolboxPlans = new Map<string, CachedToolboxPlan>();
const MAX_RESIDENT_TOOLBOX_PLANS = 512;

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

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function toolboxGeneration(opportunity: ZeroCapitalOpportunity): string {
  return `${opportunity.id}:${opportunity.timestamp}:${opportunity.expiresAt}:${opportunity.netProfitBps}:${opportunity.flashLoanAmount.toString()}`;
}

function pruneResidentToolboxPlans(now = Date.now()): void {
  for (const [key, value] of residentToolboxPlans) {
    if (value.expiresAt <= now) residentToolboxPlans.delete(key);
  }
  while (residentToolboxPlans.size > MAX_RESIDENT_TOOLBOX_PLANS) {
    const oldest = residentToolboxPlans.keys().next().value as string | undefined;
    if (!oldest) break;
    residentToolboxPlans.delete(oldest);
  }
}

/**
 * Reconnects the existing BPS Super Engine, 25 research tactics and exact
 * 100-method Hyperdynamic catalog to APE strictly as search/scheduling guidance.
 * The result is generation-fenced in resident memory so repeated rescue passes do
 * not rebuild identical advisory work while the same candidate is still fresh.
 * Advisory failure is always local: it can remove a scheduling hint, never
 * suppress measured route/provider/size rescue or change canonical economics.
 */
export function buildApeProfitabilityToolboxPlan(
  opportunity: ZeroCapitalOpportunity,
): ApeProfitabilityToolboxPlan | null {
  const now = Date.now();
  const generation = toolboxGeneration(opportunity);
  const cached = residentToolboxPlans.get(opportunity.id);
  if (cached && cached.generation === generation && cached.expiresAt > now) return cached.plan;

  let plan: ApeProfitabilityToolboxPlan | null = null;
  try {
    const candidate = measuredCandidateRegistry.get(opportunity.id);
    if (candidate && candidate.topology === 'ZERO_CAPITAL_ATOMIC') {
      const advice = adviseEconomicTransformations(candidate);
      const research = buildResearchBpsExecutionPlan(candidate, advice);
      const mesh = getBpsCompressionMeshSnapshot();
      const superPlan = buildBpsReductionSuperPlan(candidate, advice, research, null, mesh);
      plan = {
        advice,
        superPlan,
        hyperdynamic: mesh?.hyperdynamic ?? null,
        hyperdynamicCatalogSize: HYPERDYNAMIC_BPS_SOLUTIONS.length,
        activeHyperdynamicSolutionKeys: [...(mesh?.hyperdynamic.activeSolutionKeys ?? [])],
      };
    }
  } catch {
    plan = null;
  }

  residentToolboxPlans.set(opportunity.id, {
    generation,
    expiresAt: Math.max(now + 1, opportunity.expiresAt),
    plan,
  });
  pruneResidentToolboxPlans(now);
  return plan;
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

/** Hyperdynamic policy can expand or contract bounded quote work, never economics. */
export function apeTargetAttemptLimit(
  configuredBase: number,
  plan: ApeProfitabilityToolboxPlan | null,
): number {
  const policy = plan?.hyperdynamic;
  if (!policy) return clampInteger(configuredBase, 3, 16);
  const multiplier = policy.quoteBudgetMultiplier
    * Math.sqrt(Math.max(0.55, policy.zeroCapitalPriorityMultiplier))
    * Math.sqrt(Math.max(0.70, policy.liquidityFocusMultiplier));
  return clampInteger(Math.round(configuredBase * multiplier), 3, 16);
}

export function apePrefersRouteAlternatives(plan: ApeProfitabilityToolboxPlan | null): boolean {
  if (!plan) return false;
  const transforms = new Set(plan.advice.transformations);
  if (transforms.has('alternate_route_or_pool') && !transforms.has('smaller_or_split_notional')) return true;
  const policy = plan.hyperdynamic;
  if (!policy) return false;
  const routePressure = policy.venueDiversityMultiplier * policy.liquidityFocusMultiplier;
  const sizePressure = policy.sizeRefinementMultiplier;
  return routePressure > sizePressure * 1.05;
}

/**
 * Builds a bounded size search from the existing BPS toolbox. Measured fixed-cost
 * pressure explores larger safe notionals first to dilute gas/relay/bridge cost;
 * impact pressure explores smaller sizes first. Flash premium is treated as a
 * provider-cost surface rather than a fixed cost: provider selection does the
 * primary work while size probes stay close to the measured route. Super Engine
 * residual fractions and provider capacity boundaries remain first-class probes.
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
  if (driver === 'gas' || driver === 'relay' || driver === 'bridge') {
    for (const factor of [8, 5, 3, 2, 1.5, 1.25, 0.75, 0.5]) {
      const value = scaledAmount(clamped, factor);
      values.push(value > fundingCeiling ? fundingCeiling : value);
    }
  } else if (driver === 'flash_premium') {
    for (const factor of [1, 0.75, 0.5]) values.push(scaledAmount(clamped, factor));
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
  if (driver === 'gas' || driver === 'relay' || driver === 'bridge') {
    return bounded.sort((left, right) => left === right ? 0 : left > right ? -1 : 1);
  }
  if (driver === 'slippage_impact' || driver === 'latency_decay') {
    return bounded.sort((left, right) => left === right ? 0 : left < right ? -1 : 1);
  }
  return [clamped, ...bounded.filter(value => value !== clamped)];
}
