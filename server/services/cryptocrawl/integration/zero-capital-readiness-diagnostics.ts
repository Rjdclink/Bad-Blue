import logger from '../../../logger.js';
import { loadConfiguredZeroCapitalRoutes } from '../execution/adapters/onchain-route-quoter.js';
import { supportsSponsoredReceiverChain } from '../execution/adapters/sponsored-receiver-manager.js';

let emitted = false;

export function logZeroCapitalReadinessDiagnostics(): void {
  if (emitted) return;
  emitted = true;

  try {
    const configured = loadConfiguredZeroCapitalRoutes();
    const eligible = configured.filter(route => route.chain !== 'europa' && supportsSponsoredReceiverChain(route.chain));
    logger.info('[ZeroCapitalDiagnostics] Route ownership and configuration', {
      component: 'ZeroCapitalDiagnostics',
      configuredRoutes: configured.length,
      sponsoredReceiverEligibleRoutes: eligible.length,
      routeChains: [...new Set(eligible.map(route => route.chain))],
      flashLoanExecutionOwner: 'AutonomousZeroCapitalEngine',
      genericExecutionFlashLoanOwner: false,
      zeroCapitalExecutionEnabled: process.env.ZERO_CAPITAL_ENABLE_EXECUTION === 'true',
      receiverConfigured: !!process.env.ZERO_CAPITAL_FLASHLOAN_RECEIVER?.trim(),
      routeConfigPresent: !!process.env.ZERO_CAPITAL_ROUTE_CONFIG?.trim(),
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
