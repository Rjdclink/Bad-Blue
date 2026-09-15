import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import type {
  ConfiguredRouteLeg,
  ConfiguredZeroCapitalRoute,
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
  routesByKey: Map<string, readonly ConfiguredZeroCapitalRoute[]>;
  splitPairsByKey: Map<string, readonly ApeResidentRoutePair[]>;
};

const assignments = new Map<string, ApeResidentWorkAssignment>();
const peerHints = new Map<string, ApeResidentPeerHint>();
let structuralIndex: StructuralIndex = { routesByKey: new Map(), splitPairsByKey: new Map() };
let structuralInventoryIdentity: readonly ConfiguredZeroCapitalRoute[] | null = null;
let primes = 0;
let candidatesPrimed = 0;
let structuralIndexBuilds = 0;
let peerHintUpdates = 0;
let peerHintAssignmentRefreshes = 0;
let arrivedRouteAugmentations = 0;
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
  return pairs;
}

/**
 * Build the stable topology once for a configured-route inventory object. The
 * fused APE path normally receives the same immutable inventory reference, so
 * subsequent passes are an identity check rather than a route scan/signature
 * calculation. A genuinely replaced inventory is rebuilt once and then reused.
 */
function ensureStructuralIndex(routes: readonly ConfiguredZeroCapitalRoute[]): void {
  if (structuralInventoryIdentity === routes) return;
  const mutableRoutes = new Map<string, ConfiguredZeroCapitalRoute[]>();
  for (const route of routes) {
    const key = structuralKey(route);
    const bucket = mutableRoutes.get(key);
    if (bucket) bucket.push(route);
    else mutableRoutes.set(key, [route]);
  }

  const routesByKey = new Map<string, readonly ConfiguredZeroCapitalRoute[]>();
  const splitPairsByKey = new Map<string, readonly ApeResidentRoutePair[]>();
  for (const [key, bucket] of mutableRoutes) {
    const residentRoutes = Object.freeze([...bucket]);
    routesByKey.set(key, residentRoutes);
    splitPairsByKey.set(key, Object.freeze(allSafeSplitPairs(residentRoutes)));
  }

  structuralIndex = { routesByKey, splitPairsByKey };
  structuralInventoryIdentity = routes;
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
      ...(step.pool ? { pool: step.pool } : {}),
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
  if (opportunity.id === route.id || opportunity.id.startsWith(`${route.id}-`)) return true;
  if (route.legs.length !== opportunity.route.length) return false;
  return route.legs.every((leg, index) => {
    const step = opportunity.route[index];
    return Boolean(step)
      && leg.protocol === step.protocol
      && leg.tokenIn.toLowerCase() === step.tokenIn.toLowerCase()
      && leg.tokenOut.toLowerCase() === step.tokenOut.toLowerCase()
      && (!leg.pool || !step.pool || leg.pool.toLowerCase() === step.pool.toLowerCase());
  });
}

function alignRouteCostBasis(
  route: ConfiguredZeroCapitalRoute,
  opportunity: ZeroCapitalOpportunity,
): ConfiguredZeroCapitalRoute {
  const gas = opportunity.estimatedGasCostInInputToken?.toString();
  const relay = opportunity.relayFeeInInputToken?.toString();
  if (gas === undefined && relay === undefined) return route;
  return {
    ...route,
    ...(gas !== undefined ? { estimatedGasCostInInputToken: gas } : {}),
    ...(relay !== undefined ? { relayFeeInInputToken: relay } : {}),
  };
}

function assignmentTopology(opportunity: ZeroCapitalOpportunity): {
  routes: readonly ConfiguredZeroCapitalRoute[];
  splitPairs: readonly ApeResidentRoutePair[];
} {
  const key = structuralKey(opportunity);
  const configuredRoutes = structuralIndex.routesByKey.get(key) ?? [];
  const configuredPairs = structuralIndex.splitPairsByKey.get(key) ?? [];
  const existingRoute = configuredRoutes.find(route => configuredRouteMatchesOpportunity(route, opportunity));
  const arrived = existingRoute ? null : routeFromArrivedOpportunity(opportunity);

  // The common path is zero-allocation structural reuse. Stage-1's already-arrived
  // route is only materialized when configured inventory truly does not represent
  // it; this replaces the old Splitter-side filtering/search instead of adding to it.
  if (!arrived) {
    return {
      routes: configuredRoutes,
      splitPairs: configuredPairs,
    };
  }

  arrivedRouteAugmentations += 1;
  const alignedConfigured = configuredRoutes.map(route => alignRouteCostBasis(route, opportunity));
  const routes = Object.freeze([...alignedConfigured, arrived]);
  const additionalPairs: ApeResidentRoutePair[] = [];
  for (const route of alignedConfigured) {
    if (routesArePoolDisjoint(route, arrived)) additionalPairs.push({ left: route, right: arrived });
  }
  return {
    routes,
    splitPairs: Object.freeze([...configuredPairs, ...additionalPairs]),
  };
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
 * Piggybacked peer hints are written only when candidate state is already being
 * published. There is no peer message, mailbox, queue, polling, acknowledgement,
 * RPC, database lookup, model call or lock on the owner-worker path.
 */
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

/**
 * Replaces the old Splitter-side route filtering/pair discovery. Stable route
 * topology is shared across all candidates and all fresh candidates receive an
 * assignment before workers start. No network/database/model I/O occurs here and
 * Stage-1 opportunity objects are never mutated.
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
    const topology = assignmentTopology(opportunity);
    assignments.set(opportunity.id, {
      opportunityId: opportunity.id,
      generation: generationOf(opportunity),
      structuralKey: structuralKey(opportunity),
      routes: topology.routes,
      splitPairs: topology.splitPairs,
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
    arrivedRouteAugmentations,
    liveWorkerReadMode: 'single_resident_assignment_lookup' as const,
    stableTopologyRebuildTrigger: 'configured_route_inventory_identity_change_only' as const,
    configuredRouteFilteringOnSplitWorkerPath: false as const,
    candidatePresliceBeforeSplittability: false as const,
    peerHintTransport: 'piggybacked_resident_candidate_state' as const,
    peerHintQueue: false as const,
    peerHintPolling: false as const,
    peerHintAcknowledgement: false as const,
    externalIo: false as const,
    persistence: false as const,
    executionAuthority: false as const,
    economicAuthority: false as const,
  };
}
