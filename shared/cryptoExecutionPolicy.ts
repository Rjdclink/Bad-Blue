/**
 * Crypto Execution Policy (Stage 2: Execution Nullification)
 *
 * Goal: provable zero-execution state.
 *
 * This flag is intentionally a hard-coded constant.
 * Execution can only be enabled by an explicit code change (and redeploy),
 * not by environment variables, UI toggles, or runtime mutation.
 */

export const CRYPTO_EXECUTION_RELEASED = false as const;

export function assertCryptoExecutionReleased(_context: string): never {
  throw new Error('CRYPTO_EXECUTION_DISABLED');
}

