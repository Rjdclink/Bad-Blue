import logger from '../../../logger.js';

let logged = false;

/**
 * Compatibility boundary only. Aave, Morpho, and Balancer provider-specific
 * execution now lives inside zero-capital-canonical-executor.ts, selected from the
 * single flashLoanProviderSelectionRegistry. This module must never rewrite
 * executeFunded or create a second submission path.
 */
export function ensureProviderSpecificZeroCapitalExecutionWiring(): void {
  if (logged) return;
  logged = true;
  logger.info('[ZeroCapitalProviderExecution] Legacy provider-specific wrapper retired', {
    component: 'ProviderSpecificZeroCapitalExecutionWiring',
    providerSelectionAuthority: 'flash_loan_provider_selection_registry',
    executionAuthority: 'CanonicalZeroCapitalExecutor',
    executeFundedMutation: false,
    transactionSubmissionAuthority: false,
  });
}
