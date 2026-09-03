import type { MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import type { EconomicTransformationAdvice } from './economic-transformation-engine.js';
import {
  getRawCrossVenueEdge,
  type ResearchBpsExecutionPlan,
  type ResearchBpsMonteCarloResult,
} from './research-bps-execution-tactics.js';

export interface BpsSuperEngineMeshInput {
  cex?: {
    closestRiskAdjustedGapBps?: number | null;
    bestPositiveBps?: number | null;
    attentionShare?: number | null;
  } | null;
  resourceScarcity?: {
    combinedPressure?: number | null;
  } | null;
}

export interface BpsVenueConsensusWeight {
  venue: string;
  score: number;
  recencyScore: number;
  latencyScore: number;
  executableEvidence: number;
  observations: number;
}

export interface BpsAttributionRow {
  opportunityId: string;
  symbol: string | null;
  observedAt: number;
  grossBps: number | null;
  exchangeFeeBps: number | null;
  slippageBps: number | null;
  impactBps: number | null;
  gasBps: number | null;
  bridgeBps: number | null;
  latencyDecayBps: number | null;
  adverseSelectionBps: number | null;
  queueLossBps: number | null;
  netBps: number | null;
  realizedNetBps: number | null;
}

export interface BpsSynergyBundle {
  key: string;
  activeTactics: number[];
  purpose: string;
  enabled: boolean;
}

export interface BpsReductionSuperPlan {
  opportunityId: string;
  symbol: string | null;
  anomalyPolicy: {
    attempts: number;
    delaysMs: number[];
    minimumConsensusVenues: number;
  };
  venueConsensusWeights: BpsVenueConsensusWeight[];
  learnedEdgeHalfLifeMs: number;
  expectedDecayBps: number | null;
  advisoryMaxConcessionBps: number | null;
  availableExecutionModes: Array<'TT' | 'MT' | 'TM' | 'MM'>;
  residualNotionalFractions: number[];
  cvarBudgetBps: number | null;
  deficiencyClass: 'fees' | 'impact' | 'latency' | 'settlement' | 'queue' | 'unknown';
  eventTriggers: string[];
  counterfactuals: string[];
  synergyBundles: BpsSynergyBundle[];
  governorMultiplier: number;
  effectivePriorityScore: number;
  monteCarloSearchMultiplier: number;
  measuredAttribution: BpsAttributionRow;
  hardwareAccelerationPolicy: 'quanti_comp_backend_eligible_only';
  authority: 'adaptive_bps_measurement_revalidation_and_scheduling_only';
  executionAuthority: false;
  syntheticEconomicsAllowed: false;
}

interface TacticOutcomeState {
  attempts: number;
  validationHits: number;
  realizedSamples: number;
  meanAbsPredictionErrorBps: number;
  allocationMultiplier: number;
}

interface EdgeLifeState {
  firstSeenAt: number;
  lastSeenAt: number;
  emaLifetimeMs: number;
  completedSamples: number;
  active: boolean;
}

interface OpportunityPlanState {
  predictedNetBps: number | null;
  tacticKeys: string[];
}

const tacticOutcome = new Map<string, TacticOutcomeState>();
const edgeLife = new Map<string, EdgeLifeState>();
const opportunityPlans = new Map<string, OpportunityPlanState>();
const attributionLedger = new Map<string, BpsAttributionRow>();
const MAX_LEDGER_ROWS = 4096;

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function symbolOf(candidate: MeasuredCandidate): string | null {
  return candidate.assets.find(Boolean)?.trim().toUpperCase()
    || candidate.rawQuotes.find(row => row.symbol)?.symbol?.trim().toUpperCase()
    || null;
}

function notionalUsd(candidate: MeasuredCandidate): number | null {
  const direct = finite(candidate.economics.notionalUsd);
  if (direct !== null && direct > 0) return direct;
  const grossBps = finite(candidate.economics.grossProfitBps);
  const grossUsd = finite(candidate.economics.grossProfitUsd);
  if (grossBps !== null && grossUsd !== null && grossBps !== 0) {
    const inferred = grossUsd / grossBps * 10_000;
    return Number.isFinite(inferred) && inferred > 0 ? inferred : null;
  }
  return null;
}

function usdToBps(valueUsd: unknown, notional: number | null): number | null {
  const value = finite(valueUsd);
  return value !== null && notional !== null && notional > 0 ? Math.max(0, value) / notional * 10_000 : null;
}

function buildAttribution(candidate: MeasuredCandidate): BpsAttributionRow {
  const notional = notionalUsd(candidate);
  return {
    opportunityId: candidate.opportunityId,
    symbol: symbolOf(candidate),
    observedAt: candidate.observedAt,
    grossBps: finite(candidate.economics.grossProfitBps),
    exchangeFeeBps: usdToBps(candidate.economics.feeUsd, notional),
    slippageBps: finite(candidate.economics.expectedSlippageBps),
    impactBps: finite(candidate.economics.expectedPriceImpactBps),
    gasBps: finite(candidate.economics.gasCostBps) ?? usdToBps(candidate.economics.gasUsd, notional),
    bridgeBps: usdToBps(candidate.economics.bridgeUsd, notional),
    latencyDecayBps: null,
    adverseSelectionBps: null,
    queueLossBps: null,
    netBps: finite(candidate.economics.netProfitBps),
    realizedNetBps: finite(candidate.economics.realizedNetProfitBps),
  };
}

function pruneLedger(): void {
  if (attributionLedger.size <= MAX_LEDGER_ROWS) return;
  const rows = [...attributionLedger.entries()].sort((left, right) => left[1].observedAt - right[1].observedAt);
  for (const [key] of rows.slice(0, Math.max(1, rows.length - MAX_LEDGER_ROWS))) attributionLedger.delete(key);
}

function updateEdgeLifetime(candidate: MeasuredCandidate): void {
  const symbol = symbolOf(candidate);
  if (!symbol) return;
  const now = Date.now();
  const rawEdge = getRawCrossVenueEdge(candidate);
  const current = edgeLife.get(symbol);
  if (rawEdge) {
    if (!current || !current.active) {
      edgeLife.set(symbol, {
        firstSeenAt: now,
        lastSeenAt: now,
        emaLifetimeMs: current?.emaLifetimeMs ?? 0,
        completedSamples: current?.completedSamples ?? 0,
        active: true,
      });
    } else {
      current.lastSeenAt = now;
      current.active = true;
      edgeLife.set(symbol, current);
    }
    return;
  }
  if (!current?.active) return;
  const lifetime = Math.max(1, current.lastSeenAt - current.firstSeenAt);
  const alpha = current.completedSamples === 0 ? 1 : 0.25;
  current.emaLifetimeMs = current.emaLifetimeMs <= 0
    ? lifetime
    : current.emaLifetimeMs * (1 - alpha) + lifetime * alpha;
  current.completedSamples += 1;
  current.active = false;
  edgeLife.set(symbol, current);
}

function learnedHalfLifeMs(candidate: MeasuredCandidate): number {
  const symbol = symbolOf(candidate);
  const learned = symbol ? edgeLife.get(symbol) : null;
  if (learned && learned.completedSamples > 0 && learned.emaLifetimeMs > 0) {
    return Math.round(clamp(learned.emaLifetimeMs / 2, 50, 5_000));
  }
  const edge = getRawCrossVenueEdge(candidate)?.grossEdgeBps ?? 0;
  const ttl = Math.max(50, candidate.expiresAt - Date.now());
  const bootstrap = edge >= 100 ? 150 : edge >= 50 ? 300 : edge > 0 ? 600 : 1_000;
  return Math.round(clamp(Math.min(bootstrap, ttl), 50, 5_000));
}

function practicalAnomalyPolicy(candidate: MeasuredCandidate, research: ResearchBpsExecutionPlan) {
  const edge = getRawCrossVenueEdge(candidate)?.grossEdgeBps ?? 0;
  if (edge > 100) return { attempts: 3, delaysMs: [0, 50, 100], minimumConsensusVenues: 3 };
  if (edge >= 50) return { attempts: 2, delaysMs: [50, 200], minimumConsensusVenues: 2 };
  if (edge > 0) return { attempts: 1, delaysMs: [100], minimumConsensusVenues: 2 };
  return {
    attempts: Math.max(0, research.anomalyRevalidationAttempts),
    delaysMs: [...research.anomalyRetryDelaysMs],
    minimumConsensusVenues: 2,
  };
}

function venueWeights(candidate: MeasuredCandidate): BpsVenueConsensusWeight[] {
  const now = Date.now();
  const grouped = new Map<string, typeof candidate.rawQuotes>();
  for (const quote of candidate.rawQuotes) {
    const venue = quote.venue?.trim();
    if (!venue) continue;
    const rows = grouped.get(venue) || [];
    rows.push(quote);
    grouped.set(venue, rows);
  }
  const result: BpsVenueConsensusWeight[] = [];
  for (const [venue, rows] of grouped.entries()) {
    const ages = rows.map(row => Math.max(0, now - row.observedAt));
    const medianAge = [...ages].sort((a, b) => a - b)[Math.floor(ages.length / 2)] || 0;
    const latencyScore = clamp(1 - medianAge / 500, 0, 1);
    const recencyScore = clamp(1 - medianAge / 2_000, 0, 1);
    const executableEvidence = rows.some(row => row.executable === true) ? 1 : 0.5;
    const score = 0.35 * latencyScore + 0.35 * recencyScore + 0.20 * executableEvidence + 0.10 * Math.min(1, rows.length / 3);
    result.push({
      venue,
      score: Number(score.toFixed(6)),
      recencyScore: Number(recencyScore.toFixed(6)),
      latencyScore: Number(latencyScore.toFixed(6)),
      executableEvidence,
      observations: rows.length,
    });
  }
  return result.sort((left, right) => right.score - left.score || left.venue.localeCompare(right.venue));
}

function deficiencyClass(candidate: MeasuredCandidate, advice: EconomicTransformationAdvice | null): BpsReductionSuperPlan['deficiencyClass'] {
  const driver = advice?.dominantCostDriver;
  if (driver === 'exchange_fees') return 'fees';
  if (driver === 'slippage_impact') return 'impact';
  if (driver === 'latency_decay') return 'latency';
  if (driver === 'bridge' || driver === 'gas' || driver === 'relay' || driver === 'flash_premium') return 'settlement';
  if (candidate.topology === 'MAKER_CEX') return 'queue';
  return 'unknown';
}

function synergyBundles(activeIds: readonly number[]): BpsSynergyBundle[] {
  const active = new Set(activeIds);
  const defs = [
    { key: 'maker_latency_control', ids: [3, 5, 7, 23, 24], purpose: 'Preserve maker economics while minimizing edge decay.' },
    { key: 'size_route_settlement', ids: [9, 18, 25], purpose: 'Jointly reduce nonlinear impact and settlement friction.' },
    { key: 'robust_cost_guard', ids: [10, 11, 12], purpose: 'Calibrate uncertainty and tail cost without synthetic profitability.' },
    { key: 'near_miss_learning', ids: [13, 14, 19, 20, 21], purpose: 'Concentrate compute on fixable near-miss deficiencies.' },
    { key: 'inventory_netting', ids: [16, 17, 25], purpose: 'Reduce avoidable transfer and capital-location friction.' },
  ] as const;
  return defs.map(def => ({
    key: def.key,
    activeTactics: def.ids.filter(id => active.has(id)),
    purpose: def.purpose,
    enabled: def.ids.every(id => active.has(id)),
  }));
}

function tacticState(key: string): TacticOutcomeState {
  const existing = tacticOutcome.get(key);
  if (existing) return existing;
  const created: TacticOutcomeState = {
    attempts: 0,
    validationHits: 0,
    realizedSamples: 0,
    meanAbsPredictionErrorBps: 0,
    allocationMultiplier: 1,
  };
  tacticOutcome.set(key, created);
  return created;
}

function allocationMultiplier(keys: readonly string[]): number {
  if (keys.length === 0) return 1;
  const multipliers = keys.map(key => tacticState(key).allocationMultiplier);
  return clamp(multipliers.reduce((sum, value) => sum + value, 0) / multipliers.length, 0.75, 1.25);
}

function updateRealizedGovernor(candidate: MeasuredCandidate): void {
  const realized = finite(candidate.economics.realizedNetProfitBps);
  if (realized === null) return;
  const plan = opportunityPlans.get(candidate.opportunityId);
  if (!plan) return;
  if (plan.predictedNetBps === null) return;
  const error = Math.abs(realized - plan.predictedNetBps);
  const denominator = Math.max(1, Math.abs(plan.predictedNetBps));
  const accuracy = clamp(1 - error / denominator, 0, 1);
  for (const key of plan.tacticKeys) {
    const state = tacticState(key);
    const n = state.realizedSamples;
    state.meanAbsPredictionErrorBps = n === 0 ? error : (state.meanAbsPredictionErrorBps * n + error) / (n + 1);
    state.realizedSamples += 1;
    if (accuracy >= 0.90) state.allocationMultiplier = clamp(state.allocationMultiplier * 1.05, 0.75, 1.25);
    else if (accuracy < 0.70) state.allocationMultiplier = clamp(state.allocationMultiplier * 0.90, 0.75, 1.25);
    tacticOutcome.set(key, state);
  }
}

export function recordBpsCandidateAttribution(candidate: MeasuredCandidate): void {
  attributionLedger.set(candidate.opportunityId, buildAttribution(candidate));
  pruneLedger();
  updateEdgeLifetime(candidate);
  updateRealizedGovernor(candidate);
}

export function recordBpsRevalidationOutcome(
  plan: BpsReductionSuperPlan,
  outcome: { deterministicPositive: number; eligibleCandidates: number },
): void {
  const hit = outcome.deterministicPositive > 0 || outcome.eligibleCandidates > 0;
  for (const key of opportunityPlans.get(plan.opportunityId)?.tacticKeys || []) {
    const state = tacticState(key);
    state.attempts += 1;
    if (hit) state.validationHits += 1;
    if (state.attempts >= 5 && state.realizedSamples === 0) {
      const hitRate = state.validationHits / state.attempts;
      state.allocationMultiplier = hitRate >= 0.20
        ? clamp(state.allocationMultiplier * 1.02, 0.75, 1.25)
        : clamp(state.allocationMultiplier * 0.98, 0.75, 1.25);
    }
    tacticOutcome.set(key, state);
  }
}

export function buildBpsReductionSuperPlan(
  candidate: MeasuredCandidate,
  advice: EconomicTransformationAdvice | null,
  research: ResearchBpsExecutionPlan,
  monteCarlo: ResearchBpsMonteCarloResult | null,
  mesh: BpsSuperEngineMeshInput | null,
): BpsReductionSuperPlan {
  const symbol = symbolOf(candidate);
  const halfLifeMs = learnedHalfLifeMs(candidate);
  const edge = getRawCrossVenueEdge(candidate)?.grossEdgeBps ?? null;
  const quoteAge = Math.max(0, finite(candidate.quoteAgeMs) ?? 0);
  const expectedDecayBps = edge !== null
    ? Number(clamp(edge * quoteAge / Math.max(50, halfLifeMs), 0, edge).toFixed(8))
    : null;
  const advisoryMaxConcessionBps = edge !== null && expectedDecayBps !== null
    ? Number(Math.max(0, Math.min(edge / 3, 5, expectedDecayBps / 2)).toFixed(8))
    : null;
  const maxBudget = clamp(Number(process.env.CRYPTOCRAWL_BPS_SUPER_CVAR_MAX_BPS || 50), 1, 100);
  const cvarBudgetBps = edge !== null ? Number(Math.min(edge * 0.5, maxBudget).toFixed(8)) : null;
  const anomalyPolicy = practicalAnomalyPolicy(candidate, research);
  const weights = venueWeights(candidate);
  const bundles = synergyBundles(research.activeTacticIds);
  const governorMultiplier = allocationMultiplier(research.activeTacticKeys);
  const scarcity = clamp(finite(mesh?.resourceScarcity?.combinedPressure) ?? 0, 0, 1);
  const mcConfidence = monteCarlo ? clamp(monteCarlo.profitableProbability, 0, 1) : 0.5;
  const synergyBoost = 1 + bundles.filter(bundle => bundle.enabled).length * 0.05;
  const scarcityPenalty = 1 / (1 + scarcity * 0.5);
  const effectivePriorityScore = research.priorityScore * governorMultiplier * synergyBoost * scarcityPenalty * (0.85 + mcConfidence * 0.30);
  const monteCarloSearchMultiplier = clamp(research.monteCarloSearchMultiplier * governorMultiplier * synergyBoost, 0.75, 2.0);
  const nonlinearDriver = advice?.dominantCostDriver === 'slippage_impact'
    || advice?.dominantCostDriver === 'latency_decay'
    || advice?.dominantCostDriver === 'gas'
    || advice?.dominantCostDriver === 'relay'
    || advice?.dominantCostDriver === 'bridge'
    || advice?.dominantCostDriver === 'flash_premium';
  const residualNotionalFractions = nonlinearDriver
    ? [...new Set([...research.residualNotionalFractions, 0.25, 0.50])].sort((a, b) => b - a)
    : [...research.residualNotionalFractions];
  const eventTriggers: string[] = [];
  if (quoteAge > halfLifeMs / 2) eventTriggers.push('quote_age_exceeds_half_of_learned_edge_half_life');
  if (edge !== null && edge > 100) eventTriggers.push('large_raw_cross_venue_anomaly');
  if ((advice?.bpsToBreakEven ?? Number.POSITIVE_INFINITY) <= 25) eventTriggers.push('near_break_even_candidate');
  if ((mesh?.cex?.closestRiskAdjustedGapBps ?? Number.POSITIVE_INFINITY) <= 10) eventTriggers.push('portfolio_cex_gap_within_10bps');
  if (weights.filter(row => row.score >= 0.30).length >= 2) eventTriggers.push('multi_venue_consensus_available');

  const result: BpsReductionSuperPlan = {
    opportunityId: candidate.opportunityId,
    symbol,
    anomalyPolicy,
    venueConsensusWeights: weights,
    learnedEdgeHalfLifeMs: halfLifeMs,
    expectedDecayBps,
    advisoryMaxConcessionBps,
    availableExecutionModes: candidate.topology === 'CEX_CEX' || candidate.topology === 'MAKER_CEX' ? ['TT', 'MT', 'TM', 'MM'] : [],
    residualNotionalFractions,
    cvarBudgetBps,
    deficiencyClass: deficiencyClass(candidate, advice),
    eventTriggers,
    counterfactuals: [
      'second_best_venue',
      'twenty_five_percent_less_notional',
      'maker_vs_taker_mode',
      'lower_latency_revalidation',
      'prepositioned_inventory',
    ],
    synergyBundles: bundles,
    governorMultiplier: Number(governorMultiplier.toFixed(8)),
    effectivePriorityScore: Number(effectivePriorityScore.toFixed(8)),
    monteCarloSearchMultiplier: Number(monteCarloSearchMultiplier.toFixed(8)),
    measuredAttribution: buildAttribution(candidate),
    hardwareAccelerationPolicy: 'quanti_comp_backend_eligible_only',
    authority: 'adaptive_bps_measurement_revalidation_and_scheduling_only',
    executionAuthority: false,
    syntheticEconomicsAllowed: false,
  };

  opportunityPlans.set(candidate.opportunityId, {
    predictedNetBps: finite(candidate.economics.netProfitBps),
    tacticKeys: [...research.activeTacticKeys],
  });
  return result;
}

export function getBpsReductionSuperEngineSnapshot() {
  const ledger = [...attributionLedger.values()];
  const realized = ledger.filter(row => row.realizedNetBps !== null);
  const tacticStates = [...tacticOutcome.entries()]
    .map(([key, state]) => ({ key, ...state, validationHitRate: state.attempts > 0 ? state.validationHits / state.attempts : null }))
    .sort((left, right) => right.allocationMultiplier - left.allocationMultiplier || right.validationHits - left.validationHits);
  return {
    ledgerRows: ledger.length,
    realizedRows: realized.length,
    tacticStates,
    edgeHalfLife: [...edgeLife.entries()].map(([symbol, state]) => ({ symbol, ...state })),
    authority: 'measurement_learning_and_scheduling_only' as const,
    executionAuthority: false as const,
    syntheticEconomicsAllowed: false as const,
  };
}
