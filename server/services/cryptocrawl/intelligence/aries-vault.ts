// Aries Vault
//
// A deterministic, fail-closed decision layer that unifies fee/tier economics,
// hybrid maker/taker routing, liquidity capacity, latency decay, event-driven
// attention, topology/graph novelty, probabilistic state evaluation,
// evolutionary beam ranking, marginal capital efficiency, robust routing,
// counterfactual regret and value-of-information accounting.
//
// The physics-inspired names used in the product specification are implemented
// here as measurable economic/statistical quantities. This module does not
// grant execution authority and cannot bypass Cryptara governance, inventory,
// product constraints, settlement truth or post-only requirements.

export type AriesAction = 'execute' | 'hold' | 'abort';

export interface AriesFeeTier {
  name: string;
  minRollingNotionalUsd: number;
  makerFeeBps: number;
  takerFeeBps: number;
}

export interface AriesTierStateInput {
  rollingNotionalUsd: number;
  windowDays: 14 | 30;
  expectedFutureNotionalUsd: number;
  horizonDays: number;
  tiers: AriesFeeTier[];
  intentionalCurrentLossUsd?: number;
  uncertaintyHaircut?: number;
}

export interface AriesTierProjection {
  currentTier: AriesFeeTier | null;
  projectedTier: AriesFeeTier | null;
  distanceToNextTierUsd: number | null;
  projectedFutureFeeSavingsUsd: number;
  expectedValueOfTierTransitionUsd: number;
  mayEconomicallyAccelerateTier: boolean;
}

export interface AriesBookLevel {
  price: number;
  quantity: number;
}

export interface AriesBookWalk {
  filledQuantity: number;
  notionalUsd: number;
  averagePrice: number;
  worstPrice: number;
  impactBps: number;
  complete: boolean;
}

export interface AriesExecutionEconomicsInput {
  grossSpreadBps: number;
  makerFeeBps: number;
  takerFeeBps: number;
  makerFillProbability: number;
  adverseSelectionBps: number;
  makerOpportunityCostBps: number;
  takerImpactBps: number;
  latencyMs: number;
  spreadHalfLifeMs: number;
  urgency: number;
  allowTaker: boolean;
  fixedOtherCostsBps?: number;
}

export interface AriesExecutionEconomics {
  makerExpectedCostBps: number;
  takerExpectedCostBps: number;
  crossoverTakerShare: number;
  blendedExpectedCostBps: number;
  latencySurvivalProbability: number;
  latencyAdjustedGrossBps: number;
  expectedRealizedBps: number;
  economicallyPositive: boolean;
}

export interface AriesMarketSnapshot {
  spreadBps: number;
  bidDepthUsd: number;
  askDepthUsd: number;
  imbalance: number;
  cancelRate: number;
  providerDispersionBps: number;
  mempoolPressure?: number;
  observedAt: number;
}

export interface AriesNoveltyScore {
  topologyProxy: number;
  graphTension: number;
  temporalNovelty: number;
  spike: boolean;
}

export interface AriesState {
  probability: number;
  payoffBps: number;
  tailLossBps?: number;
}

export interface AriesStateLatticeResult {
  expectedBps: number;
  tailRiskBps: number;
  riskAdjustedBps: number;
}

export interface AriesBeamCandidate {
  id: string;
  expectedRealizedBps: number;
  expectedProfitUsd: number;
  futureFeeTierValueUsd?: number;
  futureCapitalValueUsd?: number;
  tailRiskUsd?: number;
  uncertaintyUsd?: number;
  capitalTimeCostUsd?: number;
  computeCostUsd?: number;
}

export interface AriesBeamResult extends AriesBeamCandidate {
  fitnessUsd: number;
}

export interface AriesCapitalLocation {
  venue: string;
  expectedOpportunityYieldBps: number;
  feeDragBps: number;
  rebalanceCostBps: number;
  transferLatencyCostBps: number;
  idleCapitalPenaltyBps: number;
}

export interface AriesCapitalScore extends AriesCapitalLocation {
  marginalCapitalEfficiencyBps: number;
}

export interface AriesRouteScenario {
  routeId: string;
  scenarioNetBps: number[];
}

export interface AriesRobustRoute {
  routeId: string;
  worstCaseBps: number;
  averageBps: number;
  maxRegretBps: number;
  robustScoreBps: number;
}

export interface AriesOpportunityAssessmentInput {
  symbol: string;
  notionalUsd: number;
  execution: AriesExecutionEconomicsInput;
  currentSnapshot?: AriesMarketSnapshot;
  previousSnapshot?: AriesMarketSnapshot;
  states?: AriesState[];
  alternatives?: AriesBeamCandidate[];
  criticalUnknownCostBps?: number | null;
  minSafetyMarginBps?: number;
}

export interface AriesOpportunityAssessment {
  symbol: string;
  action: AriesAction;
  execution: AriesExecutionEconomics;
  novelty: AriesNoveltyScore | null;
  stateLattice: AriesStateLatticeResult | null;
  selectedBeam: AriesBeamResult | null;
  economicExergyBps: number;
  thermodynamicEfficiencyCoefficient: number;
  expectedValueOfInformationBps: number;
  safetyMarginBps: number;
  reason: string;
  executionAuthority: false;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function sortedTiers(tiers: AriesFeeTier[]): AriesFeeTier[] {
  return tiers
    .filter(tier => Number.isFinite(tier.minRollingNotionalUsd) && tier.minRollingNotionalUsd >= 0 &&
      Number.isFinite(tier.makerFeeBps) && Number.isFinite(tier.takerFeeBps))
    .slice()
    .sort((a, b) => a.minRollingNotionalUsd - b.minRollingNotionalUsd);
}

export function projectAriesTierState(input: AriesTierStateInput): AriesTierProjection {
  const tiers = sortedTiers(input.tiers);
  const rolling = Math.max(0, finite(input.rollingNotionalUsd));
  const future = Math.max(0, finite(input.expectedFutureNotionalUsd));
  const loss = Math.max(0, finite(input.intentionalCurrentLossUsd || 0));
  const haircut = clamp(input.uncertaintyHaircut ?? 0.25, 0, 0.95);
  let currentTier: AriesFeeTier | null = null;
  let projectedTier: AriesFeeTier | null = null;
  for (const tier of tiers) {
    if (rolling >= tier.minRollingNotionalUsd) currentTier = tier;
    if (rolling + future >= tier.minRollingNotionalUsd) projectedTier = tier;
  }
  currentTier ||= tiers[0] || null;
  projectedTier ||= currentTier;
  const currentIndex = currentTier ? tiers.indexOf(currentTier) : -1;
  const nextTier = currentIndex >= 0 ? tiers[currentIndex + 1] || null : null;
  const distanceToNextTierUsd = nextTier ? Math.max(0, nextTier.minRollingNotionalUsd - rolling) : null;
  const feeDeltaBps = currentTier && projectedTier
    ? Math.max(0, ((currentTier.makerFeeBps + currentTier.takerFeeBps) - (projectedTier.makerFeeBps + projectedTier.takerFeeBps)) / 2)
    : 0;
  const projectedFutureFeeSavingsUsd = future * feeDeltaBps / 10_000;
  const conservativeSavingsUsd = projectedFutureFeeSavingsUsd * (1 - haircut);
  const expectedValueOfTierTransitionUsd = conservativeSavingsUsd - loss;
  return {
    currentTier,
    projectedTier,
    distanceToNextTierUsd,
    projectedFutureFeeSavingsUsd,
    expectedValueOfTierTransitionUsd,
    // Deliberate loss is never justified by the tier label itself; only a
    // positive conservative future-value calculation may admit it for review.
    mayEconomicallyAccelerateTier: loss > 0 && expectedValueOfTierTransitionUsd > 0 &&
      distanceToNextTierUsd !== null && future >= distanceToNextTierUsd,
  };
}

export function walkAriesBook(levels: AriesBookLevel[], requestedQuantity: number, referencePrice: number): AriesBookWalk {
  let remaining = Math.max(0, finite(requestedQuantity));
  let filledQuantity = 0;
  let notionalUsd = 0;
  let worstPrice = 0;
  for (const level of levels) {
    if (!(remaining > 0)) break;
    if (!(level.price > 0) || !(level.quantity > 0)) continue;
    const quantity = Math.min(remaining, level.quantity);
    filledQuantity += quantity;
    notionalUsd += quantity * level.price;
    remaining -= quantity;
    worstPrice = level.price;
  }
  const averagePrice = filledQuantity > 0 ? notionalUsd / filledQuantity : 0;
  const impactBps = referencePrice > 0 && averagePrice > 0
    ? Math.abs(averagePrice - referencePrice) / referencePrice * 10_000
    : 0;
  return { filledQuantity, notionalUsd, averagePrice, worstPrice, impactBps, complete: remaining <= 1e-12 };
}

export function evaluateAriesExecutionEconomics(input: AriesExecutionEconomicsInput): AriesExecutionEconomics {
  const fillProbability = clamp(input.makerFillProbability, 0, 1);
  const urgency = clamp(input.urgency, 0, 1);
  const halfLifeMs = Math.max(1, finite(input.spreadHalfLifeMs, 1));
  const latencyMs = Math.max(0, finite(input.latencyMs));
  const latencySurvivalProbability = Math.exp(-Math.LN2 * latencyMs / halfLifeMs);
  const latencyAdjustedGrossBps = finite(input.grossSpreadBps) * latencySurvivalProbability;

  const makerExpectedCostBps = finite(input.makerFeeBps)
    + Math.max(0, finite(input.adverseSelectionBps))
    + (1 - fillProbability) * Math.max(0, finite(input.makerOpportunityCostBps));
  const takerExpectedCostBps = finite(input.takerFeeBps) + Math.max(0, finite(input.takerImpactBps));

  let crossoverTakerShare = 0;
  if (input.allowTaker) {
    // A continuous hybrid allocation: when maker and taker costs converge,
    // urgency and non-fill risk shift progressively toward taker liquidity.
    const costGap = takerExpectedCostBps - makerExpectedCostBps;
    const scale = Math.max(1, Math.abs(takerExpectedCostBps) + Math.abs(makerExpectedCostBps));
    const costPreference = clamp(0.5 - costGap / (2 * scale), 0, 1);
    crossoverTakerShare = clamp((costPreference + urgency + (1 - fillProbability)) / 3, 0, 1);
    if (takerExpectedCostBps <= makerExpectedCostBps && urgency >= 0.5) crossoverTakerShare = Math.max(crossoverTakerShare, 0.5);
  }

  const blendedExpectedCostBps = makerExpectedCostBps * (1 - crossoverTakerShare)
    + takerExpectedCostBps * crossoverTakerShare
    + Math.max(0, finite(input.fixedOtherCostsBps || 0));
  const expectedRealizedBps = latencyAdjustedGrossBps - blendedExpectedCostBps;
  return {
    makerExpectedCostBps,
    takerExpectedCostBps,
    crossoverTakerShare,
    blendedExpectedCostBps,
    latencySurvivalProbability,
    latencyAdjustedGrossBps,
    expectedRealizedBps,
    economicallyPositive: expectedRealizedBps > 0,
  };
}

export function computeAriesNovelty(current: AriesMarketSnapshot, previous: AriesMarketSnapshot): AriesNoveltyScore {
  const spreadScale = Math.max(1, Math.abs(previous.spreadBps));
  const depthScale = Math.max(1, previous.bidDepthUsd + previous.askDepthUsd);
  const spreadChange = Math.abs(current.spreadBps - previous.spreadBps) / spreadScale;
  const depthChange = Math.abs((current.bidDepthUsd + current.askDepthUsd) - (previous.bidDepthUsd + previous.askDepthUsd)) / depthScale;
  const imbalanceChange = Math.abs(current.imbalance - previous.imbalance);
  const cancellationChange = Math.abs(current.cancelRate - previous.cancelRate);
  const dispersionChange = Math.abs(current.providerDispersionBps - previous.providerDispersionBps) / Math.max(1, previous.providerDispersionBps);

  // topologyProxy is intentionally named a proxy: genuine persistent homology
  // requires a point-cloud/filtration history rather than two book snapshots.
  const topologyProxy = clamp((spreadChange + depthChange + imbalanceChange + dispersionChange) / 4, 0, 10);
  const graphTension = clamp((dispersionChange + cancellationChange + Math.abs(finite(current.mempoolPressure || 0) - finite(previous.mempoolPressure || 0))) / 3, 0, 10);
  const dtSec = Math.max(0.001, (current.observedAt - previous.observedAt) / 1000);
  const temporalNovelty = clamp((topologyProxy + graphTension) / Math.sqrt(dtSec), 0, 20);
  return { topologyProxy, graphTension, temporalNovelty, spike: temporalNovelty >= 1 };
}

export function evaluateAriesStateLattice(states: AriesState[]): AriesStateLatticeResult {
  const valid = states.filter(state => state.probability > 0 && Number.isFinite(state.probability) && Number.isFinite(state.payoffBps));
  const totalProbability = valid.reduce((sum, state) => sum + state.probability, 0);
  if (!(totalProbability > 0)) return { expectedBps: 0, tailRiskBps: 0, riskAdjustedBps: 0 };
  let expectedBps = 0;
  let tailRiskBps = 0;
  for (const state of valid) {
    const p = state.probability / totalProbability;
    expectedBps += p * state.payoffBps;
    tailRiskBps += p * Math.max(0, finite(state.tailLossBps ?? Math.max(0, -state.payoffBps)));
  }
  return { expectedBps, tailRiskBps, riskAdjustedBps: expectedBps - tailRiskBps };
}

export function rankAriesBeam(candidates: AriesBeamCandidate[], width = 8): AriesBeamResult[] {
  return candidates.map(candidate => {
    const fitnessUsd = finite(candidate.expectedProfitUsd)
      + Math.max(0, finite(candidate.futureFeeTierValueUsd || 0))
      + finite(candidate.futureCapitalValueUsd || 0)
      - Math.max(0, finite(candidate.tailRiskUsd || 0))
      - Math.max(0, finite(candidate.uncertaintyUsd || 0))
      - Math.max(0, finite(candidate.capitalTimeCostUsd || 0))
      - Math.max(0, finite(candidate.computeCostUsd || 0));
    return { ...candidate, fitnessUsd };
  }).sort((a, b) => b.fitnessUsd - a.fitnessUsd || b.expectedRealizedBps - a.expectedRealizedBps)
    .slice(0, Math.max(1, Math.floor(width)));
}

export function scoreAriesCapitalLocations(locations: AriesCapitalLocation[]): AriesCapitalScore[] {
  return locations.map(location => ({
    ...location,
    marginalCapitalEfficiencyBps: finite(location.expectedOpportunityYieldBps)
      - Math.max(0, finite(location.feeDragBps))
      - Math.max(0, finite(location.rebalanceCostBps))
      - Math.max(0, finite(location.transferLatencyCostBps))
      - Math.max(0, finite(location.idleCapitalPenaltyBps)),
  })).sort((a, b) => b.marginalCapitalEfficiencyBps - a.marginalCapitalEfficiencyBps);
}

export function chooseAriesRobustRoute(routes: AriesRouteScenario[]): AriesRobustRoute | null {
  const usable = routes.filter(route => route.scenarioNetBps.length > 0 && route.scenarioNetBps.every(Number.isFinite));
  if (!usable.length) return null;
  const bestByScenario: number[] = [];
  const scenarioCount = Math.min(...usable.map(route => route.scenarioNetBps.length));
  for (let i = 0; i < scenarioCount; i++) bestByScenario.push(Math.max(...usable.map(route => route.scenarioNetBps[i])));
  const scored = usable.map(route => {
    const values = route.scenarioNetBps.slice(0, scenarioCount);
    const worstCaseBps = Math.min(...values);
    const averageBps = values.reduce((sum, value) => sum + value, 0) / values.length;
    const maxRegretBps = Math.max(...values.map((value, index) => bestByScenario[index] - value));
    return { routeId: route.routeId, worstCaseBps, averageBps, maxRegretBps, robustScoreBps: averageBps - maxRegretBps };
  });
  return scored.sort((a, b) => b.robustScoreBps - a.robustScoreBps || b.worstCaseBps - a.worstCaseBps)[0];
}

export function computeAriesCounterfactualRegret(actualRealizedBps: number, counterfactualBps: number[]): number {
  const valid = counterfactualBps.filter(Number.isFinite);
  return valid.length ? Math.max(0, Math.max(...valid) - finite(actualRealizedBps)) : 0;
}

export function computeAriesExpectedValueOfInformation(currentDecisionBps: number, alternateDecisionBps: number, probabilityInformationChangesDecision: number): number {
  return Math.max(0, finite(alternateDecisionBps) - finite(currentDecisionBps)) * clamp(probabilityInformationChangesDecision, 0, 1);
}

export function computeAriesLiquidityEventHorizon(input: {
  candidateNotionalsUsd: number[];
  expectedNetBpsAtNotional: (notionalUsd: number) => number;
}): number {
  const notionals = input.candidateNotionalsUsd.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  let horizon = 0;
  for (const notional of notionals) {
    const bps = input.expectedNetBpsAtNotional(notional);
    if (!Number.isFinite(bps) || bps <= 0) break;
    horizon = notional;
  }
  return horizon;
}

export function assessAriesVault(input: AriesOpportunityAssessmentInput): AriesOpportunityAssessment {
  const execution = evaluateAriesExecutionEconomics(input.execution);
  const novelty = input.currentSnapshot && input.previousSnapshot
    ? computeAriesNovelty(input.currentSnapshot, input.previousSnapshot)
    : null;
  const stateLattice = input.states?.length ? evaluateAriesStateLattice(input.states) : null;
  const selectedBeam = input.alternatives?.length ? rankAriesBeam(input.alternatives, 1)[0] || null : null;
  const safetyMarginBps = Math.max(0, finite(input.minSafetyMarginBps ?? 5));

  const irreversibleCostBps = Math.max(0, execution.blendedExpectedCostBps);
  const economicExergyBps = Math.max(0, execution.latencyAdjustedGrossBps - irreversibleCostBps);
  const thermodynamicEfficiencyCoefficient = execution.latencyAdjustedGrossBps > 0
    ? clamp(economicExergyBps / execution.latencyAdjustedGrossBps, 0, 1)
    : 0;

  const alternativeBps = selectedBeam?.expectedRealizedBps ?? execution.expectedRealizedBps;
  const expectedValueOfInformationBps = computeAriesExpectedValueOfInformation(
    execution.expectedRealizedBps,
    alternativeBps,
    novelty?.spike ? 0.75 : 0.25,
  );

  if (input.criticalUnknownCostBps === null || (input.criticalUnknownCostBps !== undefined && !Number.isFinite(input.criticalUnknownCostBps))) {
    return {
      symbol: input.symbol,
      action: 'abort',
      execution,
      novelty,
      stateLattice,
      selectedBeam,
      economicExergyBps,
      thermodynamicEfficiencyCoefficient,
      expectedValueOfInformationBps,
      safetyMarginBps,
      reason: 'Critical execution cost is unknown; Aries Vault fails closed',
      executionAuthority: false,
    };
  }

  const unknownCost = Math.max(0, finite(input.criticalUnknownCostBps || 0));
  const stateAdjustment = stateLattice ? Math.min(0, stateLattice.riskAdjustedBps) : 0;
  const conservativeNetBps = execution.expectedRealizedBps + stateAdjustment - unknownCost;
  const action: AriesAction = conservativeNetBps > safetyMarginBps ? 'execute' : conservativeNetBps > 0 ? 'hold' : 'abort';
  return {
    symbol: input.symbol,
    action,
    execution,
    novelty,
    stateLattice,
    selectedBeam,
    economicExergyBps,
    thermodynamicEfficiencyCoefficient,
    expectedValueOfInformationBps,
    safetyMarginBps,
    reason: action === 'execute'
      ? `Expected realized edge ${conservativeNetBps.toFixed(2)} bps clears the ${safetyMarginBps.toFixed(2)} bps safety margin`
      : action === 'hold'
        ? `Expected edge is positive but does not clear the ${safetyMarginBps.toFixed(2)} bps safety margin`
        : 'Expected edge is not positive after known costs and risk adjustments',
    executionAuthority: false,
  };
}

export function isAriesMakerRecoveryPath(symbol: string, buyVenue: string, sellVenue: string): boolean {
  const normalized = symbol.trim().toUpperCase();
  if (!/^([A-Z0-9]+)(USDT|USDC|USD)$/.test(normalized)) return false;
  const venues = new Set([buyVenue.trim().toLowerCase(), sellVenue.trim().toLowerCase()]);
  return venues.size === 2 && venues.has('kraken') && venues.has('okx');
}
