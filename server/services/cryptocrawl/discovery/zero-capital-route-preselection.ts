import type {
  ConfiguredZeroCapitalRoute,
  QuotedZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import {
  getAriesRouteFormationScore,
  recordAriesRouteFormationObservation,
} from '../intelligence/aries-edge-formation-reactor.js';

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
  scoredCandidates: number;
  explorationSelected: number;
  exploitationSelected: number;
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

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function boundedNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
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

function scoreRoute(
  route: ConfiguredZeroCapitalRoute,
  gasCostUsd: number,
  now: number,
): ZeroCapitalRoutePreScore {
  const item = evidence.get(route.id);
  const notionalUsd = routeNotionalUsd(route);
  const gasPressure = Math.max(0.000001, gasCostUsd / Math.max(0.01, notionalUsd));
  const cost = quoteCost(route);
  if (!item || item.lastMeasuredAt === null || item.recentNetProfitBps === null || item.recentMeasuredNotionalUsd === null) {
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
      ...formationFields(route.id, item?.recentNetProfitBps ?? 0, cost),
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
  const ageMs = Math.max(0, now - item.lastMeasuredAt);
  const freshness = Math.pow(0.5, ageMs / freshnessHalfLifeMs);
  const edgePotential = measuredEdgePotential(item.recentNetProfitBps);
  const executableLiquidity = Math.max(
    0.000001,
    Math.min(1, item.recentMeasuredNotionalUsd / Math.max(0.01, notionalUsd)),
  );
  const probability = positiveProbability(item);
  const formation = formationFields(route.id, Math.max(0, item.recentNetProfitBps), cost);
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

export function selectZeroCapitalRoutesForQuote(
  routes: ConfiguredZeroCapitalRoute[],
  gasCostUsd: number,
): ZeroCapitalRoutePreselection {
  if (routes.length === 0) {
    return {
      selectedRoutes: [],
      structuralCandidates: 0,
      quoteBudget: 0,
      scoredCandidates: 0,
      explorationSelected: 0,
      exploitationSelected: 0,
      scores: [],
      authority: 'quote_budget_advisory_only',
      deterministicProfitAuthority: false,
      executionAuthority: false,
    };
  }

  const maximumBudget = boundedInteger(process.env.ZERO_CAPITAL_DYNAMIC_QUOTE_BUDGET, 16, 1, 256);
  const quoteBudget = Math.min(routes.length, maximumBudget);
  if (quoteBudget >= routes.length) {
    const scores = routes.map(route => scoreRoute(route, gasCostUsd, Date.now()));
    return {
      selectedRoutes: [...routes],
      structuralCandidates: routes.length,
      quoteBudget,
      scoredCandidates: scores.filter(score => score.evidenceSufficient).length,
      explorationSelected: routes.length,
      exploitationSelected: 0,
      scores,
      authority: 'quote_budget_advisory_only',
      deterministicProfitAuthority: false,
      executionAuthority: false,
    };
  }

  const explorationFraction = boundedNumber(process.env.ZERO_CAPITAL_ROUTE_EXPLORATION_FRACTION, 0.25, 0.10, 0.75);
  const explorationCount = Math.max(1, Math.min(quoteBudget, Math.ceil(quoteBudget * explorationFraction)));
  const exploration = deterministicExploration(routes, explorationCount);
  const selectedIds = new Set(exploration.map(route => route.id));
  const now = Date.now();
  const scores = routes.map(route => scoreRoute(route, gasCostUsd, now));
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
    scoredCandidates: scores.filter(score => score.evidenceSufficient).length,
    explorationSelected: exploration.length,
    exploitationSelected: exploitation.length,
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
  return [...evidence.values()].map(item => ({
    ...item,
    estimatedDeterministicPositiveProbability: positiveProbability(item),
  }));
}
