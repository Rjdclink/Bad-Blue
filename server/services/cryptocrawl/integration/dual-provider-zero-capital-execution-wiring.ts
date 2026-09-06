import logger from '../../../logger.js';

let logged = false;

/**
 * Compatibility boundary only. Combined Aave+Balancer execution is represented
 * by the sole flashLoanProviderSelectionRegistry and submitted only by
 * zero-capital-canonical-executor.ts. No runtime execution method is rewritten.
 */
export function ensureDualProviderZeroCapitalExecutionWiring(): void {
  if (logged) return;
  logged = true;
  logger.info('[ZeroCapitalProviderMesh] Legacy dual-provider wrapper retired', {
    component: 'DualProviderZeroCapitalExecutionWiring',
    providerSelectionAuthority: 'flash_loan_provider_selection_registry',
    executionAuthority: 'CanonicalZeroCapitalExecutor',
    executeFundedMutation: false,
    transactionSubmissionAuthority: false,
  });
}
