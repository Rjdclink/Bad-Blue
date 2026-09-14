import logger from '../../../logger.js';
import type { providers } from 'ethers';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
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

function grossProfit(opportunity: ZeroCapitalOpportunity): bigint {
  return opportunity.grossProfit
    ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
}

function rescueMode(opportunity: ZeroCapitalOpportunity): ApeRescueMode {
  if (opportunity.expectedProfit > 0n) return 'execution';
  return grossProfit(opportunity) > 0n ? 'cost' : 'edge';
}

function liveStageOneCandidate(opportunity: ZeroCapitalOpportunity, now = Date.now()): boolean {
  return opportunity.expiresAt > now
    && opportunity.flashLoanAmount > 0n
    && Number.isFinite(opportunity.netProfitBps)
    && Number.isFinite(exactNetBps(opportunity));
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
 * Consume only a quote that the existing upstream bounded size sweep already made.
 * Stage 1 keeps its original highest-dollar-profit candidate exactly as before; APE
 * may create a separate result overlay only when the resident variant has strictly
 * better measured net BPS. No Stage-1 object is mutated or structurally copied.
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
  if (!Number.isFinite(resident.netProfitBps) || resident.netProfitBps <= currentBps) return opportunity;

  const refined = input.fromQuotedRoute(resident, originalBlockTimestamp(opportunity));
  if (refined.id !== opportunity.id) return opportunity;
  // fromQuotedRoute normally stamps a fresh lifetime for a newly acquired quote.
  // This is an overlay of evidence from the SAME upstream size sweep, so APE must
  // inherit Stage-1 freshness instead of manufacturing a new observation window.
  refined.timestamp = opportunity.timestamp;
  refined.expiresAt = opportunity.expiresAt;
  if (refined.expiresAt <= Date.now()) return opportunity;
  if (opportunity.inputAssetUsdPrice !== undefined) refined.inputAssetUsdPrice = opportunity.inputAssetUsdPrice;
  return refined;
}

/**
 * Canonical Atomic Profitability Engine (APE), latency-safe hot path.
 *
 * Stage 1 remains the locked >= -10 BPS classifier. APE receives those exact
 * opportunity objects by reference and performs only local, in-memory ordering and
 * exact all-in BPS comparison. It never quotes a route, measures a provider, reads
 * Supabase, persists state, calls a model, performs historical lookup, or waits for
 * unfinished alternatives. Route/provider/builder exploration belongs before the
 * hot path or in the existing canonical proof layers that are required anyway.
 *
 * Size optimization is not repeated: the existing upstream bounded notional sweep
 * retains its best-BPS quote in resident memory while preserving its Stage-1 return
 * semantics. APE can consume that already-arrived quote immediately as an overlay.
 *
 * The resident routing table is explicitly 2 active + 1 hedge + 2 dormant reserve
 * per contextual cohort. Every additional set of candidates forms another cohort,
 * so the lane width is never an eligibility cap. A better candidate may lead only
 * when its evidence has already arrived; no ready strict-positive candidate waits
 * for new evidence to be created.
 */
export function runZeroCapitalAtomicBpsEngine(
  input: ZeroCapitalAtomicBpsEngineInput,
): ZeroCapitalOpportunity[] {
  if (input.chain === 'europa' || input.opportunities.length === 0) {
    return input.opportunities.length === 0 ? [] : [...input.opportunities];
  }

  // Normal flow is primed immediately before this call by the fused Stage-1 -> APE
  // continuation. This fallback is local-only and exists solely for compatibility
  // with any direct caller; it performs no I/O and copies no opportunity object.
  if (input.opportunities.some(opportunity => !hasApeResidentPlacement(opportunity.id))) {
    primeApeResidentRouting(input.opportunities);
  }

  const startedAt = Date.now();
  const ordered = orderApeResidentOpportunities(input.opportunities);
  const live = ordered.filter(opportunity => liveStageOneCandidate(opportunity));
  const refinedById = new Map<string, ZeroCapitalOpportunity>();

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

  for (const opportunity of live) {
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
    const netBps = exactNetBps(candidate);
    if (candidate.expectedProfit > 0n) {
      strictPositiveAlreadyArrived += 1;
      if (bestAvailableStrictPositiveBps === null || netBps > bestAvailableStrictPositiveBps) {
        bestAvailableStrictPositiveBps = netBps;
        bestAvailableStrictPositiveId = candidate.id;
      }
    }
  }

  const output = ordered.map(opportunity => refinedById.get(opportunity.id) ?? opportunity);

  // Telemetry is explicitly behind the decision and behind the caller's Promise
  // continuation. No microtask is inserted between Stage 1, APE, or downstream proof.
  const telemetry = setImmediate(() => {
    logger.info('[AtomicProfitabilityEngine] Fused zero-copy APE pass completed', {
      component: 'AtomicProfitabilityEngine',
      acronym: 'APE',
      chain: input.chain,
      eligibleCandidatesReceived: input.opportunities.length,
      liveCandidates: live.length,
      fullStageOneCandidateCoverage: live.length === input.opportunities.filter(item => liveStageOneCandidate(item)).length,
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
      elapsedMsBeforeReturn: Date.now() - startedAt,
      profitabilityFinishLine: 'strict_positive_all_in_base_units',
      optimizationObjective: 'maximize_exact_executable_net_bps_from_already_arrived_evidence',
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
      crossThreadTransfer: false,
      ringBufferOnHotPath: false,
      intermediateQueueOnHotPath: false,
      serializationOnHotPath: false,
      waitsForFullQuoteBatch: false,
      waitsForSlowerUnfinishedRoutes: false,
      residentRouting: '2_active_plus_1_hedge_plus_2_dormant_reserve',
      extraCandidatesFormAdditionalCohorts: true,
      betterResultMustAlreadyBePresentToLead: true,
      canonicalProviderProofRemainsDownstreamAndUnchanged: true,
      canonicalExecutionAuthorityChanged: false,
      stageOneMutation: false,
      syntheticEconomics: false,
      executionAuthority: false,
    });
  });
  telemetry.unref?.();

  return output;
}
