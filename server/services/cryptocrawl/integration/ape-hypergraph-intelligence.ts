import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import type { ConfiguredZeroCapitalRoute } from '../execution/adapters/onchain-route-quoter.js';
import type { FlashLoanProviderEconomics, FlashLoanProviderKind } from '../execution/adapters/flash-loan-provider-economics.js';
import type { FlashLoanReceiverCapabilityKind } from '../execution/adapters/flash-loan-receiver-capability.js';

/**
 * Research-backed APE hot-path intelligence.
 *
 * Design rules:
 * - no network/database/model/queue I/O;
 * - deterministic gross economics outrank advisory scheduling;
 * - bounded work waves preserve a persistent frontier instead of rechecking the
 *   same prefix forever;
 * - route/ratio/composite history only changes ordering, never economic truth;
 * - deadlines bound one work wave, never candidate ownership.
 */

export type ApeRescueMode = 'route_first' | 'size_first';

export interface ApeDefectVector {
  grossProfitBaseUnits: bigint;
  netProfitBaseUnits: bigint;
  executionCostBaseUnits: bigint;
  grossPositive: boolean;
  costOnlyDefect: boolean;
  structuralEdgeDefect: boolean;
  rescueMode: ApeRescueMode;
}

type RouteOutcome = {
  attempts: number;
  improvements: number;
  strictPositive: number;
  cumulativeImprovementBps: number;
  cumulativeLatencyMs: number;
};

const routeOutcomes = new Map<string, RouteOutcome>();
const routeFrontierCursor = new Map<string, number>();
const splitRatioCursor = new Map<string, number>();
const lateResultGenerations = new Map<string, number>();
const MAX_RESIDENT_KEYS = 4096;

function pruneMap<T>(map: Map<string, T>): void {
  while (map.size > MAX_RESIDENT_KEYS) {
    const key = map.keys().next().value as string | undefined;
    if (!key) break;
    map.delete(key);
  }
}

export function exactGrossProfit(opportunity: ZeroCapitalOpportunity): bigint {
  return opportunity.grossProfit
    ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
}

export function buildApeDefectVector(opportunity: ZeroCapitalOpportunity): ApeDefectVector {
  const grossProfitBaseUnits = exactGrossProfit(opportunity);
  const executionCostBaseUnits = opportunity.estimatedExecutionCostInInputToken;
  const netProfitBaseUnits = opportunity.expectedProfit;
  const grossPositive = grossProfitBaseUnits > 0n;
  const costOnlyDefect = grossPositive && netProfitBaseUnits <= 0n;
  const structuralEdgeDefect = grossProfitBaseUnits <= 0n;
  return {
    grossProfitBaseUnits,
    netProfitBaseUnits,
    executionCostBaseUnits,
    grossPositive,
    costOnlyDefect,
    structuralEdgeDefect,
    rescueMode: structuralEdgeDefect ? 'route_first' : 'size_first',
  };
}

export function routeStructuralKey(route: ConfiguredZeroCapitalRoute): string {
  return [
    route.chain,
    route.inputAssetSymbol,
    route.inputToken.toLowerCase(),
    route.inputTokenDecimals,
  ].join('|');
}

function legIdentity(route: ConfiguredZeroCapitalRoute): string {
  return route.legs.map(leg => [
    leg.protocol.toLowerCase(),
    leg.tokenIn.toLowerCase(),
    leg.tokenOut.toLowerCase(),
    leg.pool?.toLowerCase() ?? '',
    leg.feeTier ?? '',
    leg.fee ?? '',
  ].join(':')).join('>');
}

export function routeTopologySignature(route: ConfiguredZeroCapitalRoute): string {
  return `${route.id}|${routeStructuralKey(route)}|${legIdentity(route)}`;
}

/** Stable content identity replaces JavaScript array-object identity. */
export function routeInventoryFingerprint(routes: readonly ConfiguredZeroCapitalRoute[]): string {
  let hash = 2166136261 >>> 0;
  for (const route of routes) {
    const text = routeTopologySignature(route);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return `${routes.length}:${hash.toString(16)}`;
}

export function routeFamilyKey(route: ConfiguredZeroCapitalRoute): string {
  const protocols = route.legs.map(leg => leg.protocol.toLowerCase()).join('>');
  const pools = route.legs.map(leg => leg.pool?.toLowerCase() ?? '').join('>');
  const fees = route.legs.map(leg => leg.feeTier ?? leg.fee ?? '').join('>');
  return `${routeStructuralKey(route)}|${protocols}|${pools}|${fees}`;
}

function outcomeKey(route: ConfiguredZeroCapitalRoute): string {
  return `${route.chain}:${route.id}`;
}

export function recordApeRouteOutcome(input: {
  route: ConfiguredZeroCapitalRoute;
  beforeBps: number;
  afterBps: number | null;
  latencyMs: number;
  strictPositive: boolean;
}): void {
  const key = outcomeKey(input.route);
  const current = routeOutcomes.get(key) ?? {
    attempts: 0,
    improvements: 0,
    strictPositive: 0,
    cumulativeImprovementBps: 0,
    cumulativeLatencyMs: 0,
  };
  current.attempts += 1;
  current.cumulativeLatencyMs += Math.max(0, Number.isFinite(input.latencyMs) ? input.latencyMs : 0);
  if (input.afterBps !== null && Number.isFinite(input.afterBps) && Number.isFinite(input.beforeBps)) {
    const improvement = input.afterBps - input.beforeBps;
    if (improvement > 0) {
      current.improvements += 1;
      current.cumulativeImprovementBps += improvement;
    }
  }
  if (input.strictPositive) current.strictPositive += 1;
  routeOutcomes.set(key, current);
  pruneMap(routeOutcomes);
}

/**
 * Higher is better. This is ordering intelligence only; it never replaces exact
 * quote economics. A route with no history stays neutral rather than penalized.
 */
export function routeOutcomeScore(route: ConfiguredZeroCapitalRoute): number {
  const outcome = routeOutcomes.get(outcomeKey(route));
  if (!outcome || outcome.attempts <= 0) return 0;
  const success = outcome.strictPositive / outcome.attempts;
  const improve = outcome.improvements / outcome.attempts;
  const avgImprovement = outcome.cumulativeImprovementBps / outcome.attempts;
  const avgLatency = outcome.cumulativeLatencyMs / outcome.attempts;
  return success * 1000 + improve * 100 + avgImprovement * 10 - Math.log1p(avgLatency);
}

/**
 * Eppstein/Yen-style persistent alternative frontier: a bounded wave can be small
 * without repeatedly consuming the same prefix. Families are diversified first,
 * then the remaining routes are revisited in stable resident order.
 */
export function selectPersistentRouteFrontier(input: {
  opportunity: ZeroCapitalOpportunity;
  routes: readonly ConfiguredZeroCapitalRoute[];
  width: number;
}): ConfiguredZeroCapitalRoute[] {
  const width = Math.max(1, Math.min(input.routes.length, Math.trunc(input.width)));
  if (width <= 0 || input.routes.length === 0) return [];
  const vector = buildApeDefectVector(input.opportunity);
  const ordered = [...input.routes].sort((left, right) => {
    const outcomeDelta = routeOutcomeScore(right) - routeOutcomeScore(left);
    if (Math.abs(outcomeDelta) > 1e-9) return outcomeDelta;
    if (vector.structuralEdgeDefect) {
      const leftFee = left.legs.reduce((sum, leg) => sum + (leg.feeTier !== undefined ? leg.feeTier / 100 : (leg.fee ?? 0) * 10_000), 0);
      const rightFee = right.legs.reduce((sum, leg) => sum + (leg.feeTier !== undefined ? leg.feeTier / 100 : (leg.fee ?? 0) * 10_000), 0);
      if (leftFee !== rightFee) return leftFee - rightFee;
    }
    return left.id.localeCompare(right.id);
  });

  const frontierKey = [
    input.opportunity.chain,
    input.opportunity.inputToken.toLowerCase(),
    input.opportunity.inputAssetSymbol,
    vector.rescueMode,
  ].join(':');
  const cursor = routeFrontierCursor.get(frontierKey) ?? 0;
  const rotated = ordered.map((_, index) => ordered[(cursor + index) % ordered.length]);
  const selected: ConfiguredZeroCapitalRoute[] = [];
  const deferred: ConfiguredZeroCapitalRoute[] = [];
  const families = new Set<string>();
  for (const route of rotated) {
    const family = routeFamilyKey(route);
    if (families.has(family)) deferred.push(route);
    else {
      families.add(family);
      selected.push(route);
      if (selected.length >= width) break;
    }
  }
  for (const route of deferred) {
    if (selected.length >= width) break;
    selected.push(route);
  }
  routeFrontierCursor.set(frontierKey, (cursor + Math.max(1, selected.length)) % ordered.length);
  pruneMap(routeFrontierCursor);
  return selected;
}

/** One best split ratio per wave; later waves rotate to the remaining ratios. */
export function selectPersistentSplitRatio<T>(key: string, ratios: readonly T[]): T[] {
  if (ratios.length === 0) return [];
  const cursor = splitRatioCursor.get(key) ?? 0;
  const selected = ratios[cursor % ratios.length];
  splitRatioCursor.set(key, (cursor + 1) % ratios.length);
  pruneMap(splitRatioCursor);
  return [selected];
}

export function providerReceiverKind(provider: FlashLoanProviderKind): FlashLoanReceiverCapabilityKind {
  if (provider === 'aave_v3') return 'aave_v3';
  if (provider === 'morpho_blue') return 'morpho_blue';
  return 'balancer_composite_v2';
}

export function cheapestFundableProviders(
  evidence: readonly FlashLoanProviderEconomics[],
  amount: bigint,
): FlashLoanProviderEconomics[] {
  return evidence
    .filter(item =>
      item.executableEvidenceComplete
      && item.availableLiquidity !== null
      && item.availableLiquidity >= amount
      && item.feeRateNumerator !== null
      && item.feeRateDenominator !== null,
    )
    .sort((left, right) => {
      const leftFee = left.feeBps ?? Number.POSITIVE_INFINITY;
      const rightFee = right.feeBps ?? Number.POSITIVE_INFINITY;
      if (leftFee !== rightFee) return leftFee - rightFee;
      const leftLiquidity = left.availableLiquidity ?? 0n;
      const rightLiquidity = right.availableLiquidity ?? 0n;
      return leftLiquidity === rightLiquidity ? 0 : leftLiquidity > rightLiquidity ? -1 : 1;
    });
}

/**
 * Deadline authority wrapper. The underlying transport may finish later, but its
 * result loses authority at the boundary and cannot extend the APE wave.
 */
export function settleBeforeDeadline<T>(
  promise: Promise<T>,
  deadlineAt: number | undefined,
  fallback: T,
): Promise<T> {
  if (deadlineAt === undefined) return promise.catch(() => fallback);
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return Promise.resolve(fallback);
  return new Promise<T>(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, remaining);
    timer.unref?.();
    promise.then(value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(fallback);
    });
  });
}

export function startAuthorityGeneration(key: string): number {
  const generation = (lateResultGenerations.get(key) ?? 0) + 1;
  lateResultGenerations.set(key, generation);
  pruneMap(lateResultGenerations);
  return generation;
}

export function authorityGenerationCurrent(key: string, generation: number): boolean {
  return lateResultGenerations.get(key) === generation;
}

function opportunityPotential(opportunity: ZeroCapitalOpportunity): bigint {
  const gross = exactGrossProfit(opportunity);
  return gross > opportunity.expectedProfit ? gross : opportunity.expectedProfit;
}

/**
 * Branch-and-bound-inspired non-prefix composition search. It replaces prefix-only
 * variants with the highest-potential distinct combinations while remaining
 * bounded. Exact composite simulation is still the sole promotion authority.
 */
export function buildBoundedStackVariants(
  opportunities: readonly ZeroCapitalOpportunity[],
  maxVariants: number,
  maxMembers: number,
  maxSteps: number,
): ZeroCapitalOpportunity[][] {
  const candidates = [...opportunities]
    .filter(item => item.route.length >= 2 && item.route.length <= maxSteps)
    .sort((left, right) => {
      const leftPotential = opportunityPotential(left);
      const rightPotential = opportunityPotential(right);
      if (leftPotential !== rightPotential) return leftPotential > rightPotential ? -1 : 1;
      return right.netProfitBps - left.netProfitBps;
    })
    .slice(0, Math.max(2, Math.min(8, maxMembers)));

  const variants: Array<{ members: ZeroCapitalOpportunity[]; potential: bigint }> = [];
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const pair = [candidates[left], candidates[right]];
      const steps = pair[0].route.length + pair[1].route.length;
      if (steps > maxSteps) continue;
      variants.push({
        members: pair,
        potential: opportunityPotential(pair[0]) + opportunityPotential(pair[1]),
      });
    }
  }

  // Add progressively larger high-potential combinations, but do not require them
  // to be prefixes of the original ranking.
  for (const seed of [...variants]) {
    if (seed.members.length >= maxMembers) continue;
    let steps = seed.members.reduce((sum, item) => sum + item.route.length, 0);
    const members = [...seed.members];
    for (const candidate of candidates) {
      if (members.some(item => item.id === candidate.id)) continue;
      if (members.length >= maxMembers || steps + candidate.route.length > maxSteps) break;
      members.push(candidate);
      steps += candidate.route.length;
      variants.push({
        members: [...members],
        potential: members.reduce((sum, item) => sum + opportunityPotential(item), 0n),
      });
    }
  }

  const unique = new Map<string, { members: ZeroCapitalOpportunity[]; potential: bigint }>();
  for (const variant of variants) {
    const key = variant.members.map(item => item.id).sort().join('|');
    const current = unique.get(key);
    if (!current || variant.potential > current.potential) unique.set(key, variant);
  }
  return [...unique.values()]
    .sort((left, right) => left.potential === right.potential ? 0 : left.potential > right.potential ? -1 : 1)
    .slice(0, Math.max(1, Math.min(8, Math.trunc(maxVariants))))
    .map(item => item.members);
}

export function getApeHypergraphSnapshot() {
  return {
    routeOutcomeKeys: routeOutcomes.size,
    routeFrontierKeys: routeFrontierCursor.size,
    splitRatioFrontierKeys: splitRatioCursor.size,
    deadlineAuthorityKeys: lateResultGenerations.size,
    deterministicGrossSignRouting: true as const,
    persistentAlternativeFrontier: true as const,
    nonPrefixCompositeSearch: true as const,
    hotPathExternalIo: false as const,
    executionAuthority: false as const,
    economicAuthority: false as const,
  };
}
