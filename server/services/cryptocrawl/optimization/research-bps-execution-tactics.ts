import { quantiComp, type QuantiWorkload } from '../../quantiComp/index.js';
import type { MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import { runProfitabilityMonteCarlo } from '../execution/adapters/monte-carlo-profitability.js';
import type { EconomicTransformationAdvice } from './economic-transformation-engine.js';

export type ResearchBpsActionClass =
  | 'evidence_reacquire'
  | 'canonical_revalidate'
  | 'residual_notional_probe'
  | 'latency_preservation'
  | 'queue_execution'
  | 'robust_cost_control'
  | 'inventory_route_control'
  | 'compute_search';

export interface ResearchBpsTacticDefinition {
  id: number;
  key: string;
  name: string;
  researchBasis: string;
  actionClass: ResearchBpsActionClass;
  benefit: string;
}

/**
 * Twenty-five execution-cost reduction mechanisms added above the existing
 * broad Hyperdynamic BPS levers. These are tactic-search primitives, not profit
 * authority. Every actionable output is re-measured by the canonical verifier,
 * Cryptara/Monte Carlo, governance and settlement before it can execute.
 */
export const RESEARCH_BPS_EXECUTION_TACTICS: readonly ResearchBpsTacticDefinition[] = [
  { id: 1, key: 'sequential_probability_recheck', name: 'Sequential probability recheck', researchBasis: 'sequential evidence testing / anomaly confirmation', actionClass: 'evidence_reacquire', benefit: 'Rechecks a large apparent edge instead of discarding one incomplete observation.' },
  { id: 2, key: 'cross_venue_consensus_reacquire', name: 'Cross-venue consensus reacquisition', researchBasis: 'robust sensor fusion / market-data consensus', actionClass: 'evidence_reacquire', benefit: 'Separates a real dislocation from one-venue quote corruption by reacquiring independent books.' },
  { id: 3, key: 'quote_survival_hazard_budget', name: 'Quote survival hazard budget', researchBasis: 'survival analysis / stochastic execution delay', actionClass: 'latency_preservation', benefit: 'Spends revalidation effort before a measured edge is likely to decay.' },
  { id: 4, key: 'marketable_limit_delay_cap', name: 'Stochastic-delay marketable-limit cap', researchBasis: 'Cartea and Sanchez-Betancourt stochastic-delay execution', actionClass: 'latency_preservation', benefit: 'Prefers price-capped immediate execution surfaces when delay makes uncapped taking expensive.' },
  { id: 5, key: 'queue_option_value_preservation', name: 'Queue option-value preservation', researchBasis: 'Moallemi and Yuan queue-position valuation', actionClass: 'queue_execution', benefit: 'Treats maker queue position as an economic asset instead of repeatedly resetting it.' },
  { id: 6, key: 'hawkes_fill_intensity_priority', name: 'Self-exciting fill-intensity priority', researchBasis: 'Hawkes-process limit-order-book models', actionClass: 'queue_execution', benefit: 'Raises maker attention when measured order-arrival intensity implies faster queue depletion.' },
  { id: 7, key: 'order_flow_horizon_switch', name: 'Order-flow horizon switch', researchBasis: 'dynamic order-flow-imbalance optimal execution', actionClass: 'queue_execution', benefit: 'Changes passive/aggressive search urgency when current flow makes waiting costly.' },
  { id: 8, key: 'hidden_liquidity_regime_filter', name: 'Hidden-liquidity regime filter', researchBasis: 'hidden Markov liquidity-state execution', actionClass: 'robust_cost_control', benefit: 'Avoids carrying calm-market execution assumptions into an abruptly illiquid regime.' },
  { id: 9, key: 'replenishment_resilience_probe', name: 'Liquidity replenishment resilience probe', researchBasis: 'stochastic liquidity and order-book resilience', actionClass: 'residual_notional_probe', benefit: 'Tests smaller exact sizes where replenishment can materially reduce impact BPS.' },
  { id: 10, key: 'distributionally_robust_cost_envelope', name: 'Distributionally robust cost envelope', researchBasis: 'distributionally robust optimization', actionClass: 'robust_cost_control', benefit: 'Ranks tactics against plausible cost-distribution misspecification instead of a single fitted model.' },
  { id: 11, key: 'conformal_execution_cost_bound', name: 'Conformal execution-cost bound', researchBasis: 'distribution-free predictive intervals', actionClass: 'robust_cost_control', benefit: 'Uses calibration error to widen cost uncertainty without manufacturing a deterministic surcharge.' },
  { id: 12, key: 'cvar_tail_cost_rank', name: 'CVaR tail-cost tactic rank', researchBasis: 'tail-risk constrained stochastic optimization', actionClass: 'robust_cost_control', benefit: 'Penalizes tactics whose average economics look acceptable but whose execution-cost tail is poor.' },
  { id: 13, key: 'cross_entropy_rare_positive_search', name: 'Cross-entropy rare-positive search', researchBasis: 'cross-entropy rare-event optimization', actionClass: 'compute_search', benefit: 'Concentrates bounded search on tactic parameters that repeatedly approach positive execution.' },
  { id: 14, key: 'knowledge_gradient_tactic_sampling', name: 'Knowledge-gradient tactic sampling', researchBasis: 'Bayesian value-of-information optimization', actionClass: 'compute_search', benefit: 'Chooses the next expensive recheck by expected information gain per unit of scarce compute/API capacity.' },
  { id: 15, key: 'receding_horizon_execution_replan', name: 'Receding-horizon execution replan', researchBasis: 'model predictive control / multi-period convex trading', actionClass: 'canonical_revalidate', benefit: 'Re-solves from fresh state rather than committing to stale tactic parameters for the whole opportunity life.' },
  { id: 16, key: 'min_cost_inventory_flow', name: 'Minimum-cost inventory flow', researchBasis: 'network min-cost flow', actionClass: 'inventory_route_control', benefit: 'Prefers existing venue inventory paths that remove transfer and settlement friction from all-in BPS.' },
  { id: 17, key: 'distributed_opportunity_netting', name: 'Distributed opportunity netting', researchBasis: 'distributed convex transaction-cost mitigation / ADMM', actionClass: 'inventory_route_control', benefit: 'Nets compatible simultaneous capital demands before paying avoidable cross-venue movement costs.' },
  { id: 18, key: 'convex_multi_venue_split', name: 'Convex multi-venue split', researchBasis: 'optimal routing / convex market routing', actionClass: 'residual_notional_probe', benefit: 'Searches smaller exact slices when one large route would walk expensive depth.' },
  { id: 19, key: 'diverse_tactic_portfolio', name: 'Diverse tactic portfolio', researchBasis: 'DARPA DISCORD diverse-strategy portfolio principle', actionClass: 'compute_search', benefit: 'Avoids spending all recovery effort on one correlated execution tactic.' },
  { id: 20, key: 'execution_digital_twin_replay', name: 'Execution digital-twin replay', researchBasis: 'high-fidelity simulation and digital-twin control', actionClass: 'compute_search', benefit: 'Uses measured execution residuals to replay candidate tactics before spending another live quote cycle.' },
  { id: 21, key: 'squeaky_wheel_near_miss_reprioritization', name: 'Squeaky-wheel near-miss reprioritization', researchBasis: 'NASA/JPL simulation-driven squeaky-wheel scheduling', actionClass: 'compute_search', benefit: 'Feeds repeated near misses back into priority assignment instead of static symbol ordering.' },
  { id: 22, key: 'liquidity_change_point_reset', name: 'Liquidity change-point reset', researchBasis: 'online change-point detection', actionClass: 'evidence_reacquire', benefit: 'Forces fresh evidence after a structural liquidity shift instead of trusting pre-shift measurements.' },
  { id: 23, key: 'passive_aggressive_optimal_stopping', name: 'Passive/aggressive optimal-stopping boundary', researchBasis: 'optimal stopping / stochastic control', actionClass: 'queue_execution', benefit: 'Treats maker waiting versus immediate hedging as a state-dependent boundary rather than a fixed timeout.' },
  { id: 24, key: 'sense_compute_act_deadline_collapse', name: 'Sense-compute-act deadline collapse', researchBasis: 'DARPA real-time adaptive control / edge intelligence', actionClass: 'latency_preservation', benefit: 'Pushes time-critical evidence work into the hot path so stale-edge loss is reduced before order admission.' },
  { id: 25, key: 'settlement_location_friction_optimizer', name: 'Settlement-location friction optimizer', researchBasis: 'fragmentation and transaction-cost netting literature', actionClass: 'inventory_route_control', benefit: 'Values route location and settlement state as execution costs so equivalent prices do not hide movement BPS.' },
] as const;

if (RESEARCH_BPS_EXECUTION_TACTICS.length !== 25) {
  throw new Error(`Research BPS tactic catalog must contain exactly 25 tactics; found ${RESEARCH_BPS_EXECUTION_TACTICS.length}`);
}

export interface RawCrossVenueEdge {
  grossEdgeBps: number;
  buyVenue: string;
  sellVenue: string;
  buyAsk: number;
  sellBid: number;
}

export interface ResearchBpsExecutionPlan {
  opportunityId: string;
  activeTacticIds: number[];
  activeTacticKeys: string[];
  canonicalRevalidationRequested: boolean;
  anomalyRevalidationAttempts: number;
  anomalyRetryDelaysMs: number[];
  residualNotionalFractions: number[];
  priorityScore: number;
  monteCarloSearchMultiplier: number;
  rawEdgeBps: number | null;
  authority: 'measured_tactic_search_and_revalidation_only';
  executionAuthority: false;
  syntheticEconomicsAllowed: false;
}

export interface ResearchBpsMonteCarloResult {
  profitableProbability: number;
  probabilityBothLegsFill: number;
  p10NetProfitUsd: number;
  expectedShortfall95Usd: number;
  samples: number;
  stoppedEarly: boolean;
  authority: 'quanti_comp_monte_carlo_scheduling_only';
  executionAuthority: false;
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rawAsk(candidate: MeasuredCandidate) {
  return candidate.rawQuotes
    .filter(row => row.venue && finite(row.ask) !== null && Number(row.ask) > 0)
    .map(row => ({ venue: String(row.venue), ask: Number(row.ask) }));
}

function rawBid(candidate: MeasuredCandidate) {
  return candidate.rawQuotes
    .filter(row => row.venue && finite(row.bid) !== null && Number(row.bid) > 0)
    .map(row => ({ venue: String(row.venue), bid: Number(row.bid) }));
}

export function getRawCrossVenueEdge(candidate: MeasuredCandidate): RawCrossVenueEdge | null {
  let best: RawCrossVenueEdge | null = null;
  for (const buy of rawAsk(candidate)) {
    for (const sell of rawBid(candidate)) {
      if (buy.venue === sell.venue || !(sell.bid > buy.ask)) continue;
      const grossEdgeBps = (sell.bid - buy.ask) / buy.ask * 10_000;
      if (!Number.isFinite(grossEdgeBps) || grossEdgeBps <= 0) continue;
      if (!best || grossEdgeBps > best.grossEdgeBps) best = {
        grossEdgeBps,
        buyVenue: buy.venue,
        sellVenue: sell.venue,
        buyAsk: buy.ask,
        sellBid: sell.bid,
      };
    }
  }
  return best;
}

function activeTactics(candidate: MeasuredCandidate, advice: EconomicTransformationAdvice | null): ResearchBpsTacticDefinition[] {
  const edge = getRawCrossVenueEdge(candidate);
  const quoteAge = Math.max(0, finite(candidate.quoteAgeMs) ?? 0);
  const gap = Math.max(0, finite(advice?.bpsToBreakEven) ?? Math.abs(finite(candidate.economics.netProfitBps) ?? 0));
  const missing = candidate.missingInformation.length;
  const driver = advice?.dominantCostDriver ?? 'unknown';
  const slippage = Math.max(0, finite(candidate.economics.expectedSlippageBps) ?? 0);
  const impact = Math.max(0, finite(candidate.economics.expectedPriceImpactBps) ?? 0);
  const cex = candidate.topology === 'CEX_CEX' || candidate.topology === 'MAKER_CEX';
  const rawQuotes = candidate.rawQuotes.length;

  const enabled = new Set<number>();
  if (edge) { enabled.add(1); enabled.add(2); enabled.add(3); enabled.add(19); enabled.add(21); enabled.add(24); }
  if (quoteAge > 250) { enabled.add(3); enabled.add(4); enabled.add(15); enabled.add(24); }
  if (cex && driver === 'exchange_fees') { enabled.add(5); enabled.add(7); enabled.add(15); enabled.add(16); enabled.add(17); enabled.add(19); enabled.add(23); enabled.add(25); }
  if (cex) { enabled.add(6); enabled.add(7); enabled.add(8); enabled.add(14); enabled.add(15); enabled.add(19); enabled.add(20); enabled.add(21); enabled.add(23); enabled.add(24); }
  if (driver === 'slippage_impact' || slippage + impact > 0) { enabled.add(9); enabled.add(10); enabled.add(11); enabled.add(12); enabled.add(13); enabled.add(18); enabled.add(22); }
  if (driver === 'latency_decay') { enabled.add(3); enabled.add(4); enabled.add(7); enabled.add(15); enabled.add(22); enabled.add(24); }
  if (driver === 'bridge' || driver === 'gas' || driver === 'relay' || driver === 'flash_premium') { enabled.add(10); enabled.add(12); enabled.add(16); enabled.add(17); enabled.add(18); enabled.add(25); }
  if (missing > 0) { enabled.add(1); enabled.add(2); enabled.add(14); enabled.add(20); enabled.add(22); }
  if (rawQuotes >= 3) { enabled.add(2); enabled.add(10); enabled.add(11); }
  if (gap > 0 && gap <= 25) { enabled.add(13); enabled.add(14); enabled.add(15); enabled.add(19); enabled.add(21); }

  return RESEARCH_BPS_EXECUTION_TACTICS.filter(tactic => enabled.has(tactic.id));
}

export function buildResearchBpsExecutionPlan(
  candidate: MeasuredCandidate,
  advice: EconomicTransformationAdvice | null,
): ResearchBpsExecutionPlan {
  const tactics = activeTactics(candidate, advice);
  const edge = getRawCrossVenueEdge(candidate);
  const gap = Math.max(0, finite(advice?.bpsToBreakEven) ?? Math.abs(finite(candidate.economics.netProfitBps) ?? 0));
  const driver = advice?.dominantCostDriver ?? 'unknown';
  const cex = candidate.topology === 'CEX_CEX' || candidate.topology === 'MAKER_CEX';
  const transforms = new Set(advice?.transformations ?? []);
  const canonicalRevalidationRequested = cex && Boolean(
    edge
    || transforms.has('maker_or_hybrid_order_mode')
    || transforms.has('alternate_route_or_pool')
    || transforms.has('fresher_provider_or_prefetch')
    || gap <= 25,
  );

  const attempts = edge
    ? edge.grossEdgeBps >= 500 ? 4 : edge.grossEdgeBps >= 100 ? 3 : edge.grossEdgeBps >= 25 ? 2 : 1
    : canonicalRevalidationRequested ? 1 : 0;
  const anomalyRetryDelaysMs = [0, 250, 900, 2_500].slice(0, attempts);

  // Percentage fees are not improved by blindly shrinking size. Exact smaller-size
  // probes are reserved for non-linear impact, latency and fixed-cost surfaces.
  const residualNotionalFractions = (driver === 'slippage_impact' || driver === 'latency_decay')
    ? [0.80, 0.60, 0.40, 0.25]
    : (driver === 'gas' || driver === 'relay' || driver === 'bridge' || driver === 'flash_premium')
      ? [0.75, 0.50]
      : [];

  const tacticBoost = Math.min(3, tactics.length / 8);
  const proximity = gap > 0 ? 1 / (1 + gap / 25) : edge ? 1.5 : 0.5;
  const priorityScore = clamp((advice?.priorityScore ?? 0.25) * (1 + tacticBoost) * proximity, 0.01, 100);
  const monteCarloSearchMultiplier = clamp(0.85 + Math.min(0.85, tactics.length * 0.035 + proximity * 0.15), 0.75, 1.70);

  return {
    opportunityId: candidate.opportunityId,
    activeTacticIds: tactics.map(tactic => tactic.id),
    activeTacticKeys: tactics.map(tactic => tactic.key),
    canonicalRevalidationRequested,
    anomalyRevalidationAttempts: attempts,
    anomalyRetryDelaysMs,
    residualNotionalFractions,
    priorityScore: Number(priorityScore.toFixed(8)),
    monteCarloSearchMultiplier: Number(monteCarloSearchMultiplier.toFixed(6)),
    rawEdgeBps: edge ? Number(edge.grossEdgeBps.toFixed(8)) : null,
    authority: 'measured_tactic_search_and_revalidation_only',
    executionAuthority: false,
    syntheticEconomicsAllowed: false,
  };
}

function measuredNotional(candidate: MeasuredCandidate): number {
  const direct = finite(candidate.economics.notionalUsd);
  if (direct !== null && direct > 0) return direct;
  const grossBps = finite(candidate.economics.grossProfitBps);
  const grossUsd = finite(candidate.economics.grossProfitUsd);
  if (grossBps !== null && grossUsd !== null && grossBps !== 0) {
    const inferred = grossUsd / grossBps * 10_000;
    if (Number.isFinite(inferred) && inferred > 0) return inferred;
  }
  return 0;
}

function measuredNetUsd(candidate: MeasuredCandidate, notionalUsd: number): number {
  const direct = finite(candidate.economics.deterministicNetProfitUsd);
  if (direct !== null) return direct;
  const bps = finite(candidate.economics.netProfitBps);
  return bps !== null && notionalUsd > 0 ? notionalUsd * bps / 10_000 : 0;
}

function measuredExecutionCostUsd(candidate: MeasuredCandidate): number {
  return [candidate.economics.feeUsd, candidate.economics.gasUsd, candidate.economics.bridgeUsd]
    .map(value => finite(value))
    .filter((value): value is number => value !== null && value > 0)
    .reduce((sum, value) => sum + value, 0);
}

function monteCarloTopologyForCandidate(candidate: MeasuredCandidate):
  | 'CEX_CEX'
  | 'DEX_ATOMIC'
  | 'MEMPOOL_BACKRUN'
  | 'CROSS_CHAIN'
  | 'ZERO_CAPITAL'
  | 'MARKET_MAKING'
  | 'UNKNOWN' {
  switch (candidate.topology) {
    case 'CEX_CEX': return 'CEX_CEX';
    case 'DEX_ATOMIC': return 'DEX_ATOMIC';
    case 'MEMPOOL_BACKRUN': return 'MEMPOOL_BACKRUN';
    case 'CROSS_CHAIN': return 'CROSS_CHAIN';
    case 'ZERO_CAPITAL_ATOMIC': return 'ZERO_CAPITAL';
    case 'MAKER_CEX': return 'MARKET_MAKING';
    // Liquidation, funding and prediction-event residuals have materially
    // different failure modes from atomic DEX swaps. Until each has a dedicated
    // Monte Carlo policy, use the conservative UNKNOWN policy rather than
    // laundering them through DEX_ATOMIC assumptions.
    case 'LIQUIDATION':
    case 'FUNDING_ARBITRAGE':
    case 'PREDICTION_EVENT':
    default:
      return 'UNKNOWN';
  }
}

export async function runResearchBpsQuantiMonteCarlo(
  candidate: MeasuredCandidate,
  plan: ResearchBpsExecutionPlan,
): Promise<ResearchBpsMonteCarloResult | null> {
  const notionalUsd = measuredNotional(candidate);
  if (!(notionalUsd > 0)) return null;
  const expectedNetProfitUsd = measuredNetUsd(candidate, notionalUsd);
  const estimatedExecutionCostUsd = measuredExecutionCostUsd(candidate);
  const expectedSlippageBps = Math.max(0, finite(candidate.economics.expectedSlippageBps) ?? 0);
  const quoteLatencyMs = Math.max(0, finite(candidate.quoteAgeMs) ?? 0);
  const completeness = clamp(1 - candidate.missingInformation.length * 0.08, 0.10, 1);
  const now = Date.now();
  const deadlineAt = candidate.expiresAt > now + 50 ? candidate.expiresAt : now + 1_000;
  const requestedSamples = Math.max(128, Math.min(4096, Math.round(512 * plan.monteCarloSearchMultiplier)));

  const workload: QuantiWorkload<null, ResearchBpsMonteCarloResult> = {
    id: `bps-tactic-mc:${candidate.opportunityId}:${candidate.updatedAt}`,
    kind: 'cryptocrawl.bps_tactic_monte_carlo',
    lane: plan.rawEdgeBps !== null ? 'ultra_hot' : 'hot',
    priority: Math.round(plan.priorityScore * 1_000),
    input: null,
    features: {
      notionalUsd,
      expectedNetProfitUsd,
      estimatedExecutionCostUsd,
      expectedSlippageBps,
      quoteLatencyMs,
      activeTactics: plan.activeTacticIds.length,
    },
    resourceHints: {
      cpuWeight: 1,
      memoryMB: 32,
      ioWeight: 0,
      expectedDurationMs: 250,
      preferredBackend: 'worker_thread',
      parallelismHint: Math.max(1, Math.min(8, Math.ceil(plan.monteCarloSearchMultiplier * 4))),
    },
    policy: {
      timeoutMs: 1_500,
      deadlineAt,
      deterministic: true,
      sideEffectFree: true,
      backendEligible: true,
      allowDeduplication: true,
      dedupeKey: `bps-tactic-mc:${candidate.opportunityId}:${candidate.updatedAt}`,
      usefulWorkUnits: requestedSamples,
      strictValidation: true,
    },
    execute: () => {
      const result = runProfitabilityMonteCarlo({
        seed: `research-bps:${candidate.opportunityId}:${candidate.updatedAt}`,
        notionalUsd,
        expectedNetProfitUsd,
        estimatedExecutionCostUsd,
        expectedSlippageBps,
        quoteLatencyMs,
        confidence: completeness,
        samples: requestedSamples,
        baselineSlippageAlreadyIncluded: true,
        topology: monteCarloTopologyForCandidate(candidate),
        quoteMaxAgeMs: Math.max(250, candidate.expiresAt - candidate.observedAt),
        executionHorizonMs: Math.max(250, candidate.expiresAt - now),
        advisoryOnly: true,
      });
      return {
        profitableProbability: result.profitableProbability,
        probabilityBothLegsFill: result.probabilityBothLegsFill,
        p10NetProfitUsd: result.p10NetProfitUsd,
        expectedShortfall95Usd: result.expectedShortfall95Usd,
        samples: result.samples,
        stoppedEarly: result.stoppedEarly,
        authority: 'quanti_comp_monte_carlo_scheduling_only',
        executionAuthority: false,
      };
    },
    validate: result => Boolean(
      result
      && Number.isFinite(result.profitableProbability)
      && result.profitableProbability >= 0
      && result.profitableProbability <= 1
      && Number.isFinite(result.p10NetProfitUsd)
      && result.executionAuthority === false,
    ),
  };

  const execution = await quantiComp.submit(workload);
  return execution.result;
}
