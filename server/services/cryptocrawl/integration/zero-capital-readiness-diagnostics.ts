import logger from '../../../logger.js';
import { buildDynamicZeroCapitalRouteTemplates } from '../discovery/dynamic-zero-capital-routes.js';
import { loadConfiguredZeroCapitalRoutes } from '../execution/adapters/onchain-route-quoter.js';
import {
  getSponsoredReceiverManager,
  supportsSponsoredReceiverChain,
} from '../execution/adapters/sponsored-receiver-manager.js';

let emitted = false;

export function logZeroCapitalReadinessDiagnostics(): void {
  if (emitted) return;
  emitted = true;

  try {
    const configured = loadConfiguredZeroCapitalRoutes();
    const dynamic = [
      ...buildDynamicZeroCapitalRouteTemplates('polygon'),
      ...buildDynamicZeroCapitalRouteTemplates('arbitrum'),
    ];
    const allRoutes = [...new Map([...configured, ...dynamic].map(route => [route.id, route])).values()];
    const eligible = allRoutes.filter(route => route.chain !== 'europa' && supportsSponsoredReceiverChain(route.chain));
    const receiverRecords = getSponsoredReceiverManager().getRecords();

    logger.info('[ZeroCapitalDiagnostics] Route ownership and runtime readiness', {
      component: 'ZeroCapitalDiagnostics',
      explicitConfiguredRoutes: configured.length,
      dynamicStructuralRoutes: dynamic.length,
      totalKnownStructuralRoutes: allRoutes.length,
      sponsoredReceiverEligibleRoutes: eligible.length,
      routeChains: [...new Set(eligible.map(route => route.chain))],
      flashLoanExecutionOwner: 'AutonomousZeroCapitalEngine',
      genericExecutionFlashLoanOwner: false,
      zeroCapitalExecutionEnabled: process.env.ZERO_CAPITAL_ENABLE_EXECUTION === 'true',
      runtimeVerifiedReceivers: receiverRecords.length,
      runtimeReceiverChains: receiverRecords.map(record => record.chain),
      receiverEnvironmentHintPresent: !!(
        process.env.ZERO_CAPITAL_FLASHLOAN_RECEIVER?.trim() ||
        process.env.ZERO_CAPITAL_FLASHLOAN_RECEIVERS?.trim()
      ),
      explicitRouteConfigPresent: configured.length > 0,
      dynamicRouteDiscoveryPresent: dynamic.length > 0,
      routeAuthority: 'explicit_plus_dynamic_measured_routes',
      receiverAuthority: 'deterministic_runtime_deploy_and_verify',
      zeroXReadOnlyConfigured: !!process.env.ZEROX_API_KEY?.trim(),
      zeroXStaticPairConfigured: !!(
        process.env.ZEROX_CHAIN_ID?.trim() &&
        process.env.ZEROX_SELL_TOKEN?.trim() &&
        process.env.ZEROX_BUY_TOKEN?.trim() &&
        process.env.ZEROX_SELL_AMOUNT?.trim()
      ),
    });
  } catch (error) {
    logger.warn('[ZeroCapitalDiagnostics] Route configuration is invalid', {
      component: 'ZeroCapitalDiagnostics',
      flashLoanExecutionOwner: 'AutonomousZeroCapitalEngine',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
