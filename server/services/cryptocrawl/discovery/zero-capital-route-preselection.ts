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
  lastPositiveAt: number | null;
  recentNetProfitBps: number | null;
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
  lastPositiveAt: number | null;
  recentNetProfitBps: number | null;
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
  // Laplace smoothing keeps one early observation from becoming permanent
  // priority. This is quote-yield telemetry only, never profitability truth.
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

function scoreRoute(
  route: ConfiguredZeroCapitalRoute,
  gasCostUsd: number,
  now: number,
): ZeroCapitalRoutePreScore {
  const item = evidence.get(route.id);
  const notionalUsd = routeNotionalUsd(route);
  const gasPressure = Math.max(0.000001, gasCostUsd / Math.max(0.01, notionalUsd));
  const cost = quoteCost(route);
  if (!item || item.lastPositiveAt === null || item.recentNetProfitBps === null || item.recentPositiveNotionalUsd === null) {
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
  const ageMs = Math.max(0, now - item.lastPositiveAt);
  const freshness = Math.pow(0.5, ageMs / freshnessHalfLifeMs);
  const edgePotential = Math.max(0.000001, Math.min(100, item.recentNetProfitBps) / 100);
  const executableLiquidity = Math.max(
    0.000001,
    Math.min(1, item.recentPositiveNotionalUsd / Math.max(0.01, notionalUsd)),
  );
  const probability = positiveProbability(item);
  const formation = formationFields(route.id, item.recentNetProfitBps, cost);
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
  // Oldest evidence always wins exploration. Once selected, recordQuoteCycle moves
  // that route's lastAttemptAt forward, naturally rotating priority across every
  // structural route without randomness or a permanently favored fixed pair.
  return oldestFirst(routes).slice(0, Math.min(count, routes.length));
}

/**
 * Allocate expensive route-quote work using measured historical evidence only.
 * Structural routes are never deleted. A deterministic exploration slice rotates
 * through stale/unobserved routes so no fixed pair/protocol/notional can hold
 * permanent priority. Historical edge survival and value-of-information only
 * multiply the advisory exploitation score; they never become profit evidence.
 */
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

  // When measured history is sparse, the unused budget remains exploration. No
  // synthetic score is assigned just to fill the quota.
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
  positiveQuotes: readonly QuotedZeroCapitalRoute[],
  observedAt = Date.now(),
): void {
  const positiveById = new Map(positiveQuotes.map(quote => [quote.id, quote]));
  for (const route of attemptedRoutes) {
    const current = evidence.get(route.id) ?? {
      routeId: route.id,
      chain: route.chain,
      attempts: 0,
      positiveQuotes: 0,
      lastAttemptAt: null,
      lastPositiveAt: null,
      recentNetProfitBps: null,
      recentPositiveNotionalUsd: null,
    };
    current.attempts += 1;
    current.lastAttemptAt = observedAt;
    const positiveQuote = positiveById.get(route.id);
    let observationNotionalUsd = routeNotionalUsd(route);
    if (positiveQuote) {
      current.positiveQuotes += 1;
      current.lastPositiveAt = observedAt;
      current.recentNetProfitBps = Number.isFinite(positiveQuote.netProfitBps) ? positiveQuote.netProfitBps : current.recentNetProfitBps;
      const notional = Number(positiveQuote.amountIn) / Math.pow(10, positiveQuote.inputTokenDecimals);
      if (Number.isFinite(notional) && notional > 0) {
        current.recentPositiveNotionalUsd = notional;
        observationNotionalUsd = notional;
      }
    }
    evidence.set(route.id, current);
    recordAriesRouteFormationObservation({
      routeId: route.id,
      observedAt,
      netProfitBps: positiveQuote && Number.isFinite(positiveQuote.netProfitBps) ? positiveQuote.netProfitBps : null,
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
