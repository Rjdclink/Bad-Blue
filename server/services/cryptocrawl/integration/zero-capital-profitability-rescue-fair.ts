import logger from '../../../logger.js';
import type { providers } from 'ethers';
import { zeroCapitalEngine, type SupportedChain, type ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import type { ConfiguredZeroCapitalRoute, QuotedZeroCapitalRoute } from '../execution/adapters/onchain-route-quoter.js';
import { runZeroCapitalAtomicBpsEngine } from './zero-capital-atomic-bps-engine.js';

export interface FairZeroCapitalProfitabilityRescueInput {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  opportunities: readonly ZeroCapitalOpportunity[];
  configuredRoutes: readonly ConfiguredZeroCapitalRoute[];
  fromQuotedRoute: (quote: QuotedZeroCapitalRoute, blockTimestamp: number) => ZeroCapitalOpportunity;
}

/**
 * Compatibility entry name retained for canonical discovery. Runtime behavior is
 * deliberately singular: one call enters one Atomic BPS transformation engine.
 * There is no persisted fairness scheduler, no Stage-2-first pass, and no second
 * transformation authority. The canonical executor remains downstream authority.
 */
export async function runFairZeroCapitalProfitabilityRescue(
  input: FairZeroCapitalProfitabilityRescueInput,
): Promise<ZeroCapitalOpportunity[]> {
  const fromQuotedRoute: FairZeroCapitalProfitabilityRescueInput['fromQuotedRoute'] =
    (quote, blockTimestamp) => input.fromQuotedRoute.call(zeroCapitalEngine, quote, blockTimestamp);

  const result = await runZeroCapitalAtomicBpsEngine({
    ...input,
    fromQuotedRoute,
  });

  logger.debug('[ZeroCapitalProfitabilityRescueFair] Compatibility gateway used single Atomic BPS pipeline', {
    component: 'ZeroCapitalProfitabilityRescueFair',
    chain: input.chain,
    profitabilityFinishLine: 'strict_positive_all_in_base_units',
    oneTransformationAuthority: true,
    oneTransformationPipeline: true,
    persistedFairnessOnHotPath: false,
    stageTwoSerialPass: false,
    executionAuthority: false,
  });

  return result;
}
