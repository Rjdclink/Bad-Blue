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

function copyOpportunity(opportunity: ZeroCapitalOpportunity): ZeroCapitalOpportunity {
  return {
    ...opportunity,
    route: opportunity.route.map(leg => ({ ...leg })),
  };
}

/**
 * Compatibility entry name retained for canonical discovery. Runtime behavior is
 * deliberately singular: locked Stage-1 output is handed directly in-memory to
 * one Atomic BPS transformation pipeline. The handoff supervisor only deduplicates
 * and serially replays a definitively failed delivery; it has no economic or
 * execution authority. Shared-principal composition is triggered only from inside
 * this same Stage-2 pipeline and runs in parallel so it cannot delay a good single
 * route. There is no persisted fairness scheduler or second transformation loop.
 *
 * The Stage-1 objects themselves are never handed to a transformation worker.
 * Stage 2/3 receive a fresh structural copy on every attempt, preserving the
 * locked Stage-1 candidate identity, order, BPS and lifetime exactly as observed.
 */
export async function runFairZeroCapitalProfitabilityRescue(
  input: FairZeroCapitalProfitabilityRescueInput,
): Promise<ZeroCapitalOpportunity[]> {
  const fromQuotedRoute: FairZeroCapitalProfitabilityRescueInput['fromQuotedRoute'] =
    (quote, blockTimestamp) => input.fromQuotedRoute.call(zeroCapitalEngine, quote, blockTimestamp);

  // Snapshot the locked Stage-1 boundary once. Handoff supervision may inspect this
  // snapshot, but all transformation workers receive independent copies below.
  const stageOneSnapshot = input.opportunities.map(copyOpportunity);

  const result = await handoffStageOneToAtomicBps({
    chain: input.chain,
    opportunities: stageOneSnapshot,
    consume: async handoff => {
      // ACK is emitted by the actual Stage-2 consumer, not by the supervisor. This
      // makes a broken Stage-1 -> Stage-2 call contract observable immediately while
      // keeping the healthy path a same-stack, in-memory handoff with no I/O wait.
      handoff.acknowledge();
      const transformed = await runZeroCapitalAtomicBpsEngine({
        ...input,
        opportunities: stageOneSnapshot.map(copyOpportunity),
        fromQuotedRoute,
      });
      if (!handoff.isActive()) return transformed;

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
    stageOneInputIsolatedFromTransformation: true,
    stageTwoExplicitAcknowledgement: true,
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
