import logger from '../../../logger.js';
import { getCanonicalZeroCapitalRouteSnapshot } from '../discovery/zero-capital-route-authority.js';
import {
  getSponsoredReceiverManager,
  supportsSponsoredReceiverChain,
} from '../execution/adapters/sponsored-receiver-manager.js';

let emitted = false;

export function logZeroCapitalReadinessDiagnostics(): void {
  if (emitted) return;
  emitted = true;

  try {
    const routeSnapshot = getCanonicalZeroCapitalRouteSnapshot();
    const eligible = routeSnapshot.routes.filter(route => supportsSponsoredReceiverChain(route.chain));
    const receiverRecords = getSponsoredReceiverManager().getRecords();
    const canonicalExecutionRequested = process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true'
      && process.env.NO_EXECUTION !== 'true';

    logger.info('[ZeroCapitalDiagnostics] Canonical route and runtime readiness', {
      component: 'ZeroCapitalDiagnostics',
      explicitConfiguredRoutes: routeSnapshot.explicitRoutes,
      dynamicStructuralRoutes: routeSnapshot.dynamicRoutes,
      graphlessStructuralRoutes: routeSnapshot.graphlessRoutes,
      totalKnownStructuralRoutes: routeSnapshot.routes.length,
      sponsoredReceiverEligibleRoutes: eligible.length,
      routeChains: routeSnapshot.chains,
      routeAuthority: 'zero_capital_route_authority',
      flashLoanExecutionOwner: 'CanonicalZeroCapitalExecutor',
      genericExecutionFlashLoanOwner: false,
      canonicalExecutionRequested,
      zeroCapitalSpecificExecutionFlagAuthority: false,
      runtimeVerifiedReceivers: receiverRecords.length,
      runtimeReceiverChains: receiverRecords.map(record => record.chain),
      receiverEnvironmentHintPresent: !!(
        process.env.ZERO_CAPITAL_FLASHLOAN_RECEIVER?.trim() ||
        process.env.ZERO_CAPITAL_FLASHLOAN_RECEIVERS?.trim()
      ),
      explicitRouteConfigPresent: routeSnapshot.explicitRoutes > 0,
      dynamicRouteDiscoveryPresent: routeSnapshot.dynamicRoutes > 0,
      receiverAuthority: 'canonical_zero_capital_discovery_resource_stage',
      gasFundingAuthority: 'getProvenZeroCapitalGasFundingDecision',
      executionAuthority: 'canonical_execution_scheduler_to_canonical_zero_capital_executor',
      zeroXReadOnlyConfigured: !!process.env.ZEROX_API_KEY?.trim(),
      zeroXStaticPairConfigured: !!(
        process.env.ZEROX_CHAIN_ID?.trim() &&
        process.env.ZEROX_SELL_TOKEN?.trim() &&
        process.env.ZEROX_BUY_TOKEN?.trim() &&
        process.env.ZEROX_SELL_AMOUNT?.trim()
      ),
    });
  } catch (error) {
    logger.warn('[ZeroCapitalDiagnostics] Canonical route authority is unavailable', {
      component: 'ZeroCapitalDiagnostics',
      routeAuthority: 'zero_capital_route_authority',
      executionAuthority: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
