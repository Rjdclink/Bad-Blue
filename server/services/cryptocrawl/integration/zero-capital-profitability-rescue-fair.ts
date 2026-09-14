import logger from '../../../logger.js';
import type { providers } from 'ethers';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import type { ConfiguredZeroCapitalRoute, QuotedZeroCapitalRoute } from '../execution/adapters/onchain-route-quoter.js';
import { primeApeResidentRouting } from './atomic-profitability-resident-routing.js';
import { runZeroCapitalAtomicBpsEngine } from './zero-capital-atomic-bps-engine.js';
import { runZeroCapitalAtomicStackTactic } from './zero-capital-atomic-stack-wiring.js';

export interface FairZeroCapitalProfitabilityRescueInput {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  opportunities: readonly ZeroCapitalOpportunity[];
  configuredRoutes: readonly ConfiguredZeroCapitalRoute[];
  fromQuotedRoute: (quote: QuotedZeroCapitalRoute, blockTimestamp: number) => ZeroCapitalOpportunity;
}

/**
 * Compatibility gateway retained for canonical discovery, but the healthy path is
 * now fused zero-copy continuation: Stage 1 passes the exact same opportunity object
 * references directly into APE. There is no structural copy, queue, serialization,
 * persistence, ACK microtask, handoff supervisor, replay, or database boundary.
 *
 * The resident 2+1+2 contextual layout is primed synchronously from the already-
 * arrived Stage-1 evidence, then APE runs in the same call stack. Composite work is
 * scheduled only after the APE decision and cannot delay the returned result.
 */
export async function runFairZeroCapitalProfitabilityRescue(
  input: FairZeroCapitalProfitabilityRescueInput,
): Promise<ZeroCapitalOpportunity[]> {
  primeApeResidentRouting(input.opportunities);

  const transformed = runZeroCapitalAtomicBpsEngine({
    ...input,
    opportunities: input.opportunities,
  });

  queueMicrotask(() => {
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

    logger.debug('[ZeroCapitalProfitabilityRescueFair] Fused zero-copy Stage-1 -> APE continuation completed', {
      component: 'ZeroCapitalProfitabilityRescueFair',
      chain: input.chain,
      profitabilityFinishLine: 'strict_positive_all_in_base_units',
      oneTransformationAuthority: true,
      oneTransformationPipeline: true,
      stageOneSameReferenceContinuation: true,
      stageOneStructuralCopies: 0,
      stageTwoHandoffSupervisorOnHotPath: false,
      stageTwoAcknowledgementWaitOnHotPath: false,
      boundedReplayOnHealthyHotPath: false,
      externalQueueOnHotPath: false,
      persistenceOnHotPath: false,
      supabaseOnHotPath: false,
      compositeTacticInsideSamePipeline: true,
      compositeTacticBlocksSingleRouteReturn: false,
      compositeTacticScheduledAfterApeDecision: true,
      executionAuthority: false,
    });
  });

  return transformed;
}
