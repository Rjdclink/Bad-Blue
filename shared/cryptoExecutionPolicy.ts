/**
 * Crypto Execution Policy
 *
 * Current directive:
 * - Execution pause is lifted ONLY for wiring/routing/validation.
 * - No capital deployment, no live orders, no withdrawals.
 *
 * This flag is intentionally a hard-coded constant.
 * It can only be changed by an explicit code edit + redeploy.
 */

export const CRYPTO_EXECUTION_RELEASED = true as const;

/**
 * Legacy fail-closed helper.
 * Capital deployment is still prevented by hard-disabled entrypoints, not by extra flags.
 */
export function assertCryptoExecutionReleased(_context: string): never {
  throw new Error('CRYPTO_EXECUTION_DISABLED');
}

