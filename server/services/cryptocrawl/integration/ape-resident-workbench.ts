import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import {
  peekResidentBestBpsQuote,
  type ConfiguredRouteLeg,
  type ConfiguredZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';

export type ApeWorkerKind = 'route_split' | 'v4_cost_rescue' | 'shared_principal_stack' | 'execution_ready';

export interface ApeResidentRoutePair {
  left: ConfiguredZeroCapitalRoute;
  right: ConfiguredZeroCapitalRoute;
}

export interface ApeResidentPeerHint {
  opportunityId: string;
  suggestedWorker: ApeWorkerKind;
  preferredRouteId: string | null;
  measuredNetBps: number | null;
  observedAt: number;
  expiresAt: number;
}

export interface ApeResidentWorkAssignment {
  opportunityId: string;
  generation: string;
  structuralKey: string;
  routes: readonly ConfiguredZeroCapitalRoute[];
  splitPairs: readonly ApeResidentRoutePair[];
  primaryWorker: ApeWorkerKind;
  fallbackWorkers: readonly ApeWorkerKind[];
  peerHint: ApeResidentPeerHint | null;
  observedAt: number;
  expiresAt: number;
}

type StructuralIndex = {
  signature: string;
  routesByKey: Map<string, ConfiguredZeroCapitalRoute[]>;
};

const assignments = new Map<string, ApeResidentWorkAssignment>();
const peerHints = new Map<string, ApeResidentPeerHint>();
let structuralIndex: StructuralIndex = { signature: '', routesByKey: new Map() };
let primes = 0;
let candidatesPrimed = 0;
let structuralIndexBuilds = 0;
let peerHintUpdates = 0;
let peerHintAssignmentRefreshes = 0;
const MAX_ASSIGNMENTS = 4096;
const MAX_HINTS = 4096;

function generationOf(opportunity: ZeroCapitalOpportunity): string {
  return `${opportunity.id}:${opportunity.timestamp}:${opportunity.expiresAt}`;
}

function structuralKey(input: {
  chain: string;
  inputAssetSymbol: string;
  inputToken: string;
  inputTokenDecimals: number;
}): string {
  return [
    input.chain,
    input.inputAssetSymbol,
    input.inputToken.toLowerCase(),
    input.inputTokenDecimals,
  ].join('|');
}

function routeSignature(routes: readonly ConfiguredZeroCapitalRoute[]): string {
  return routes.map(route => [
    route.id,
    route.chain,
    route.inputAssetSymbol,
    route.inputToken.toLowerCase(),
    route.inputTokenDecimals,
    route.legs.map(leg => [
      leg.protocol,
      leg.tokenIn.toLowerCase(),
      leg.tokenOut.toLowerCase(),
      leg.pool?.toLowerCase() ?? '',
      leg.feeTier ?? '',
      leg.fee ?? '',
    ].join(':')).join('>'),
  ].join('#')).join('||');
}

function ensureStructuralIndex(routes: readonly ConfiguredZeroCapitalRoute[]): void {
  const signature = routeSignature(routes);
  if (signature === structuralIndex.signature) return;
  const routesByKey = new Map<string, ConfiguredZeroCapitalRoute[]>();
  for (const route of routes) {
    const key = structuralKey(route);
    const bucket = routesByKey.get(key);
    if (bucket) bucket.push(route);
    else routesByKey.set(key, [route]);
  }
  structuralIndex = { signature, routesByKey };
  structuralIndexBuilds += 1;
}

function feeTierFromDecimal(protocol: string, fee: number): 100 | 500 | 3000 | 10000 | undefined {
  const normalized = protocol.trim().toLowerCase();
  if (normalized !== 'uniswapv3' && normalized !== 'uniswap_v3' && normalized !== 'uniswap-v3'
    && normalized !== 'sushiswapv3' && normalized !== 'sushiswap_v3' && normalized !== 'sushi-v3') return undefined;
  if (!Number.isFinite(fee) || fee < 0) return undefined;
  if (fee <= 0.0001) return 100;
  if (fee <= 0.0005) return 500;
  if (fee <= 0.003) return 3000;
  return 10000;
}

function routeFromArrivedOpportunity(opportunity: ZeroCapitalOpportunity): ConfiguredZeroCapitalRoute | null {
  if (opportunity.route.length < 2 || opportunity.flashLoanAmount <= 0n) return null;
  const legs: ConfiguredRouteLeg[] = opportunity.route.map(step => {
    const feeTier = feeTierFromDecimal(step.protocol, step.fee);
    return {
      protocol: step.protocol as ConfiguredRouteLeg['protocol'],
      tokenIn: step.tokenIn,
      tokenOut: step.tokenOut,
      fee: step.fee,
      ...(feeTier !== undefined ? { feeTier } : {}),
    };
  });
  return {
    id: `ape-arrived:${opportunity.id}`,
    chain: opportunity.chain,
    inputAssetSymbol: opportunity.inputAssetSymbol,
    inputToken: opportunity.inputToken,
    inputTokenDecimals: opportunity.inputTokenDecimals,
    amountIn: opportunity.flashLoanAmount.toString(),
    estimatedGasCostInInputToken: (opportunity.estimatedGasCostInInputToken ?? 0n).toString(),
    relayFeeInInputToken: (opportunity.relayFeeInInputToken ?? 0n).toString(),
    flashLoanFeeBps: 0,
    legs,
  };
}

function configuredRouteMatchesOpportunity(route: ConfiguredZeroCapitalRoute, opportunity: ZeroCapitalOpportunity): boolean {
  return opportunity.id === route.id || opportunity.id.startsWith(`${route.id}-`);
}

function legPoolIdentity(leg: ConfiguredRouteLeg): string {
  if (leg.pool?.trim()) return `pool:${leg.pool.toLowerCase()}`;
  const tokenPair = [leg.tokenIn.toLowerCase(), leg.tokenOut.toLowerCase()].sort().join(':');
  const feeIdentity = leg.feeTier !== undefined
    ? `tier:${leg.feeTier}`
    : leg.fee !== undefined
      ? `fee:${leg.fee}`
      : 'fee:unknown';
  return `${leg.protocol}:${tokenPair}:${feeIdentity}`;
}

function routesArePoolDisjoint(left: ConfiguredZeroCapitalRoute, right: ConfiguredZeroCapitalRoute): boolean {
  const leftPools = new Set(left.legs.map(legPoolIdentity));
  return right.legs.every(leg => !leftPools.has(legPoolIdentity(leg)));
}

function residentRouteScore(route: ConfiguredZeroCapitalRoute): number {
  const quote = peekResidentBestBpsQuote(route.id);
  return quote && Number.isFinite(quote.grossProfitBps) ? quote.grossProfitBps : Number.NEGATIVE_INFINITY;
}

function routeOrder(left: ConfiguredZeroCapitalRoute, right: ConfiguredZeroCapitalRoute): number {
  const scoreDelta = residentRouteScore(right) - residentRouteScore(left);
  if (Number.isFinite(scoreDelta) && scoreDelta !== 0) return scoreDelta;
  return left.id.localeCompare(right.id);
}

function allSafeSplitPairs(routes: readonly ConfiguredZeroCapitalRoute[]): ApeResidentRoutePair[] {
  const pairs: ApeResidentRoutePair[] = [];
  for (let leftIndex = 0; leftIndex < routes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < routes.length; rightIndex += 1) {
      const left = routes[leftIndex];
      const right = routes[rightIndex];
      if (left.id === right.id || !routesArePoolDisjoint(left, right)) continue;
      pairs.push({ left, right });
    }
  }
  pairs.sort((a, b) => {
    const scoreA = residentRouteScore(a.left) + residentRouteScore(a.right);
    const scoreB = residentRouteScore(b.left) + residentRouteScore(b.right);
    if (scoreA !== scoreB) return scoreB - scoreA;
    return `${a.left.id}:${a.right.id}`.localeCompare(`${b.left.id}:${b.right.id}`);
  });
  return pairs;
}

function grossProfitBaseUnits(opportunity: ZeroCapitalOpportunity): bigint {
  return opportunity.grossProfit
    ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
}

function primaryWorkerFor(opportunity: ZeroCapitalOpportunity): ApeWorkerKind {
  if (opportunity.expectedProfit > 0n) return 'execution_ready';
  return grossProfitBaseUnits(opportunity) > 0n ? 'v4_cost_rescue' : 'route_split';
}

function fallbackWorkersFor(opportunity: ZeroCapitalOpportunity): ApeWorkerKind[] {
  if (opportunity.expectedProfit > 0n) return [];
  if (grossProfitBaseUnits(opportunity) > 0n) return ['shared_principal_stack', 'route_split'];
  return [];
}

function preferredRouteId(candidate: MeasuredCandidate): string | null {
  for (let index = candidate.provenance.length - 1; index >= 0; index -= 1) {
    const value = candidate.provenance[index];
    if (value.startsWith('configured_route:')) return value.slice('configured_route:'.length).trim() || null;
    if (value.startsWith('ape_route_split_route:')) return value.slice('ape_route_split_route:'.length).trim() || null;
  }
  return null;
}

function peerSuggestedWorker(candidate: MeasuredCandidate): ApeWorkerKind {
  if (candidate.status === 'eligible' && candidate.executableCapability && (candidate.canonicalBps.netBps ?? 0) > 0) {
    return 'execution_ready';
  }
  const gross = candidate.canonicalBps.grossBps;
  return gross !== null && Number.isFinite(gross) && gross > 0 ? 'v4_cost_rescue' : 'route_split';
}

function observePeerHint(candidate: MeasuredCandidate): void {
  if (candidate.topology !== 'ZERO_CAPITAL_ATOMIC' || candidate.expiresAt <= Date.now()) return;
  const hint: ApeResidentPeerHint = {
    opportunityId: candidate.opportunityId,
    suggestedWorker: peerSuggestedWorker(candidate),
    preferredRouteId: preferredRouteId(candidate),
    measuredNetBps: candidate.canonicalBps.netBps,
    observedAt: candidate.updatedAt,
    expiresAt: candidate.expiresAt,
  };
  const previous = peerHints.get(candidate.opportunityId);
  if (previous && previous.observedAt > hint.observedAt) return;
  peerHints.set(candidate.opportunityId, hint);
  peerHintUpdates += 1;

  const assignment = assignments.get(candidate.opportunityId);
  if (assignment && assignment.expiresAt > Date.now()) {
    assignments.set(candidate.opportunityId, { ...assignment, peerHint: hint });
    peerHintAssignmentRefreshes += 1;
  }
  prune();
}

measuredCandidateRegistry.onUpdate(observePeerHint);

function prune(now = Date.now()): void {
  for (const [id, assignment] of assignments) if (assignment.expiresAt <= now) assignments.delete(id);
  for (const [id, hint] of peerHints) if (hint.expiresAt <= now) peerHints.delete(id);
  while (assignments.size > MAX_ASSIGNMENTS) {
    const key = assignments.keys().next().value as string | undefined;
    if (!key) break;
    assignments.delete(key);
  }
  while (peerHints.size > MAX_HINTS) {
    const key = peerHints.keys().next().value as string | undefined;
    if (!key) break;
    peerHints.delete(key);
  }
}

/**
 * Prepares worker-visible structural state once per fused APE pass. There is no
 * network, database, model, queue or scheduler handoff here. Route alternatives
 * are indexed once and safe split pairs are materialized before the split worker
 * starts, so that worker never performs the old filter-then-slice route search.
 * The already-arrived Stage-1 route is represented as another alternative when it
 * is not already present in configured inventory; this widens visibility without
 * changing Stage 1 or granting execution authority.
 */
export function primeApeResidentWorkbench(input: {
  opportunities: readonly ZeroCapitalOpportunity[];
  configuredRoutes: readonly ConfiguredZeroCapitalRoute[];
}): void {
  primes += 1;
  candidatesPrimed += input.opportunities.length;
  ensureStructuralIndex(input.configuredRoutes);
  prune();

  for (const opportunity of input.opportunities) {
    const key = structuralKey(opportunity);
    const configured = structuralIndex.routesByKey.get(key) ?? [];
    const hasArrivedRoute = configured.some(route => configuredRouteMatchesOpportunity(route, opportunity));
    const arrived = hasArrivedRoute ? null : routeFromArrivedOpportunity(opportunity);
    const routes = [...configured, ...(arrived ? [arrived] : [])].sort(routeOrder);
    assignments.set(opportunity.id, {
      opportunityId: opportunity.id,
      generation: generationOf(opportunity),
      structuralKey: key,
      routes,
      splitPairs: allSafeSplitPairs(routes),
      primaryWorker: primaryWorkerFor(opportunity),
      fallbackWorkers: fallbackWorkersFor(opportunity),
      peerHint: peerHints.get(opportunity.id) ?? null,
      observedAt: opportunity.timestamp,
      expiresAt: opportunity.expiresAt,
    });
  }
}

/** Single resident read used by live workers. No fallback scan or I/O occurs. */
export function getApeResidentWorkAssignment(
  opportunity: ZeroCapitalOpportunity,
  now = Date.now(),
): ApeResidentWorkAssignment | null {
  const assignment = assignments.get(opportunity.id);
  if (!assignment || assignment.expiresAt <= now || assignment.generation !== generationOf(opportunity)) return null;
  return assignment;
}

export function getApeResidentWorkbenchSnapshot() {
  prune();
  return {
    observedAt: Date.now(),
    assignments: assignments.size,
    peerHints: peerHints.size,
    structuralKeys: structuralIndex.routesByKey.size,
    structuralIndexBuilds,
    primes,
    candidatesPrimed,
    peerHintUpdates,
    peerHintAssignmentRefreshes,
    liveWorkerReadMode: 'single_resident_assignment_lookup' as const,
    configuredRouteFilteringOnSplitWorkerPath: false as const,
    candidatePresliceBeforeSplittability: false as const,
    peerHintTransport: 'piggybacked_resident_candidate_state' as const,
    peerHintQueue: false as const,
    peerHintPolling: false as const,
    peerHintAcknowledgement: false as const,
    externalIo: false as const,
    executionAuthority: false as const,
    economicAuthority: false as const,
  };
}
