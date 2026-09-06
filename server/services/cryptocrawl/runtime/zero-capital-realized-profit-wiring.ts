import logger from '../../../logger.js';

let logged = false;

/**
 * Compatibility boundary only. ZERO_CAPITAL_ATOMIC terminal profit proof,
 * recipient-delta verification, realized gas accounting, 90/10 treasury recording,
 * and reusable-capital provenance now occur in zero-capital-canonical-executor.ts
 * after terminal receipt evidence. No engine instance or prototype is mutated.
 */
export function ensureZeroCapitalRealizedProfitWiring(): void {
  if (logged) return;
  logged = true;
  logger.info('[ZeroCapitalRealizedProfit] Legacy execution wrapper retired', {
    component: 'ZeroCapitalRealizedProfitWiring',
    terminalProfitAuthority: 'CanonicalZeroCapitalExecutor',
    treasuryAuthority: 'RetainedProfitLedger_fixed_90_10',
    executeFundedMutation: false,
    executeAndRecordMutation: false,
    prototypeMutation: false,
    executionAuthority: false,
  });
}
