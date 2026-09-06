import logger from '../../../logger.js';

let logged = false;

/**
 * Compatibility boundary only. Proven system-owned native gas is reserved and
 * broadcast through executeSystemOwnedNativeTransaction from the single canonical
 * zero-capital executor. This module must never intercept executeFunded.
 */
export function ensureSystemOwnedNativeZeroCapitalExecutionWiring(): void {
  if (logged) return;
  logged = true;
  logger.info('[ZeroCapitalNativeGas] Legacy native execution wrapper retired', {
    component: 'SystemOwnedNativeZeroCapitalExecutionWiring',
    gasSpendAuthority: 'executeSystemOwnedNativeTransaction',
    executionAuthority: 'CanonicalZeroCapitalExecutor',
    executeFundedMutation: false,
    transactionSubmissionAuthority: false,
  });
}
