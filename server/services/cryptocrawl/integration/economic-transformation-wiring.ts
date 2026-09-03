import logger from '../../../logger.js';
import { queueCexResidualReplan } from '../discovery/cex-residual-replan.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import { measuredOpportunityGraph } from '../discovery/opportunity-graph.js';
import { getProfitLadderNotionalAuthority } from '../governance/profit-ladder-notional-authority.js';
import { adviseEconomicTransformations, type EconomicTransformationAdvice } from '../optimization/economic-transformation-engine.js';
import { estimateOpportunityDecay } from '../optimization/opportunity-decay-model.js';
import {
  buildResearchBpsExecutionPlan,
  getRawCrossVenueEdge,
  runResearchBpsQuantiMonteCarlo,
} from '../optimization/research-bps-execution-tactics.js';
import { getClosestCexNearMissesBySymbol } from './cex-four-mode-observability-wiring.js';

let timer: NodeJS.Timeout | null = null;
let latest: EconomicTransformationAdvice[] = [];
let recordHookInstalled = false;
const actionInFlight = new Map<string, Promise<void>>();
const actionCooldownUntil = new Map<string, number>();
const anomalyInFlight = new Map<string, Promise<void>>();
const anomalyCooldownUntil = new Map<string, number>();
const residualFractionCursor = new Map<string, number>();

function maxPerTopologyDriver(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_BPS_RESCUE_MAX_PER_TOPOLOGY_DRIVER || 24);
  return Number.isFinite(parsed) ? Math.max(4, Math.min(64, Math.trunc(parsed))) : 24;
}

function minFeasibility(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_BPS_RESCUE_MIN_FEASIBILITY || 0.15);
  return Number.isFinite(parsed) ? Math.max(0.05, Math.min(0.9, parsed)) : 0.15;
}

function operationalCooldownMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_BPS_TRANSFORM_ACTION_COOLDOWN_MS || 5_000);
  return Number.isFinite(parsed) ? Math.max(500, Math.min(60_000, Math.trunc(parsed))) : 5_000;
}

function anomalyCooldownMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_ANOMALY_REVALIDATION_COOLDOWN_MS || 5_000);
  return Number.isFinite(parsed) ? Math.max(500, Math.min(60_000, Math.trunc(parsed))) : 5_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function candidateSymbol(candidate: MeasuredCandidate): string | null {
  const asset = candidate.assets.find(Boolean)?.trim().toUpperCase();
  if (asset) return asset;
  const quoteSymbol = candidate.rawQuotes.find(row => row.symbol)?.symbol?.trim().toUpperCase();
  return quoteSymbol || null;
}

function queueAnomalyRevalidation(candidate: MeasuredCandidate): void {
  if (candidate.topology !== 'CEX_CEX' || candidate.status !== 'observed') return;
  const edge = getRawCrossVenueEdge(candidate);
  if (!edge || !(edge.grossEdgeBps > 0)) return;
  const symbol = candidateSymbol(candidate);
  if (!symbol) return;
  if (anomalyInFlight.has(symbol) || (anomalyCooldownUntil.get(symbol) || 0) > Date.now()) return;

  const plan = buildResearchBpsExecutionPlan(candidate, null);
  const attempts = Math.max(1, plan.anomalyRevalidationAttempts);
  const delays = plan.anomalyRetryDelaysMs.length > 0 ? plan.anomalyRetryDelaysMs : [0];
  const task = (async () => {
    let previousDelay = 0;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const targetDelay = delays[Math.min(attempt, delays.length - 1)] || 0;
      await sleep(Math.max(0, targetDelay - previousDelay));
      previousDelay = targetDelay;
      const cycle = await measuredOpportunityGraph.revalidateSymbols([symbol]);
      logger.info('[EconomicTransformation] Raw positive CEX observation received fresh canonical reassessment', {
        component: 'EconomicTransformationWiring',
        opportunityId: candidate.opportunityId,
        symbol,
        rawEdgeBps: edge.grossEdgeBps,
        observedBuyVenue: edge.buyVenue,
        observedSellVenue: edge.sellVenue,
        attempt: attempt + 1,
        attempts,
        canonicalDeterministicPositive: cycle.deterministicPositive,
        canonicalEligibleCandidates: cycle.eligibleCandidates,
        canonicalCycleId: cycle.cycleId,
        criticalEvidenceAcquisition: [
          'fresh_executable_books',
          'authenticated_fee_evidence',
          'product_constraints',
          'depth_aware_notional',
          'deterministic_all_in_economics',
          'cryptara_and_monte_carlo_if_deterministic_positive',
        ],
        anomalyDiscardedWithoutRecheck: false,
        observationExecutionAuthority: false,
      });
      if (cycle.deterministicPositive > 0 || cycle.eligibleCandidates > 0) break;
    }
  })().catch(error => {
    logger.warn('[EconomicTransformation] Raw positive CEX anomaly reassessment degraded', {
      component: 'EconomicTransformationWiring',
      symbol,
      rawEdgeBps: edge.grossEdgeBps,
      error: error instanceof Error ? error.message : String(error),
      executionAuthority: false,
    });
  }).finally(() => {
    anomalyInFlight.delete(symbol);
    anomalyCooldownUntil.set(symbol, Date.now() + anomalyCooldownMs());
  });
  anomalyInFlight.set(symbol, task);
}

function installObservedCandidateRevalidationHook(): void {
  if (recordHookInstalled) return;
  recordHookInstalled = true;
  const registry = measuredCandidateRegistry as typeof measuredCandidateRegistry & {
    record: (input: any) => MeasuredCandidate;
  };
  const originalRecord = registry.record.bind(registry);
  registry.record = (input: any): MeasuredCandidate => {
    const recorded = originalRecord(input);
    queueAnomalyRevalidation(recorded);
    return recorded;
  };
  logger.info('[EconomicTransformation] Positive raw-observation reassessment hook installed', {
    component: 'EconomicTransformationWiring',
    trigger: 'any_measured_cross_venue_raw_edge_greater_than_zero',
    reacquisition: 'bounded_exact_symbol_canonical_revalidation',
    anomalyDiscardWithoutRecheck: false,
    executionAuthority: false,
  });
}

function nextResidualFraction(symbol: string, fractions: readonly number[]): number | null {
  if (fractions.length === 0) return null;
  const cursor = residualFractionCursor.get(symbol) || 0;
  const fraction = fractions[cursor % fractions.length];
  residualFractionCursor.set(symbol, cursor + 1);
  return fraction;
}

function queueOperationalTransformation(candidate: MeasuredCandidate, advice: EconomicTransformationAdvice): void {
  if (candidate.expiresAt <= Date.now()) return;
  if (candidate.topology !== 'CEX_CEX' && candidate.topology !== 'MAKER_CEX') return;
  const key = candidate.opportunityId;
  if (actionInFlight.has(key) || (actionCooldownUntil.get(key) || 0) > Date.now()) return;
  const symbol = candidateSymbol(candidate);
  if (!symbol) return;

  const task = (async () => {
    const plan = buildResearchBpsExecutionPlan(candidate, advice);
    const mc = await runResearchBpsQuantiMonteCarlo(candidate, plan).catch(error => {
      logger.debug('[EconomicTransformation] Quanti Comp Monte Carlo tactic ranking degraded', {
        component: 'EconomicTransformationWiring',
        opportunityId: candidate.opportunityId,
        symbol,
        error: error instanceof Error ? error.message : String(error),
        executionAuthority: false,
      });
      return null;
    });

    let canonicalCycle: Awaited<ReturnType<typeof measuredOpportunityGraph.revalidateSymbols>> | null = null;
    if (plan.canonicalRevalidationRequested) {
      canonicalCycle = await measuredOpportunityGraph.revalidateSymbols([symbol]);
    }

    const parentNotionalUsd = Number(candidate.economics.notionalUsd || 0);
    const fraction = nextResidualFraction(symbol, plan.residualNotionalFractions);
    if (fraction !== null && parentNotionalUsd > 0) {
      queueCexResidualReplan({
        symbol,
        remainingNotionalUsd: parentNotionalUsd * fraction,
        sourceParentNotionalUsd: parentNotionalUsd,
      });
    }

    logger.info('[EconomicTransformation] Measured transformation converted into canonical revalidation work', {
      component: 'EconomicTransformationWiring',
      opportunityId: candidate.opportunityId,
      symbol,
      dominantCostDriver: advice.dominantCostDriver,
      bpsToBreakEven: advice.bpsToBreakEven,
      transformations: advice.transformations,
      activeResearchTactics: plan.activeTacticKeys,
      activeResearchTacticCount: plan.activeTacticKeys.length,
      quantiCompMonteCarlo: mc ? {
        profitableProbability: mc.profitableProbability,
        probabilityBothLegsFill: mc.probabilityBothLegsFill,
        p10NetProfitUsd: mc.p10NetProfitUsd,
        expectedShortfall95Usd: mc.expectedShortfall95Usd,
        samples: mc.samples,
        authority: mc.authority,
      } : null,
      canonicalRevalidationRequested: plan.canonicalRevalidationRequested,
      canonicalDeterministicPositive: canonicalCycle?.deterministicPositive ?? null,
      canonicalEligibleCandidates: canonicalCycle?.eligibleCandidates ?? null,
      residualNotionalProbeFraction: fraction,
      exactFreshRequoteRequired: true,
      syntheticEconomicsAllowed: false,
      executionAuthority: false,
    });
  })().catch(error => {
    logger.warn('[EconomicTransformation] Operational transformation failed closed', {
      component: 'EconomicTransformationWiring',
      opportunityId: candidate.opportunityId,
      symbol,
      error: error instanceof Error ? error.message : String(error),
      executionAuthority: false,
    });
  }).finally(() => {
    actionInFlight.delete(key);
    actionCooldownUntil.set(key, Date.now() + operationalCooldownMs());
  });
  actionInFlight.set(key, task);
}

function queueCexNearMissRecovery(): void {
  const nearMisses = getClosestCexNearMissesBySymbol(12);
  if (nearMisses.length === 0) return;
  const symbols = [...new Set(nearMisses.map(item => item.symbol.trim().toUpperCase()).filter(Boolean))].slice(0, 12);
  const signature = `cex-near-miss:${symbols.join(',')}`;
  if (actionInFlight.has(signature) || (actionCooldownUntil.get(signature) || 0) > Date.now()) return;

  const task = measuredOpportunityGraph.revalidateSymbols(symbols)
    .then(cycle => {
      const ladder = getProfitLadderNotionalAuthority();
      for (const item of nearMisses.slice(0, 6)) {
        const riskGap = Number((item as any).riskAdjustedBpsToBreakEven ?? item.bpsToBreakEven);
        const nonlinearRiskBurdenBps = Number.isFinite(riskGap) ? Math.max(0, riskGap - item.bpsToBreakEven) : 0;
        if (nonlinearRiskBurdenBps < 1 || !(ladder.maxNotionalUsd > 0)) continue;
        queueCexResidualReplan({
          symbol: item.symbol,
          remainingNotionalUsd: ladder.maxNotionalUsd * 0.50,
          sourceParentNotionalUsd: ladder.maxNotionalUsd,
        });
      }
      logger.info('[EconomicTransformation] CEX near-miss portfolio promoted from logging to fresh recovery work', {
        component: 'EconomicTransformationWiring',
        symbols,
        nearMisses: nearMisses.slice(0, 12).map(item => ({
          symbol: item.symbol,
          mode: item.mode,
          buyVenue: item.buyVenue,
          sellVenue: item.sellVenue,
          combinedFeeBps: item.combinedFeeBps,
          grossSpreadBps: item.grossSpreadBps,
          bpsToBreakEven: item.bpsToBreakEven,
          riskAdjustedBpsToBreakEven: Number((item as any).riskAdjustedBpsToBreakEven ?? item.bpsToBreakEven),
          recoveryEfficiency: item.recoveryEfficiency,
        })),
        canonicalDeterministicPositive: cycle.deterministicPositive,
        canonicalEligibleCandidates: cycle.eligibleCandidates,
        canonicalCycleId: cycle.cycleId,
        makerHybridFreshComparisonIncluded: true,
        smallerExactNotionalProbeOnlyWhenNonlinearRiskBurdenExists: true,
        percentageFeeGapNotPretendedAwayByShrinkingSize: true,
        executionAuthority: false,
      });
    })
    .catch(error => {
      logger.warn('[EconomicTransformation] CEX near-miss canonical recovery degraded', {
        component: 'EconomicTransformationWiring',
        symbols,
        error: error instanceof Error ? error.message : String(error),
        executionAuthority: false,
      });
    })
    .finally(() => {
      actionInFlight.delete(signature);
      actionCooldownUntil.set(signature, Date.now() + operationalCooldownMs());
    });
  actionInFlight.set(signature, task);
}

function refresh(): void {
  const now = Date.now();
  const recent = measuredCandidateRegistry.getRecent(1024);
  const ranked = recent
    .filter(candidate => candidate.expiresAt > now)
    .map(candidate => {
      const advice = adviseEconomicTransformations(candidate);
      const decay = estimateOpportunityDecay(candidate, now);
      const decayAdjustedPriority = advice.priorityScore * decay.survivalProbability;
      return { candidate, advice, survivalProbability: decay.survivalProbability, decayAdjustedPriority };
    })
    .filter(item => item.advice.netProfitBps !== null && item.advice.netProfitBps <= 0)
    .filter(item => item.advice.transformationFeasibilityScore >= minFeasibility())
    .sort((left, right) => right.decayAdjustedPriority - left.decayAdjustedPriority
      || Number(right.advice.dominantCostAloneCouldCoverGap) - Number(left.advice.dominantCostAloneCouldCoverGap)
      || right.advice.transformationFeasibilityScore - left.advice.transformationFeasibilityScore
      || (left.advice.bpsToBreakEven ?? Number.POSITIVE_INFINITY) - (right.advice.bpsToBreakEven ?? Number.POSITIVE_INFINITY));

  const bucketCounts = new Map<string, number>();
  const selected: typeof ranked = [];
  const selectedIds = new Set<string>();
  const closestByTopology = new Map<string, typeof ranked[number]>();

  for (const item of ranked) {
    const key = item.advice.topology;
    const current = closestByTopology.get(key);
    if (!current || (item.advice.bpsToBreakEven ?? Number.POSITIVE_INFINITY) < (current.advice.bpsToBreakEven ?? Number.POSITIVE_INFINITY)) {
      closestByTopology.set(key, item);
    }
  }
  for (const item of closestByTopology.values()) {
    selected.push(item);
    selectedIds.add(item.advice.opportunityId);
    const bucket = `${item.advice.topology}:${item.advice.dominantCostDriver}`;
    bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1);
  }

  for (const item of ranked) {
    if (selected.length >= 128) break;
    if (selectedIds.has(item.advice.opportunityId)) continue;
    const bucket = `${item.advice.topology}:${item.advice.dominantCostDriver}`;
    const used = bucketCounts.get(bucket) || 0;
    if (used >= maxPerTopologyDriver()) continue;
    bucketCounts.set(bucket, used + 1);
    selected.push(item);
    selectedIds.add(item.advice.opportunityId);
  }

  selected.sort((left, right) => right.decayAdjustedPriority - left.decayAdjustedPriority);
  latest = selected.map(item => item.advice);
  const cexNearMisses = getClosestCexNearMissesBySymbol(16);
  logger.info('[EconomicTransformation] Near-break-even rescue portfolio refreshed', {
    component: 'EconomicTransformationWiring',
    candidates: latest.length,
    sourceCandidates: ranked.length,
    topologyDriverBuckets: bucketCounts.size,
    topologyFloorCandidates: closestByTopology.size,
    maxPerTopologyDriver: maxPerTopologyDriver(),
    minFeasibility: minFeasibility(),
    top: selected.slice(0, 8).map(item => ({
      opportunityId: item.advice.opportunityId,
      topology: item.advice.topology,
      netProfitBps: item.advice.netProfitBps,
      bpsToBreakEven: item.advice.bpsToBreakEven,
      dominantCostDriver: item.advice.dominantCostDriver,
      dominantCostBps: item.advice.dominantCostBps,
      dominantCostCoverageRatio: item.advice.dominantCostCoverageRatio,
      dominantCostAloneCouldCoverGap: item.advice.dominantCostAloneCouldCoverGap,
      evidenceCompletenessScore: item.advice.evidenceCompletenessScore,
      freshnessScore: item.advice.freshnessScore,
      transformationFeasibilityScore: item.advice.transformationFeasibilityScore,
      survivalProbability: item.survivalProbability,
      decayAdjustedPriority: item.decayAdjustedPriority,
      transformations: item.advice.transformations,
    })),
    cexModeRescueAttention: cexNearMisses.map(item => ({
      symbol: item.symbol,
      mode: item.mode,
      buyVenue: item.buyVenue,
      sellVenue: item.sellVenue,
      combinedFeeBps: item.combinedFeeBps,
      grossSpreadBps: item.grossSpreadBps,
      bpsToBreakEven: item.bpsToBreakEven,
      recoveryEfficiency: item.recoveryEfficiency,
    })),
    cexRescueObjective: 'smallest_exact_bps_gap_per_symbol_then_fresh_transform_revalidation',
    portfolioDiversityAuthority: 'search_scheduling_only',
    cexRescueAuthority: 'canonical_revalidation_and_residual_replan_only',
    decayAuthority: 'scheduling_only',
    exactRequoteRequired: true,
    executionAuthority: false,
  });

  for (const item of selected.slice(0, 16)) queueOperationalTransformation(item.candidate, item.advice);
  queueCexNearMissRecovery();
}

export function getEconomicTransformationSnapshot(): EconomicTransformationAdvice[] {
  return latest.map(item => ({ ...item, transformations: [...item.transformations], provenance: [...item.provenance] }));
}

export function ensureEconomicTransformationWiring(): void {
  if (timer || process.env.CRYPTOCRAWL_ECONOMIC_TRANSFORMATION_ENABLED === 'false') return;
  installObservedCandidateRevalidationHook();
  refresh();
  if (process.env.NO_INTERVALS !== 'true') {
    const intervalMs = Math.max(5_000, Math.min(120_000, Number(process.env.CRYPTOCRAWL_ECONOMIC_TRANSFORMATION_INTERVAL_MS || 15_000)));
    timer = setInterval(refresh, intervalMs);
    timer.unref?.();
  }
}
