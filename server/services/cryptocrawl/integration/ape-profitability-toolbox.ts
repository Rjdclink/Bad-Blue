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
import { buildApeDefectVector } from './ape-hypergraph-intelligence.js';

export interface ApeProfitabilityToolboxPlan {
  advice: EconomicTransformationAdvice;
  superPlan: BpsReductionSuperPlan;
  hyperdynamic: HyperdynamicBpsPlan | null;
  hyperdynamicCatalogSize: number;
  activeHyperdynamicSolutionKeys: string[];
  deterministicGrossSignFallback?: boolean;
}

type CachedToolboxPlan = {
  generation: string;
  expiresAt: number;
  plan: ApeProfitabilityToolboxPlan | null;
  ready: boolean;
};

const residentToolboxPlans = new Map<string, CachedToolboxPlan>();
const residentToolboxBuilds = new Set<string>();
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

function toolboxPlanTtlMs(): number {
  const configured = Number(process.env.ZERO_CAPITAL_APE_TOOLBOX_PLAN_TTL_MS || 5_000);
  return Number.isFinite(configured) ? Math.max(500, Math.min(30_000, Math.trunc(configured))) : 5_000;
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

function computeToolboxPlan(opportunity: ZeroCapitalOpportunity): ApeProfitabilityToolboxPlan | null {
  try {
    const candidate = measuredCandidateRegistry.get(opportunity.id);
    if (!candidate || candidate.topology !== 'ZERO_CAPITAL_ATOMIC') return null;
    const advice = adviseEconomicTransformations(candidate);
    const research = buildResearchBpsExecutionPlan(candidate, advice);
    const mesh = getBpsCompressionMeshSnapshot();
    const superPlan = buildBpsReductionSuperPlan(candidate, advice, research, null, mesh);
    return {
      advice,
      superPlan,
      hyperdynamic: mesh?.hyperdynamic ?? null,
      hyperdynamicCatalogSize: HYPERDYNAMIC_BPS_SOLUTIONS.length,
      activeHyperdynamicSolutionKeys: [...(mesh?.hyperdynamic.activeSolutionKeys ?? [])],
    };
  } catch {
    return null;
  }
}

function scheduleToolboxPrewarm(opportunity: ZeroCapitalOpportunity, generation: string): void {
  const key = `${opportunity.id}:${generation}`;
  if (residentToolboxBuilds.has(key)) return;
  residentToolboxBuilds.add(key);
  const task = setImmediate(() => {
    try {
      const currentGeneration = toolboxGeneration(opportunity);
      if (currentGeneration !== generation) return;
      residentToolboxPlans.set(opportunity.id, {
        generation,
        expiresAt: Date.now() + toolboxPlanTtlMs(),
        plan: computeToolboxPlan(opportunity),
        ready: true,
      });
      pruneResidentToolboxPlans();
    } finally {
      residentToolboxBuilds.delete(key);
    }
  });
  task.unref?.();
}

/**
 * A gross-negative candidate cannot be repaired by cost reduction or notional
 * resizing alone. This zero-I/O deterministic fallback therefore chooses route
 * transformation immediately while the richer advisory plan prewarms. It carries
 * no economic or execution authority and disappears as soon as resident advice is
 * ready. This removes the old null-plan => size-first semantic accident.
 */
function deterministicStructuralFallback(opportunity: ZeroCapitalOpportunity): ApeProfitabilityToolboxPlan | null {
  const defect = buildApeDefectVector(opportunity);
  if (!defect.structuralEdgeDefect) return null;
  const requiredRecoveryBps = Number.isFinite(opportunity.netProfitBps) && opportunity.netProfitBps < 0
    ? Math.abs(opportunity.netProfitBps)
    : null;
  const advice: EconomicTransformationAdvice = {
    opportunityId: opportunity.id,
    topology: 'ZERO_CAPITAL_ATOMIC',
    dominantCostDriver: 'unknown',
    dominantCostBps: null,
    netProfitBps: Number.isFinite(opportunity.netProfitBps) ? opportunity.netProfitBps : null,
    bpsToBreakEven: requiredRecoveryBps,
    requiredRecoveryBps,
    dominantCostCoverageRatio: null,
    dominantCostAloneCouldCoverGap: false,
    transformations: ['alternate_route_or_pool', 'retain_for_measurement'],
    priorityScore: 1,
    evidenceCompletenessScore: 1,
    freshnessScore: opportunity.expiresAt > Date.now() ? 1 : 0,
    transformationFeasibilityScore: 1,
    authority: 'optimization_advisory_only',
    executionAuthority: false,
    provenance: [
      'deterministic_gross_sign_rescue_classifier',
      'gross_nonpositive_requires_edge_transformation',
      'no_advisory_wait',
      'synthetic_economics:false',
    ],
  };
  return {
    advice,
    superPlan: { residualNotionalFractions: [] } as unknown as BpsReductionSuperPlan,
    hyperdynamic: null,
    hyperdynamicCatalogSize: HYPERDYNAMIC_BPS_SOLUTIONS.length,
    activeHyperdynamicSolutionKeys: [],
    deterministicGrossSignFallback: true,
  };
}

/**
 * Returns resident advisory intelligence when available. Missing advisory state is
 * prewarmed after the current decision turn and never blocks exact rescue. The only
 * synchronous fallback is deterministic gross-sign classification, which makes a
 * structural-negative candidate route-first without performing extra I/O.
 */
export function buildApeProfitabilityToolboxPlan(
  opportunity: ZeroCapitalOpportunity,
): ApeProfitabilityToolboxPlan | null {
  const now = Date.now();
  const generation = toolboxGeneration(opportunity);
  const cached = residentToolboxPlans.get(opportunity.id);
  if (cached && cached.generation === generation && cached.expiresAt > now && cached.ready) {
    return cached.plan ?? deterministicStructuralFallback(opportunity);
  }

  residentToolboxPlans.set(opportunity.id, {
    generation,
    expiresAt: now + toolboxPlanTtlMs(),
    plan: null,
    ready: false,
  });
  pruneResidentToolboxPlans(now);
  scheduleToolboxPrewarm(opportunity, generation);
  return deterministicStructuralFallback(opportunity);
}

/** Every finite non-positive candidate stays APE-owned regardless evidence age. */
export function isApeRescueCandidate(
  opportunity: ZeroCapitalOpportunity,
  _graceMs: number,
  _now = Date.now(),
): boolean {
  return opportunity.flashLoanAmount > 0n
    && Number.isFinite(opportunity.netProfitBps)
    && opportunity.expectedProfit <= 0n;
}

/** Hyperdynamic policy can expand or contract one quote wave, never candidate survival. */
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
 * Builds a bounded size wave from the existing BPS toolbox. Measured fixed-cost
 * pressure explores larger safe notionals first to dilute gas/relay/bridge cost;
 * impact pressure explores smaller sizes first. A bounded wave is only a latency
 * control: unresolved candidate ownership continues into later evidence generations.
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
