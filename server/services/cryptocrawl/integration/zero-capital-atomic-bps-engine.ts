import logger from '../../../logger.js';
import type { providers } from 'ethers';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import {
  observeFlashLoanDemandHint,
  resetFlashLoanDemandHints,
} from '../execution/adapters/flash-loan-demand-hint.js';
import {
  peekResidentBestBpsQuote,
  type ConfiguredZeroCapitalRoute,
  type QuotedZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import {
  getApeResidentPlacement,
  hasApeResidentPlacement,
  orderApeResidentOpportunities,
  primeApeResidentRouting,
} from './atomic-profitability-resident-routing.js';

export interface ZeroCapitalAtomicBpsEngineInput {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  opportunities: readonly ZeroCapitalOpportunity[];
  configuredRoutes: readonly ConfiguredZeroCapitalRoute[];
  fromQuotedRoute: (quote: QuotedZeroCapitalRoute, blockTimestamp: number) => ZeroCapitalOpportunity;
}

const BPS_PRECISION_SCALE = 1_000_000n;

type ApeRescueMode = 'cost' | 'edge' | 'execution';

function exactNetBps(opportunity: ZeroCapitalOpportunity): number {
  if (opportunity.flashLoanAmount <= 0n) return Number.NEGATIVE_INFINITY;
  return Number(
    (opportunity.expectedProfit * 10_000n * BPS_PRECISION_SCALE) / opportunity.flashLoanAmount,
  ) / Number(BPS_PRECISION_SCALE);
}

function strictlyHigherExactBps(input: {
  candidateProfit: bigint;
  candidateAmount: bigint;
  incumbentProfit: bigint;
  incumbentAmount: bigint;
}): boolean {
  if (input.candidateAmount <= 0n || input.incumbentAmount <= 0n) return false;
  return input.candidateProfit * input.incumbentAmount
    > input.incumbentProfit * input.candidateAmount;
}

function grossProfit(opportunity: ZeroCapitalOpportunity): bigint {
  return opportunity.grossProfit
    ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
}

function rescueMode(opportunity: ZeroCapitalOpportunity): ApeRescueMode {
  if (opportunity.expectedProfit > 0n) return 'execution';
  return grossProfit(opportunity) > 0n ? 'cost' : 'edge';
}

/** Candidate ownership is independent from the freshness of its current evidence. */
function apeOwnedStageOneCandidate(opportunity: ZeroCapitalOpportunity): boolean {
  return opportunity.flashLoanAmount > 0n
    && Number.isFinite(opportunity.netProfitBps)
    && Number.isFinite(exactNetBps(opportunity));
}

function hasFreshEvidence(opportunity: ZeroCapitalOpportunity, now: number): boolean {
  return opportunity.expiresAt > now;
}

function routeForOpportunity(
  routes: readonly ConfiguredZeroCapitalRoute[],
  opportunity: ZeroCapitalOpportunity,
): ConfiguredZeroCapitalRoute | null {
  let best: ConfiguredZeroCapitalRoute | null = null;
  for (const route of routes) {
    if (route.chain !== opportunity.chain) continue;
    if (opportunity.id !== route.id && !opportunity.id.startsWith(`${route.id}-`)) continue;
    if (!best || route.id.length > best.id.length) best = route;
  }
  return best;
}

function originalBlockTimestamp(opportunity: ZeroCapitalOpportunity): number {
  const suffix = opportunity.id.match(/-(\d{8,})$/)?.[1];
  const parsed = Number(suffix);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Math.floor(opportunity.timestamp / 1_000);
}

/**
 * Consume only an already-resident better-BPS quote. A stale parent never gains a
 * fabricated lifetime here; downstream rescue refreshes evidence while preserving
 * the candidate identity/ownership.
 */
function residentBestBpsOverlay(
  input: ZeroCapitalAtomicBpsEngineInput,
  opportunity: ZeroCapitalOpportunity,
): ZeroCapitalOpportunity {
  const route = routeForOpportunity(input.configuredRoutes, opportunity);
  if (!route) return opportunity;
  const resident = peekResidentBestBpsQuote(route.id);
  if (!resident || resident.chain !== opportunity.chain) return opportunity;
  const currentBps = exactNetBps(opportunity);
  if (!Number.isFinite(resident.netProfitBps)) return opportunity;
  const exactBpsHigher = strictlyHigherExactBps({
    candidateProfit: resident.netProfit,
    candidateAmount: resident.amountIn,
    incumbentProfit: opportunity.expectedProfit,
    incumbentAmount: opportunity.flashLoanAmount,
  });
  if (resident.netProfitBps <= currentBps && !exactBpsHigher) return opportunity;
  if (!exactBpsHigher) return opportunity;

  const refined = input.fromQuotedRoute(resident, originalBlockTimestamp(opportunity));
  if (refined.id !== opportunity.id) return opportunity;
  refined.timestamp = opportunity.timestamp;
  refined.expiresAt = opportunity.expiresAt;
  if (refined.expiresAt <= Date.now()) return opportunity;
  if (opportunity.inputAssetUsdPrice !== undefined) refined.inputAssetUsdPrice = opportunity.inputAssetUsdPrice;
  return refined;
}

/**
 * Canonical Atomic Profitability Engine (APE), zero-copy latency-safe front end.
 * Negative BPS is APE work, not a rejection condition. Candidate ownership never
 * expires; only evidence freshness controls whether current proof can be reused.
 */
export function runZeroCapitalAtomicBpsEngine(
  input: ZeroCapitalAtomicBpsEngineInput,
): ZeroCapitalOpportunity[] {
  if (input.chain === 'europa' || input.opportunities.length === 0) {
    return input.opportunities.length === 0 ? [] : [...input.opportunities];
  }

  if (input.opportunities.some(opportunity => !hasApeResidentPlacement(opportunity.id))) {
    primeApeResidentRouting(input.opportunities);
  }

  const startedAt = Date.now();
  const startedAtNs = process.hrtime.bigint();
  const freshnessSnapshotAt = startedAt;
  const ordered = orderApeResidentOpportunities(input.opportunities);
  const owned = ordered.filter(apeOwnedStageOneCandidate);
  const freshEvidenceCandidates = owned.filter(opportunity => hasFreshEvidence(opportunity, freshnessSnapshotAt)).length;
  const staleEvidenceCandidates = owned.length - freshEvidenceCandidates;
  const fullOwnedCandidateCoverage = owned.length === input.opportunities.filter(apeOwnedStageOneCandidate).length;
  const refinedById = new Map<string, ZeroCapitalOpportunity>();
  resetFlashLoanDemandHints(input.chain as any);

  let costRescueCandidates = 0;
  let edgeRescueCandidates = 0;
  let executionRescueCandidates = 0;
  let strictPositiveAlreadyArrived = 0;
  let activeCandidates = 0;
  let hedgeCandidates = 0;
  let reserveCandidates = 0;
  let residentBestBpsSizeOverlays = 0;
  let bestAvailableStrictPositiveBps: number | null = null;
  let bestAvailableStrictPositiveId: string | null = null;

  for (const opportunity of owned) {
    const mode = rescueMode(opportunity);
    if (mode === 'cost') costRescueCandidates += 1;
    else if (mode === 'edge') edgeRescueCandidates += 1;
    else executionRescueCandidates += 1;

    const placement = getApeResidentPlacement(opportunity.id);
    if (placement?.role === 'active') activeCandidates += 1;
    else if (placement?.role === 'hedge') hedgeCandidates += 1;
    else if (placement?.role === 'reserve') reserveCandidates += 1;

    const refined = residentBestBpsOverlay(input, opportunity);
    if (refined !== opportunity) {
      residentBestBpsSizeOverlays += 1;
      refinedById.set(opportunity.id, refined);
    }
    const candidate = refined;

    // Demand hints describe currently usable evidence only. A stale candidate is
    // still owned by APE, but its old amount is not represented as fresh capacity.
    if (hasFreshEvidence(candidate, freshnessSnapshotAt)) {
      observeFlashLoanDemandHint({
        chain: candidate.chain as any,
        asset: candidate.inputToken,
        amount: candidate.flashLoanAmount,
        expiresAt: candidate.expiresAt,
      });
    }

    const netBps = exactNetBps(candidate);
    if (candidate.expectedProfit > 0n && hasFreshEvidence(candidate, freshnessSnapshotAt)) {
      strictPositiveAlreadyArrived += 1;
      if (bestAvailableStrictPositiveBps === null || netBps > bestAvailableStrictPositiveBps) {
        bestAvailableStrictPositiveBps = netBps;
        bestAvailableStrictPositiveId = candidate.id;
      }
    }
  }

  const output = ordered.map(opportunity => refinedById.get(opportunity.id) ?? opportunity);
  const returnBoundaryAt = Date.now();
  const elapsedMsBeforeReturn = Number(process.hrtime.bigint() - startedAtNs) / 1_000_000;
  const telemetrySnapshot = {
    eligibleCandidatesReceived: input.opportunities.length,
    ownedCandidates: owned.length,
    freshEvidenceCandidates,
    staleEvidenceCandidates,
    fullOwnedCandidateCoverage,
    freshnessSnapshotAt,
    returnBoundaryAt,
    activeCandidates,
    hedgeCandidates,
    reserveCandidates,
    costRescueCandidates,
    edgeRescueCandidates,
    executionRescueCandidates,
    strictPositiveAlreadyArrived,
    residentBestBpsSizeOverlays,
    bestAvailableStrictPositiveId,
    bestAvailableStrictPositiveBps,
    elapsedMsBeforeReturn,
  };

  const telemetry = setImmediate(() => {
    logger.info('[AtomicProfitabilityEngine] Fused zero-copy APE pass completed', {
      component: 'AtomicProfitabilityEngine',
      acronym: 'APE',
      chain: input.chain,
      ...telemetrySnapshot,
      // Backward-compatible fields now explicitly mean fresh-evidence coverage.
      liveCandidates: freshEvidenceCandidates,
      fullStageOneCandidateCoverage: fullOwnedCandidateCoverage,
      candidateOwnershipExpires: false,
      negativeBpsRejected: false,
      staleEvidenceRequiresRefresh: true,
      staleEvidenceExecutionAllowed: false,
      deferredLogDelayExcludedFromApeLatency: true,
      monotonicReturnBoundaryMeasurement: true,
      profitabilityFinishLine: 'strict_positive_all_in_base_units',
      optimizationObjective: 'maximize_exact_executable_net_bps_from_already_arrived_evidence',
      exactBaseUnitBpsWinnerComparison: true,
      marginalVolumeClippingSource: 'already_measured_size_curve_only',
      sameSpreadVariantGrouping: 'same_chain_ordered_token_cycle_direction',
      sameSpreadVariantExtraMeasurement: false,
      stageOneObjectCopies: 0,
      apeResultOverlaysCreated: residentBestBpsSizeOverlays,
      unchangedCandidatesRetainExactStageOneReference: true,
      routeQuotesCreatedByApe: 0,
      rpcCallsCreatedByApe: 0,
      apiCallsCreatedByApe: 0,
      supabaseReadsCreatedByApe: 0,
      supabaseWritesCreatedByApe: 0,
      persistenceCreatedByApe: 0,
      modelCallsCreatedByApe: 0,
      historicalLookupsCreatedByApe: 0,
      duplicateFlashChecksCreatedByApe: 0,
      livePoolCrawlsCreatedByApe: 0,
      feeTierSweepsCreatedByApe: 0,
      exploratoryCallsCreatedByApe: 0,
      residentSizeEvidenceReadOnly: true,
      upstreamSizeSweepRepeatedByApe: false,
      overlayInheritsStageOneFreshness: true,
      providerDemandHintResidentOnly: true,
      providerDemandHintAuthority: false,
      crossThreadTransfer: false,
      ringBufferOnHotPath: false,
      intermediateQueueOnHotPath: false,
      serializationOnHotPath: false,
      waitsForFullQuoteBatch: false,
      waitsForSlowerUnfinishedRoutes: false,
      residentRouting: '2_active_plus_1_hedge_plus_2_dormant_reserve',
      extraCandidatesFormAdditionalCohorts: true,
      betterResultMustAlreadyBePresentToLead: true,
      canonicalProviderProofRemainsDownstream: true,
      canonicalExecutionAuthorityChanged: false,
      stageOneMutation: false,
      syntheticEconomics: false,
      executionAuthority: false,
    });
  });
  telemetry.unref?.();

  return output;
}
