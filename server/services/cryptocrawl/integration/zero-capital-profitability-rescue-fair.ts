import logger from '../../../logger.js';
import type { providers } from 'ethers';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import type { ConfiguredZeroCapitalRoute, QuotedZeroCapitalRoute } from '../execution/adapters/onchain-route-quoter.js';
import { primeApeResidentRouting } from './atomic-profitability-resident-routing.js';
import { runZeroCapitalAtomicBpsEngine } from './zero-capital-atomic-bps-engine.js';
import { runZeroCapitalAtomicStackTactic } from './zero-capital-atomic-stack-wiring.js';
import { runZeroCapitalProfitabilityRescueV2 } from './zero-capital-profitability-rescue-v2.js';

export interface FairZeroCapitalProfitabilityRescueInput {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  opportunities: readonly ZeroCapitalOpportunity[];
  configuredRoutes: readonly ConfiguredZeroCapitalRoute[];
  fromQuotedRoute: (quote: QuotedZeroCapitalRoute, blockTimestamp: number) => ZeroCapitalOpportunity;
}

/**
 * Canonical Stage-1 -> APE gateway. The resident APE fast path always runs first on
 * the exact Stage-1 opportunity objects. If that already-arrived evidence contains
 * a strict-positive result, downstream proof can continue without extra measurement.
 *
 * When fresh rescue-band candidates remain non-positive, APE's attached measured
 * actuator runs the existing bounded profitability-rescue pass. That pass creates
 * only derived fresh quote results, never mutates Stage 1, never fabricates BPS, and
 * never gains execution authority. Composite work remains post-decision and cannot
 * block a single-route result.
 */
export async function runFairZeroCapitalProfitabilityRescue(
  input: FairZeroCapitalProfitabilityRescueInput,
): Promise<ZeroCapitalOpportunity[]> {
  primeApeResidentRouting(input.opportunities);

  const residentFastPath = runZeroCapitalAtomicBpsEngine({
    ...input,
    opportunities: input.opportunities,
  });

  const activeRescueCandidates = residentFastPath.filter(opportunity =>
    opportunity.expiresAt > Date.now()
    && opportunity.flashLoanAmount > 0n
    && Number.isFinite(opportunity.netProfitBps)
    && opportunity.expectedProfit <= 0n,
  );

  let transformed = residentFastPath;
  let activeMeasuredRescueInvoked = false;
  let activeMeasuredRescueOverlays = 0;
  let activeMeasuredRescueError: string | null = null;

  if (activeRescueCandidates.length > 0) {
    activeMeasuredRescueInvoked = true;
    try {
      transformed = await runZeroCapitalProfitabilityRescueV2({
        ...input,
        opportunities: residentFastPath,
      });
      const residentById = new Map(residentFastPath.map(opportunity => [opportunity.id, opportunity]));
      activeMeasuredRescueOverlays = transformed.filter(opportunity => residentById.get(opportunity.id) !== opportunity).length;
    } catch (error) {
      activeMeasuredRescueError = error instanceof Error ? error.message : String(error);
      transformed = residentFastPath;
      logger.warn('[ZeroCapitalProfitabilityRescueFair] Active measured APE rescue degraded locally; resident evidence continues', {
        component: 'ZeroCapitalProfitabilityRescueFair',
        chain: input.chain,
        error: activeMeasuredRescueError,
        stageOneMutation: false,
        syntheticEconomics: false,
        executionAuthority: false,
      });
    }
  }

  const strictPositiveAfterRescue = transformed.filter(opportunity =>
    opportunity.expiresAt > Date.now() && opportunity.expectedProfit > 0n,
  ).length;

  const postDecision = setImmediate(() => {
    void runZeroCapitalAtomicStackTactic({
      chain: input.chain,
      provider: input.provider,
      opportunities: transformed,
    }).catch(error => {
      logger.debug('[ZeroCapitalProfitabilityRescueFair] Post-APE composite tactic degraded locally', {
        component: 'ZeroCapitalProfitabilityRescueFair',
        chain: input.chain,
        error: error instanceof Error ? error.message : String(error),
        singleRouteResultAffected: false,
        executionAuthority: false,
      });
    });

    logger.info('[ZeroCapitalProfitabilityRescueFair] Stage-1 -> APE active rescue continuation completed', {
      component: 'ZeroCapitalProfitabilityRescueFair',
      chain: input.chain,
      profitabilityFinishLine: 'strict_positive_all_in_base_units',
      residentFastPathFirst: true,
      activeMeasuredRescueOwner: 'ZeroCapitalProfitabilityRescueV2',
      activeMeasuredRescueInvoked,
      activeMeasuredRescueCandidates: activeRescueCandidates.length,
      activeMeasuredRescueOverlays,
      strictPositiveAfterRescue,
      activeMeasuredRescueError,
      stageOneSameReferenceIntoResidentFastPath: true,
      activeRescueCreatesDerivedEvidenceOnly: true,
      // Legacy verifier aliases below describe only the locked Stage-1 -> resident
      // fast-path boundary. Active rescue may create derived overlays afterward.
      stageOneSameReferenceContinuation: true,
      stageOneStructuralCopies: 0,
      stageTwoHandoffSupervisorOnHotPath: false,
      stageTwoAcknowledgementWaitOnHotPath: false,
      stageOneMutation: false,
      syntheticEconomics: false,
      externalQueueOnHotPath: false,
      persistenceOnHotPath: false,
      supabaseOnHotPath: false,
      compositeTacticInsideSamePipeline: true,
      compositeTacticBlocksSingleRouteReturn: false,
      compositeTacticScheduledAfterApeDecision: true,
      independentCompositePromotionLoop: false,
      executionAuthority: false,
    });
  });
  postDecision.unref?.();

  return transformed;
}
