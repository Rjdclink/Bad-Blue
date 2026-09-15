import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
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
  measuredNetBps: number;
  observedAt: number;
  expiresAt: number;
}

export interface ApeResidentWorkAssignment {
  opportunityId: string;
  generation: string;
  routes: readonly ConfiguredZeroCapitalRoute[];
  splitPairs: readonly ApeResidentRoutePair[];
  primaryWorker: ApeWorkerKind;
  fallbackWorkers: readonly ApeWorkerKind[];
  peerHint: ApeResidentPeerHint | null;
  expiresAt: number;
}

type StructuralIndex = {
  routesByKey: Map<string, readonly ConfiguredZeroCapitalRoute[]>;
  splitPairsByKey: Map<string, readonly ApeResidentRoutePair[]>;
};

const assignments = new Map<string, ApeResidentWorkAssignment>();
const peerHints = new Map<string, ApeResidentPeerHint>();
let structuralInventoryIdentity: readonly ConfiguredZeroCapitalRoute[] | null = null;
let structuralIndex: StructuralIndex = { routesByKey: new Map(), splitPairsByKey: new Map() };
let structuralIndexBuilds = 0;
let assignmentPrimes = 0;
let dynamicArrivedRoutesAdded = 0;
let peerHintsPublished = 0;
const MAX_RESIDENT_ENTRIES = 4096;

function generationOf(opportunity: ZeroCapitalOpportunity): string {
  return `${opportunity.id}:${opportunity.timestamp}:${opportunity.expiresAt}`;
}

function structuralKey(input: {
  chain: string;
  inputAssetSymbol: string;
  inputToken: string;
  inputTokenDecimals: number;
}): string {
  return [input.chain, input.inputAssetSymbol, input.inputToken.toLowerCase(), input.inputTokenDecimals].join('|');
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

function safeSplitPairs(routes: readonly ConfiguredZeroCapitalRoute[]): ApeResidentRoutePair[] {
  const output: ApeResidentRoutePair[] = [];
  for (let leftIndex = 0; leftIndex < routes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < routes.length; rightIndex += 1) {
      const left = routes[leftIndex];
      const right = routes[rightIndex];
      if (left.id === right.id || !routesArePoolDisjoint(left, right)) continue;
      output.push({ left, right });
    }
  }
  return output;
}

function ensureStructuralIndex(routes: readonly ConfiguredZeroCapitalRoute[]): void {
  if (structuralInventoryIdentity === routes) return;
  const mutable = new Map<string, ConfiguredZeroCapitalRoute[]>();
  for (const route of routes) {
    const key = structuralKey(route);
    const bucket = mutable.get(key);
    if (bucket) bucket.push(route);
    else mutable.set(key, [route]);
  }

  const routesByKey = new Map<string, readonly ConfiguredZeroCapitalRoute[]>();
  const splitPairsByKey = new Map<string, readonly ApeResidentRoutePair[]>();
  for (const [key, bucket] of mutable) {
    const residentRoutes = Object.freeze([...bucket]);
    routesByKey.set(key, residentRoutes);
    splitPairsByKey.set(key, Object.freeze(safeSplitPairs(residentRoutes)));
  }
  structuralIndex = { routesByKey, splitPairsByKey };
  structuralInventoryIdentity = routes;
  structuralIndexBuilds += 1;
}

function feeTierFromDecimal(protocol: string, fee: number): 100 | 500 | 3000 | 10000 | undefined {
  const normalized = protocol.trim().toLowerCase();
  const isV3 = normalized === 'uniswapv3' || normalized === 'uniswap_v3' || normalized === 'uniswap-v3'
    || normalized === 'sushiswapv3' || normalized === 'sushiswap_v3' || normalized === 'sushi-v3';
  if (!isV3 || !Number.isFinite(fee) || fee < 0) return undefined;
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

function sameRouteShape(route: ConfiguredZeroCapitalRoute, opportunity: ZeroCapitalOpportunity): boolean {
  if (route.legs.length !== opportunity.route.length) return false;
  return route.legs.every((leg, index) => {
    const step = opportunity.route[index];
    if (!step
      || leg.protocol.toLowerCase() !== step.protocol.toLowerCase()
      || leg.tokenIn.toLowerCase() !== step.tokenIn.toLowerCase()
      || leg.tokenOut.toLowerCase() !== step.tokenOut.toLowerCase()) return false;
    if (leg.fee !== undefined && Math.abs(leg.fee - step.fee) >= Number.EPSILON) return false;
    if (leg.feeTier !== undefined && feeTierFromDecimal(step.protocol, step.fee) !== leg.feeTier) return false;
    return true;
  });
}

function grossProfit(opportunity: ZeroCapitalOpportunity): bigint {
  return opportunity.grossProfit ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
}

function primaryWorker(opportunity: ZeroCapitalOpportunity): ApeWorkerKind {
  if (opportunity.expectedProfit > 0n) return 'execution_ready';
  return grossProfit(opportunity) > 0n ? 'v4_cost_rescue' : 'route_split';
}

function fallbackWorkers(opportunity: ZeroCapitalOpportunity): readonly ApeWorkerKind[] {
  if (opportunity.expectedProfit > 0n) return [];
  return grossProfit(opportunity) > 0n
    ? ['shared_principal_stack', 'route_split']
    : ['route_split'];
}

function prune(now = Date.now()): void {
  for (const [id, assignment] of assignments) if (assignment.expiresAt <= now) assignments.delete(id);
  for (const [id, hint] of peerHints) if (hint.expiresAt <= now) peerHints.delete(id);
  while (assignments.size > MAX_RESIDENT_ENTRIES) {
    const key = assignments.keys().next().value as string | undefined;
    if (!key) break;
    assignments.delete(key);
  }
  while (peerHints.size > MAX_RESIDENT_ENTRIES) {
    const key = peerHints.keys().next().value as string | undefined;
    if (!key) break;
    peerHints.delete(key);
  }
}

/**
 * Replaces Splitter-side configured-route indexing/pair discovery. Stable topology
 * is built once per immutable configured-route inventory. Candidate-time work is
 * only resident map access plus representation of a Stage-1 route that is absent
 * from configured inventory. No network, database, model, queue or scheduler I/O.
 */
export function primeApeResidentWorkbench(input: {
  opportunities: readonly ZeroCapitalOpportunity[];
  configuredRoutes: readonly ConfiguredZeroCapitalRoute[];
}): void {
  ensureStructuralIndex(input.configuredRoutes);
  prune();
  assignmentPrimes += 1;

  for (const opportunity of input.opportunities) {
    const key = structuralKey(opportunity);
    const configuredRoutes = structuralIndex.routesByKey.get(key) ?? [];
    const configuredPairs = structuralIndex.splitPairsByKey.get(key) ?? [];
    const arrivedAlreadyRepresented = configuredRoutes.some(route => sameRouteShape(route, opportunity));
    const arrived = arrivedAlreadyRepresented ? null : routeFromArrivedOpportunity(opportunity);
    const routes = arrived ? Object.freeze([...configuredRoutes, arrived]) : configuredRoutes;
    const additionalPairs = arrived
      ? configuredRoutes.filter(route => routesArePoolDisjoint(route, arrived)).map(route => ({ left: route, right: arrived }))
      : [];
    if (arrived) dynamicArrivedRoutesAdded += 1;

    assignments.set(opportunity.id, {
      opportunityId: opportunity.id,
      generation: generationOf(opportunity),
      routes,
      splitPairs: additionalPairs.length > 0
        ? Object.freeze([...configuredPairs, ...additionalPairs])
        : configuredPairs,
      primaryWorker: primaryWorker(opportunity),
      fallbackWorkers: fallbackWorkers(opportunity),
      peerHint: peerHints.get(opportunity.id) ?? null,
      expiresAt: opportunity.expiresAt,
    });
  }
}

export function getApeResidentWorkAssignment(
  opportunity: ZeroCapitalOpportunity,
  now = Date.now(),
): ApeResidentWorkAssignment | null {
  const assignment = assignments.get(opportunity.id);
  if (!assignment || assignment.expiresAt <= now || assignment.generation !== generationOf(opportunity)) return null;
  return assignment;
}

/**
 * Piggyback a hint only when a worker is already publishing a useful improvement.
 * It creates no independent message, event, acknowledgement, poll, lock or I/O.
 */
export function publishApeResidentPeerHint(
  opportunity: ZeroCapitalOpportunity,
  preferredRouteId: string | null = null,
): void {
  if (opportunity.expiresAt <= Date.now()) return;
  const hint: ApeResidentPeerHint = {
    opportunityId: opportunity.id,
    suggestedWorker: primaryWorker(opportunity),
    preferredRouteId,
    measuredNetBps: opportunity.netProfitBps,
    observedAt: opportunity.timestamp,
    expiresAt: opportunity.expiresAt,
  };
  peerHints.set(opportunity.id, hint);
  peerHintsPublished += 1;
  const assignment = assignments.get(opportunity.id);
  if (assignment && assignment.generation === generationOf(opportunity)) {
    assignments.set(opportunity.id, { ...assignment, peerHint: hint });
  }
}

export function getApeResidentWorkbenchSnapshot() {
  prune();
  return {
    assignments: assignments.size,
    peerHints: peerHints.size,
    structuralKeys: structuralIndex.routesByKey.size,
    structuralIndexBuilds,
    assignmentPrimes,
    dynamicArrivedRoutesAdded,
    peerHintsPublished,
    candidatePresliceBeforeSplittability: false as const,
    configuredRouteFilteringOnSplitWorkerPath: false as const,
    liveWorkerReadMode: 'single_resident_assignment_lookup' as const,
    peerHintTransport: 'piggybacked_existing_worker_result' as const,
    peerHintQueue: false as const,
    peerHintPolling: false as const,
    peerHintAcknowledgement: false as const,
    externalIo: false as const,
    persistence: false as const,
    executionAuthority: false as const,
    economicAuthority: false as const,
  };
}
