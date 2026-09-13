import logger from '../../../logger.js';
import type { providers } from 'ethers';
import { zeroCapitalEngine, type SupportedChain, type ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import type { ConfiguredZeroCapitalRoute, QuotedZeroCapitalRoute } from '../execution/adapters/onchain-route-quoter.js';
import { runZeroCapitalAtomicBpsEngine } from './zero-capital-atomic-bps-engine.js';
import { runZeroCapitalAtomicStackTactic } from './zero-capital-atomic-stack-wiring.js';
import { handoffStageOneToAtomicBps } from './zero-capital-stage-handoff-supervisor.js';

export interface FairZeroCapitalProfitabilityRescueInput {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  opportunities: readonly ZeroCapitalOpportunity[];
  configuredRoutes: readonly ConfiguredZeroCapitalRoute[];
  fromQuotedRoute: (quote: QuotedZeroCapitalRoute, blockTimestamp: number) => ZeroCapitalOpportunity;
}

/**
 * Compatibility entry name retained for canonical discovery. Runtime behavior is
 * deliberately singular: locked Stage-1 output is handed directly in-memory to
 * one Atomic BPS transformation pipeline. The handoff supervisor only deduplicates
 * and serially replays a definitively failed delivery; it has no economic or
 * execution authority. Shared-principal composition is triggered only from inside
 * this same Stage-2 pipeline and runs in parallel so it cannot delay a good single
 * route. There is no persisted fairness scheduler or second transformation loop.
 */
export async function runFairZeroCapitalProfitabilityRescue(
  input: FairZeroCapitalProfitabilityRescueInput,
): Promise<ZeroCapitalOpportunity[]> {
  const fromQuotedRoute: FairZeroCapitalProfitabilityRescueInput['fromQuotedRoute'] =
    (quote, blockTimestamp) => input.fromQuotedRoute.call(zeroCapitalEngine, quote, blockTimestamp);

  const result = await handoffStageOneToAtomicBps({
    chain: input.chain,
    opportunities: input.opportunities,
    consume: async () => {
      const transformed = await runZeroCapitalAtomicBpsEngine({
        ...input,
        fromQuotedRoute,
      });
      // Composite search is an internal tactic, not a second stage. It is kicked
      // off only by this one pipeline and never sits between a profitable route and
      // its normal downstream provider/execution path.
      void runZeroCapitalAtomicStackTactic({
        chain: input.chain,
        provider: input.provider,
        opportunities: transformed,
      }).catch(error => {
        logger.debug('[ZeroCapitalProfitabilityRescueFair] Parallel composite tactic degraded locally', {
          component: 'ZeroCapitalProfitabilityRescueFair',
          chain: input.chain,
          error: error instanceof Error ? error.message : String(error),
          singleRouteResultAffected: false,
          executionAuthority: false,
        });
      });
      return transformed;
    },
  });

  logger.debug('[ZeroCapitalProfitabilityRescueFair] Compatibility gateway used supervised direct Atomic BPS pipeline', {
    component: 'ZeroCapitalProfitabilityRescueFair',
    chain: input.chain,
    profitabilityFinishLine: 'strict_positive_all_in_base_units',
    oneTransformationAuthority: true,
    oneTransformationPipeline: true,
    stageOneDirectInMemoryHandoff: true,
    boundedRecursiveHandoffSupervision: true,
    concurrentDuplicateStageTwoRuns: false,
    staleHandoffReplayAllowed: false,
    compositeTacticInsideSamePipeline: true,
    compositeTacticBlocksSingleRouteReturn: false,
    independentCompositePromotionLoop: false,
    persistedFairnessOnHotPath: false,
    stageTwoSerialPass: false,
    executionAuthority: false,
  });

  return result;
}
