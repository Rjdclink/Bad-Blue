export interface AllInRouteCostEvidence {
  routeId: string;
  topology: string;
  sourceChain: string;
  destinationChain: string;
  asset: string;
  notionalUsd: number;
  gasAndPriorityFeeUsd: number;
  bridgeFeeUsd: number;
  bridgeTimeMs: number;
  finalityRiskReserveUsd: number;
  reorgRiskReserveUsd: number;
  liquiditySlippageUsd: number;
  priceImpactUsd: number;
  assetEquivalenceRiskReserveUsd: number;
  protocolFeeUsd: number;
  flashLoanFeeUsd: number;
  relayOrSponsorshipFeeUsd: number;
  opportunityDecayUsd: number;
  settlementFailureRiskReserveUsd: number;
  settlementReliability: number;
  observedAt: number;
  expiresAt: number;
  provenance: string[];
  atomicBatching?: {
    supported: boolean;
    failureIsolationProven: boolean;
    batchedCostUsd: number | null;
    unbatchedCostUsd: number | null;
  };
}

export interface AllInRouteDecision extends AllInRouteCostEvidence {
  totalExpectedCostUsd: number;
  riskReserveUsd: number;
  expectedCostBps: number;
  batchRecommended: boolean;
  executableEvidence: true;
  gasIsFreeByAssertion: false;
  flashLoanEliminatesGas: false;
}

const evidence = new Map<string, AllInRouteCostEvidence>();
const MAX_ROUTES = Math.max(32, Math.min(4096, Number(process.env.CRYPTO_ROUTE_COST_EVIDENCE_LIMIT || 512)));

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function probability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
function validate(input: AllInRouteCostEvidence): void {
  if (!input.routeId.trim() || !input.topology.trim() || !input.sourceChain.trim() || !input.destinationChain.trim() || !input.asset.trim()) {
    throw new Error('All-in route evidence requires stable route/topology/chain/asset identity');
  }
  for (const [key, value] of Object.entries({
    notionalUsd: input.notionalUsd,
    gasAndPriorityFeeUsd: input.gasAndPriorityFeeUsd,
    bridgeFeeUsd: input.bridgeFeeUsd,
    bridgeTimeMs: input.bridgeTimeMs,
    finalityRiskReserveUsd: input.finalityRiskReserveUsd,
    reorgRiskReserveUsd: input.reorgRiskReserveUsd,
    liquiditySlippageUsd: input.liquiditySlippageUsd,
    priceImpactUsd: input.priceImpactUsd,
    assetEquivalenceRiskReserveUsd: input.assetEquivalenceRiskReserveUsd,
    protocolFeeUsd: input.protocolFeeUsd,
    flashLoanFeeUsd: input.flashLoanFeeUsd,
    relayOrSponsorshipFeeUsd: input.relayOrSponsorshipFeeUsd,
    opportunityDecayUsd: input.opportunityDecayUsd,
    settlementFailureRiskReserveUsd: input.settlementFailureRiskReserveUsd,
  })) {
    if (!finiteNonNegative(value)) throw new Error(`All-in route evidence requires finite non-negative ${key}`);
  }
  if (!(input.notionalUsd > 0)) throw new Error('All-in route evidence requires positive notional');
  if (!probability(input.settlementReliability)) throw new Error('Settlement reliability must be measured in [0,1]');
  if (!Number.isFinite(input.observedAt) || !Number.isFinite(input.expiresAt) || input.observedAt <= 0 || input.expiresAt <= input.observedAt) {
    throw new Error('All-in route evidence requires bounded freshness');
  }
  if (input.atomicBatching) {
    const batch = input.atomicBatching;
    if (batch.batchedCostUsd !== null && !finiteNonNegative(batch.batchedCostUsd)) throw new Error('Batched cost must be finite/non-negative');
    if (batch.unbatchedCostUsd !== null && !finiteNonNegative(batch.unbatchedCostUsd)) throw new Error('Unbatched cost must be finite/non-negative');
  }
}

export function recordAllInRouteCostEvidence(input: AllInRouteCostEvidence): void {
  validate(input);
  evidence.set(input.routeId, {
    ...input,
    provenance: [...new Set([...input.provenance, 'measured_all_in_route_cost'])],
    atomicBatching: input.atomicBatching ? { ...input.atomicBatching } : undefined,
  });
  if (evidence.size > MAX_ROUTES) {
    const oldest = [...evidence.values()].sort((a, b) => a.observedAt - b.observedAt)[0];
    if (oldest) evidence.delete(oldest.routeId);
  }
}

function decision(input: AllInRouteCostEvidence): AllInRouteDecision {
  const riskReserveUsd = input.finalityRiskReserveUsd
    + input.reorgRiskReserveUsd
    + input.assetEquivalenceRiskReserveUsd
    + input.settlementFailureRiskReserveUsd;
  const directCostUsd = input.gasAndPriorityFeeUsd
    + input.bridgeFeeUsd
    + input.liquiditySlippageUsd
    + input.priceImpactUsd
    + input.protocolFeeUsd
    + input.flashLoanFeeUsd
    + input.relayOrSponsorshipFeeUsd
    + input.opportunityDecayUsd;
  const reliabilityReserveUsd = (1 - input.settlementReliability) * input.notionalUsd;
  const totalExpectedCostUsd = directCostUsd + riskReserveUsd + reliabilityReserveUsd;
  const batch = input.atomicBatching;
  const batchRecommended = Boolean(
    batch?.supported && batch.failureIsolationProven && batch.batchedCostUsd !== null && batch.unbatchedCostUsd !== null
    && batch.batchedCostUsd < batch.unbatchedCostUsd,
  );
  return {
    ...input,
    provenance: [...input.provenance],
    atomicBatching: batch ? { ...batch } : undefined,
    totalExpectedCostUsd,
    riskReserveUsd: riskReserveUsd + reliabilityReserveUsd,
    expectedCostBps: totalExpectedCostUsd / input.notionalUsd * 10_000,
    batchRecommended,
    executableEvidence: true,
    gasIsFreeByAssertion: false,
    flashLoanEliminatesGas: false,
  };
}

export function chooseLowestAllInCostRoute(input: {
  topology: string;
  sourceChain: string;
  destinationChain: string;
  asset: string;
  notionalUsd: number;
  now?: number;
}): AllInRouteDecision | null {
  const now = input.now ?? Date.now();
  const candidates = [...evidence.values()].filter(route =>
    route.topology === input.topology
    && route.sourceChain === input.sourceChain
    && route.destinationChain === input.destinationChain
    && route.asset.toUpperCase() === input.asset.toUpperCase()
    && Math.abs(route.notionalUsd - input.notionalUsd) / Math.max(1, input.notionalUsd) <= 0.25
    && route.expiresAt > now,
  );
  if (candidates.length === 0) return null;
  return candidates.map(decision).sort((a, b) => a.totalExpectedCostUsd - b.totalExpectedCostUsd || b.settlementReliability - a.settlementReliability)[0];
}

export function getAllInRouteCostOptimizerHealth() {
  const now = Date.now();
  return {
    measuredRoutes: [...evidence.values()].filter(route => route.expiresAt > now).length,
    maxRoutes: MAX_ROUTES,
    staticBridgeAverageAuthoritative: false as const,
    sponsoredGasCountedAsMeasuredCost: true as const,
    flashLoanMakesGasFree: false as const,
    batchRequiresAtomicFailureIsolation: true as const,
    executionAuthority: false as const,
  };
}
