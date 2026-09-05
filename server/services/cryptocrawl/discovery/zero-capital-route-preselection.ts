import type {
  ConfiguredZeroCapitalRoute,
  QuotedZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import {
  getAriesRouteFormationScore,
  recordAriesRouteFormationObservation,
} from '../intelligence/aries-edge-formation-reactor.js';
import { buildHyperdynamicBpsPlan, type HyperdynamicBpsPlan } from '../optimization/hyperdynamic-bps-solution-engine.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from './measured-candidate-registry.js';

export interface ZeroCapitalProviderRepriceFeedback {
  routeId: string;
  opportunityId: string;
  provider: string;
  observedAt: number;
  expiresAt: number;
  notionalUsd: number;
  rawNetProfitBps: number;
  repricedNetProfitBps: number;
  measuredFlashLoanFeeBps: number;
  measuredNetImprovementBps: number;
  authority: 'quote_budget_advisory_only';
  deterministicProfitAuthority: false;
  executionAuthority: false;
}

export interface ZeroCapitalRoutePreselectionEvidence {
  routeId: string;
  chain: string;
  attempts: number;
  positiveQuotes: number;
  lastAttemptAt: number | null;
  lastMeasuredAt: number | null;
  lastPositiveAt: number | null;
  recentNetProfitBps: number | null;
  recentMeasuredNotionalUsd: number | null;
  recentPositiveNotionalUsd: number | null;
  estimatedDeterministicPositiveProbability: number | null;
  rankingNetProfitBps: number | null;
  providerRepriceFeedback: ZeroCapitalProviderRepriceFeedback | null;
}

export interface ZeroCapitalRoutePreScore {
  routeId: string;
  preScore: number | null;
  evidenceSufficient: boolean;
  edgePotential: number | null;
  executableLiquidity: number | null;
  freshness: number | null;
  gasPressure: number;
  quoteCost: number;
  estimatedDeterministicPositiveProbability: number | null;
  rawNetProfitBps: number | null;
  providerAdjustedNetProfitBps: number | null;
  providerMeasuredImprovementBps: number | null;
  survivalProbability: number;
  estimatedHalfLifeMs: number;
  valueOfInformation: number;
  formationPriority: number;
  formationPriorityMultiplier: number;
  authority: 'quote_budget_advisory_only';
  deterministicProfitAuthority: false;
  executionAuthority: false;
}

export interface ZeroCapitalRoutePreselection {
  selectedRoutes: ConfiguredZeroCapitalRoute[];
  structuralCandidates: number;
  quoteBudget: number;
  baseQuoteBudget: number;
  adaptiveBudgetDelta: number;
  scoredCandidates: number;
  explorationSelected: number;
  exploitationSelected: number;
  activeBpsSolutionCount: number;
  activeBpsSolutionIds: number[];
  quoteBudgetMultiplier: number;
  gasSensitivityMultiplier: number;
  scores: ZeroCapitalRoutePreScore[];
  authority: 'quote_budget_advisory_only';
  deterministicProfitAuthority: false;
  executionAuthority: false;
}

interface MutableRouteEvidence {
  routeId: string;
  chain: string;
  attempts: number;
  positiveQuotes: number;
  lastAttemptAt: number | null;
  lastMeasuredAt: number | null;
  lastPositiveAt: number | null;
  recentNetProfitBps: number | null;
  recentMeasuredNotionalUsd: number | null;
  recentPositiveNotionalUsd: number | null;
}

const evidence = new Map<string, MutableRouteEvidence>();
const providerRepriceFeedback = new Map<string, ZeroCapitalProviderRepriceFeedback>();
const seenProviderRepriceOpportunities = new Map<string, number>();

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function boundedNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function routeEvidenceMaxAgeMs(): number {
  return boundedInteger(process.env.ZERO_CAPITAL_ROUTE_EVIDENCE_MAX_AGE_MS, 60_000, 5_000, 300_000);
}

function providerFeedbackMaxAgeMs(): number {
  return boundedInteger(process.env.ZERO_CAPITAL_PROVIDER_REPRICE_FEEDBACK_MAX_AGE_MS, 5_000, 250, 15_000);
}

function hasFreshMeasuredEvidence(item: MutableRouteEvidence, now = Date.now()): boolean {
  return item.lastMeasuredAt !== null
    && item.lastMeasuredAt <= now
    && now - item.lastMeasuredAt <= routeEvidenceMaxAgeMs()
    && item.recentNetProfitBps !== null
    && Number.isFinite(item.recentNetProfitBps)
    && item.recentMeasuredNotionalUsd !== null
    && Number.isFinite(item.recentMeasuredNotionalUsd);
}

function routeNotionalUsd(route: ConfiguredZeroCapitalRoute): number {
  const baseUnits = Number(route.amountIn);
  const divisor = Math.pow(10, route.inputTokenDecimals);
  const usd = baseUnits / divisor;
  return Number.isFinite(usd) && usd > 0 ? usd : 0;
}

function positiveProbability(item: MutableRouteEvidence): number | null {
  if (item.attempts <= 0) return null;
  return (item.positiveQuotes + 1) / (item.attempts + 2);
}

function quoteCost(route: ConfiguredZeroCapitalRoute): number {
  const configuredSizes = boundedInteger(process.env.ZERO_CAPITAL_SIZE_CANDIDATES, 9, 1, 12);
  return Math.max(1, route.legs.length * configuredSizes);
}

function formationFields(routeId: string, consequence: number, cost: number) {
  const formation = getAriesRouteFormationScore(routeId, {
    horizonMs: boundedInteger(process.env.ZERO_CAPITAL_FORMATION_HORIZON_MS, 2_000, 100, 60_000),
    economicConsequence: consequence,
    quoteCost: cost,
  });
  return {
    survivalProbability: formation.survivalProbability,
    estimatedHalfLifeMs: formation.estimatedHalfLifeMs,
    valueOfInformation: formation.valueOfInformation,
    formationPriority: formation.formationPriority,
    formationPriorityMultiplier: formation.priorityMultiplier,
  };
}

function measuredEdgePotential(netProfitBps: number): number {
  if (!Number.isFinite(netProfitBps)) return 0.000001;
  if (netProfitBps > 0) return 1 + Math.min(10, netProfitBps / 100);
  const nearBreakEvenScaleBps = boundedNumber(
    process.env.ZERO_CAPITAL_NEAR_BREAK_EVEN_SCALE_BPS,
    50,
    1,
    500,
  );
  return Math.max(0.000001, 1 / (1 + Math.abs(netProfitBps) / nearBreakEvenScaleBps));
}

function resolveRouteIdFromOpportunityId(opportunityId: string): string | null {
  let match: string | null = null;
  for (const routeId of evidence.keys()) {
    if (!opportunityId.startsWith(`${routeId}-`)) continue;
    if (match === null || routeId.length > match.length) match = routeId;
  }
  return match;
}

function providerName(candidate: MeasuredCandidate): string | null {
  const providers = candidate.provenance
    .filter(value => value.startsWith('flash_loan_provider:'))
    .map(value => value.slice('flash_loan_provider:'.length))
    .filter(Boolean);
  if (providers.includes('aave_balancer_dual')) return 'aave_balancer_dual';
  return providers.length > 0 ? providers[providers.length - 1] : null;
}

function pruneProviderFeedback(now = Date.now()): void {
  for (const [routeId, feedback] of providerRepriceFeedback.entries()) {
    if (feedback.expiresAt <= now || now - feedback.observedAt > providerFeedbackMaxAgeMs()) {
      providerRepriceFeedback.delete(routeId);
    }
  }
  for (const [opportunityId, expiresAt] of seenProviderRepriceOpportunities.entries()) {
    if (expiresAt <= now) seenProviderRepriceOpportunities.delete(opportunityId);
  }
}

function freshProviderFeedback(item: MutableRouteEvidence, now = Date.now()): ZeroCapitalProviderRepriceFeedback | null {
  pruneProviderFeedback(now);
  const feedback = providerRepriceFeedback.get(item.routeId);
  if (!feedback || item.lastMeasuredAt === null || item.recentMeasuredNotionalUsd === null) return null;
  if (feedback.observedAt < item.lastMeasuredAt || feedback.observedAt > now || feedback.expiresAt <= now) return null;
  if (now - feedback.observedAt > providerFeedbackMaxAgeMs()) return null;
  if (Math.abs(feedback.notionalUsd - item.recentMeasuredNotionalUsd) > 0.000001) return null;
  return feedback;
}

function rankingNetProfitBps(item: MutableRouteEvidence, now = Date.now()): number | null {
  if (!hasFreshMeasuredEvidence(item, now)) return null;
  return freshProviderFeedback(item, now)?.repricedNetProfitBps ?? item.recentNetProfitBps;
}

function recordProviderRepriceCandidate(candidate: MeasuredCandidate): void {
  if (candidate.topology !== 'ZERO_CAPITAL_ATOMIC' || candidate.expiresAt <= Date.now()) return;
  if (seenProviderRepriceOpportunities.has(candidate.opportunityId)) return;
  if (!candidate.provenance.includes('measured_flash_loan_fee_exact_rate')) return;
  if (!candidate.provenance.includes('provider_selection_bound_to_verified_receiver')) return;
  if (!candidate.provenance.includes('synthetic_evidence:false')) return;

  const provider = providerName(candidate);
  const routeId = resolveRouteIdFromOpportunityId(candidate.opportunityId);
  const item = routeId ? evidence.get(routeId) : null;
  const repricedNetProfitBps = finite(candidate.canonicalBps.netBps);
  const measuredFlashLoanFeeBps = finite(candidate.canonicalBps.flashLoanFeeBps);
  if (!provider || !routeId || !item || item.lastMeasuredAt === null || item.recentNetProfitBps === null || item.recentMeasuredNotionalUsd === null) return;
  if (candidate.updatedAt < item.lastMeasuredAt || repricedNetProfitBps === null || measuredFlashLoanFeeBps === null) return;

  seenProviderRepriceOpportunities.set(candidate.opportunityId, candidate.expiresAt);
  providerRepriceFeedback.set(routeId, {
    routeId,
    opportunityId: candidate.opportunityId,
    provider,
    observedAt: candidate.updatedAt,
    expiresAt: candidate.expiresAt,
    notionalUsd: item.recentMeasuredNotionalUsd,
    rawNetProfitBps: item.recentNetProfitBps,
    repricedNetProfitBps,
    measuredFlashLoanFeeBps,
    measuredNetImprovementBps: repricedNetProfitBps - item.recentNetProfitBps,
    authority: 'quote_budget_advisory_only',
    deterministicProfitAuthority: false,
    executionAuthority: false,
  });
}

// Provider repricing already happens inside the canonical zero-capital provider mesh.
// This listener only feeds that exact, fresh result back into the next quote-budget
// ranking pass. It never mutates a candidate, increments deterministic-positive
// history, or creates execution/economic authority.
measuredCandidateRegistry.onUpdate(recordProviderRepriceCandidate);

function zeroCapitalPlan(routes: readonly ConfiguredZeroCapitalRoute[]): HyperdynamicBpsPlan {
  let attempts = 0;
  let measured = 0;
  let positive = 0;
  const gaps: number[] = [];
  const now = Date.now();
  for (const route of routes) {
    const item = evidence.get(route.id);
    if (!item) continue;
    attempts += item.attempts;
    positive += item.positiveQuotes;
    const rankingNet = rankingNetProfitBps(item, now);
    if (rankingNet === null) continue;
    measured += 1;
    if (rankingNet <= 0) gaps.push(Math.abs(rankingNet));
  }
  return buildHyperdynamicBpsPlan({
    zeroCapitalGapBps: gaps.length > 0 ? Math.min(...gaps) : null,
    zeroCapitalPositiveYield: attempts > 0 ? positive / attempts : null,
    zeroCapitalQuoteUtilization: routes.length > 0 ? measured / routes.length : null,
  });
}

function scoreRoute(
  route: ConfiguredZeroCapitalRoute,
  gasCostUsd: number,
  now: number,
  plan: HyperdynamicBpsPlan,
): ZeroCapitalRoutePreScore {
  const item = evidence.get(route.id);
  const notionalUsd = routeNotionalUsd(route);
  const gasPressure = Math.max(0.000001, gasCostUsd / Math.max(0.01, notionalUsd)) * plan.gasSensitivityMultiplier;
  const cost = quoteCost(route);
  if (!item || !hasFreshMeasuredEvidence(item, now)) {
    return {
      routeId: route.id,
      preScore: null,
      evidenceSufficient: false,
      edgePotential: null,
      executableLiquidity: null,
      freshness: null,
      gasPressure,
      quoteCost: cost,
      estimatedDeterministicPositiveProbability: item ? positiveProbability(item) : null,
      rawNetProfitBps: item?.recentNetProfitBps ?? null,
      providerAdjustedNetProfitBps: null,
      providerMeasuredImprovementBps: null,
      ...formationFields(route.id, 0, cost),
      authority: 'quote_budget_advisory_only',
      deterministicProfitAuthority: false,
      executionAuthority: false,
    };
  }

  const freshnessHalfLifeMs = boundedNumber(
    process.env.ZERO_CAPITAL_ROUTE_PRESCORE_HALF_LIFE_MS,
    60_000,
    5_000,
    60 * 60_000,
  );
  const ageMs = Math.max(0, now - item.lastMeasuredAt!);
  const freshness = Math.pow(0.5, ageMs / freshnessHalfLifeMs);
  const feedback = freshProviderFeedback(item, now);
  const rankingNet = feedback?.repricedNetProfitBps ?? item.recentNetProfitBps!;
  const edgePotential = measuredEdgePotential(rankingNet);
  const executableLiquidity = Math.max(
    0.000001,
    Math.min(1, item.recentMeasuredNotionalUsd! / Math.max(0.01, notionalUsd)),
  );
  const probability = positiveProbability(item);
  // Aries formation remains tied to the raw market quote so provider-cost feedback
  // cannot be double-counted as a second market-edge observation.
  const formation = formationFields(route.id, Math.max(0, item.recentNetProfitBps!), cost);
  const baseScore = probability === null
    ? null
    : (edgePotential * executableLiquidity * freshness * probability) / (gasPressure * cost);
  const preScore = baseScore === null ? null : baseScore * formation.formationPriorityMultiplier;

  return {
    routeId: route.id,
    preScore: preScore !== null && Number.isFinite(preScore) ? preScore : null,
    evidenceSufficient: preScore !== null && Number.isFinite(preScore),
    edgePotential,
    executableLiquidity,
    freshness,
    gasPressure,
    quoteCost: cost,
    estimatedDeterministicPositiveProbability: probability,
    rawNetProfitBps: item.recentNetProfitBps,
    providerAdjustedNetProfitBps: feedback?.repricedNetProfitBps ?? null,
    providerMeasuredImprovementBps: feedback?.measuredNetImprovementBps ?? null,
    ...formation,
    authority: 'quote_budget_advisory_only',
    deterministicProfitAuthority: false,
    executionAuthority: false,
  };
}

function oldestFirst(routes: ConfiguredZeroCapitalRoute[]): ConfiguredZeroCapitalRoute[] {
  return [...routes].sort((left, right) => {
    const leftEvidence = evidence.get(left.id);
    const rightEvidence = evidence.get(right.id);
    const leftTime = leftEvidence?.lastAttemptAt ?? 0;
    const rightTime = rightEvidence?.lastAttemptAt ?? 0;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.id.localeCompare(right.id);
  });
}

function deterministicExploration(
  routes: ConfiguredZeroCapitalRoute[],
  count: number,
): ConfiguredZeroCapitalRoute[] {
  if (count <= 0 || routes.length === 0) return [];
  return oldestFirst(routes).slice(0, Math.min(count, routes.length));
}

function adaptiveQuoteBudget(
  routes: readonly ConfiguredZeroCapitalRoute[],
  plan: HyperdynamicBpsPlan,
): { base: number; budget: number; delta: number } {
  const base = boundedInteger(process.env.ZERO_CAPITAL_DYNAMIC_QUOTE_BUDGET, 16, 1, 256);
  const cap = Math.max(base, boundedInteger(process.env.ZERO_CAPITAL_ADAPTIVE_QUOTE_BUDGET_MAX, 64, base, 256));
  if (process.env.ZERO_CAPITAL_ADAPTIVE_QUOTE_BUDGET === 'false' || routes.length <= base) {
    const raw = Math.min(routes.length, base);
    const budget = Math.max(1, Math.min(routes.length, Math.round(raw * plan.quoteBudgetMultiplier)));
    return { base: Math.min(routes.length, base), budget, delta: budget - Math.min(routes.length, base) };
  }

  const scaleBps = boundedNumber(process.env.ZERO_CAPITAL_NEAR_BREAK_EVEN_SCALE_BPS, 50, 1, 500);
  let measured = 0;
  let promising = 0;
  let positive = 0;
  const now = Date.now();
  for (const route of routes) {
    const item = evidence.get(route.id);
    if (!item || !hasFreshMeasuredEvidence(item, now)) continue;
    const rankingNet = rankingNetProfitBps(item, now);
    if (rankingNet === null) continue;
    measured += 1;
    if (rankingNet > 0) positive += 1;
    if (rankingNet >= -scaleBps) promising += 1;
  }

  const signal = measured > 0 ? (promising + positive * 2) / measured : 0;
  const structuralPressure = Math.min(1, routes.length / Math.max(base * 8, 1));
  const expansion = Math.floor((cap - base) * Math.min(1, signal) * (0.5 + 0.5 * structuralPressure));
  const rawBudget = Math.min(routes.length, cap, base + Math.max(0, expansion));
  const budget = Math.max(1, Math.min(routes.length, cap, Math.round(rawBudget * plan.quoteBudgetMultiplier)));
  return { base: Math.min(routes.length, base), budget, delta: budget - Math.min(routes.length, base) };
}

export function selectZeroCapitalRoutesForQuote(
  routes: ConfiguredZeroCapitalRoute[],
  gasCostUsd: number,
): ZeroCapitalRoutePreselection {
  const plan = zeroCapitalPlan(routes);
  if (routes.length === 0) {
    return {
      selectedRoutes: [],
      structuralCandidates: 0,
      quoteBudget: 0,
      baseQuoteBudget: 0,
      adaptiveBudgetDelta: 0,
      scoredCandidates: 0,
      explorationSelected: 0,
      exploitationSelected: 0,
      activeBpsSolutionCount: plan.activeSolutionCount,
      activeBpsSolutionIds: [...plan.activeSolutionIds],
      quoteBudgetMultiplier: plan.quoteBudgetMultiplier,
      gasSensitivityMultiplier: plan.gasSensitivityMultiplier,
      scores: [],
      authority: 'quote_budget_advisory_only',
      deterministicProfitAuthority: false,
      executionAuthority: false,
    };
  }

  const budgetDecision = adaptiveQuoteBudget(routes, plan);
  const quoteBudget = budgetDecision.budget;
  if (quoteBudget >= routes.length) {
    const scores = routes.map(route => scoreRoute(route, gasCostUsd, Date.now(), plan));
    return {
      selectedRoutes: [...routes],
      structuralCandidates: routes.length,
      quoteBudget,
      baseQuoteBudget: budgetDecision.base,
      adaptiveBudgetDelta: budgetDecision.delta,
      scoredCandidates: scores.filter(score => score.evidenceSufficient).length,
      explorationSelected: routes.length,
      exploitationSelected: 0,
      activeBpsSolutionCount: plan.activeSolutionCount,
      activeBpsSolutionIds: [...plan.activeSolutionIds],
      quoteBudgetMultiplier: plan.quoteBudgetMultiplier,
      gasSensitivityMultiplier: plan.gasSensitivityMultiplier,
      scores,
      authority: 'quote_budget_advisory_only',
      deterministicProfitAuthority: false,
      executionAuthority: false,
    };
  }

  const baseExplorationFraction = boundedNumber(process.env.ZERO_CAPITAL_ROUTE_EXPLORATION_FRACTION, 0.25, 0.10, 0.75);
  const explorationFraction = Math.max(0.10, Math.min(0.75, baseExplorationFraction * plan.explorationMultiplier));
  const explorationCount = Math.max(1, Math.min(quoteBudget, Math.ceil(quoteBudget * explorationFraction)));
  const exploration = deterministicExploration(routes, explorationCount);
  const selectedIds = new Set(exploration.map(route => route.id));
  const now = Date.now();
  const scores = routes.map(route => scoreRoute(route, gasCostUsd, now, plan));
  const byId = new Map(routes.map(route => [route.id, route]));
  const ranked = scores
    .filter(score => !selectedIds.has(score.routeId) && score.preScore !== null)
    .sort((left, right) => {
      if ((right.preScore ?? -1) !== (left.preScore ?? -1)) return (right.preScore ?? -1) - (left.preScore ?? -1);
      return left.routeId.localeCompare(right.routeId);
    });

  const exploitation: ConfiguredZeroCapitalRoute[] = [];
  for (const score of ranked) {
    if (exploration.length + exploitation.length >= quoteBudget) break;
    const route = byId.get(score.routeId);
    if (!route) continue;
    exploitation.push(route);
    selectedIds.add(route.id);
  }

  if (exploration.length + exploitation.length < quoteBudget) {
    const remaining = routes.filter(route => !selectedIds.has(route.id));
    const fill = deterministicExploration(remaining, quoteBudget - exploration.length - exploitation.length);
    for (const route of fill) {
      exploration.push(route);
      selectedIds.add(route.id);
    }
  }

  return {
    selectedRoutes: [...exploitation, ...exploration],
    structuralCandidates: routes.length,
    quoteBudget,
    baseQuoteBudget: budgetDecision.base,
    adaptiveBudgetDelta: budgetDecision.delta,
    scoredCandidates: scores.filter(score => score.evidenceSufficient).length,
    explorationSelected: exploration.length,
    exploitationSelected: exploitation.length,
    activeBpsSolutionCount: plan.activeSolutionCount,
    activeBpsSolutionIds: [...plan.activeSolutionIds],
    quoteBudgetMultiplier: plan.quoteBudgetMultiplier,
    gasSensitivityMultiplier: plan.gasSensitivityMultiplier,
    scores,
    authority: 'quote_budget_advisory_only',
    deterministicProfitAuthority: false,
    executionAuthority: false,
  };
}

export function recordZeroCapitalRouteQuoteCycle(
  attemptedRoutes: readonly ConfiguredZeroCapitalRoute[],
  measuredQuotes: readonly QuotedZeroCapitalRoute[],
  observedAt = Date.now(),
): void {
  const quoteById = new Map(measuredQuotes.map(quote => [quote.id, quote]));
  for (const route of attemptedRoutes) {
    const current = evidence.get(route.id) ?? {
      routeId: route.id,
      chain: route.chain,
      attempts: 0,
      positiveQuotes: 0,
      lastAttemptAt: null,
      lastMeasuredAt: null,
      lastPositiveAt: null,
      recentNetProfitBps: null,
      recentMeasuredNotionalUsd: null,
      recentPositiveNotionalUsd: null,
    };
    current.attempts += 1;
    current.lastAttemptAt = observedAt;

    const quote = quoteById.get(route.id);
    const deterministicPositive = !!quote && quote.executablePositive && quote.netProfit > 0n;
    let observationNotionalUsd = routeNotionalUsd(route);

    if (quote && Number.isFinite(quote.netProfitBps)) {
      current.lastMeasuredAt = observedAt;
      current.recentNetProfitBps = quote.netProfitBps;
      const notional = Number(quote.amountIn) / Math.pow(10, quote.inputTokenDecimals);
      if (Number.isFinite(notional) && notional > 0) observationNotionalUsd = notional;
      current.recentMeasuredNotionalUsd = observationNotionalUsd;
    } else {
      current.recentNetProfitBps = null;
      current.recentMeasuredNotionalUsd = null;
    }

    if (deterministicPositive && quote) {
      current.positiveQuotes += 1;
      current.lastPositiveAt = observedAt;
      const notional = Number(quote.amountIn) / Math.pow(10, quote.inputTokenDecimals);
      if (Number.isFinite(notional) && notional > 0) current.recentPositiveNotionalUsd = notional;
    }

    evidence.set(route.id, current);
    recordAriesRouteFormationObservation({
      routeId: route.id,
      observedAt,
      netProfitBps: quote && Number.isFinite(quote.netProfitBps) ? quote.netProfitBps : null,
      notionalUsd: observationNotionalUsd,
    });
  }
}

export function getZeroCapitalRoutePreselectionEvidence(): ZeroCapitalRoutePreselectionEvidence[] {
  const now = Date.now();
  return [...evidence.values()].map(item => {
    const fresh = hasFreshMeasuredEvidence(item, now);
    const feedback = fresh ? freshProviderFeedback(item, now) : null;
    return {
      ...item,
      recentNetProfitBps: fresh ? item.recentNetProfitBps : null,
      recentMeasuredNotionalUsd: fresh ? item.recentMeasuredNotionalUsd : null,
      estimatedDeterministicPositiveProbability: positiveProbability(item),
      rankingNetProfitBps: fresh ? (feedback?.repricedNetProfitBps ?? item.recentNetProfitBps) : null,
      providerRepriceFeedback: feedback ? { ...feedback } : null,
    };
  });
}
