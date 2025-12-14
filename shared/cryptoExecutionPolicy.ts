/**
 * Crypto Execution Policy
 *
 * Current constraints:
 * - Execution is "technically unpaused" ONLY for wiring/routing/validation.
 * - No capital deployment, no live orders, no withdrawals.
 *
 * These flags are intentionally hard-coded constants.
 * They can only be changed by an explicit code edit + redeploy.
 */

// Allows starting wiring components (routing/validation harnesses only).
export const CRYPTO_EXECUTION_WIRING_RELEASED = true as const;

// Hard blocker for anything that can move funds / place real orders / broadcast tx.
export const CRYPTO_CAPITAL_DEPLOYMENT_RELEASED = false as const;

export function assertCryptoExecutionWiringReleased(_context: string): never {
  throw new Error('CRYPTO_EXECUTION_WIRING_DISABLED');
}

export function assertCryptoCapitalDeploymentReleased(_context: string): never {
  throw new Error('CRYPTO_CAPITAL_DEPLOYMENT_DISABLED');
}

