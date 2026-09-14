import type { SupportedExecutionChain } from './onchain-payload-builder.js';

type FlashLoanDemandHint = {
  amount: bigint;
  expiresAt: number;
};

const hints = new Map<string, FlashLoanDemandHint>();

function key(chain: SupportedExecutionChain, asset: string): string {
  return `${chain}:${asset.toLowerCase()}`;
}

/**
 * Clears only one chain's prior APE demand snapshot. This is resident advisory
 * state, not an admission/economics authority and never performs I/O.
 */
export function resetFlashLoanDemandHints(chain: SupportedExecutionChain): void {
  const prefix = `${chain}:`;
  for (const entryKey of hints.keys()) {
    if (entryKey.startsWith(prefix)) hints.delete(entryKey);
  }
}

/**
 * Records the largest already-arrived live amount for one chain/asset in the
 * current APE pass. Canonical provider proof may use it only to know when at least
 * one measured provider can cover the whole resident batch without waiting for
 * slower siblings.
 */
export function observeFlashLoanDemandHint(input: {
  chain: SupportedExecutionChain;
  asset: string;
  amount: bigint;
  expiresAt: number;
}): void {
  if (input.amount <= 0n || input.expiresAt <= Date.now()) return;
  const entryKey = key(input.chain, input.asset);
  const current = hints.get(entryKey);
  if (!current || current.expiresAt <= Date.now() || input.amount > current.amount) {
    hints.set(entryKey, { amount: input.amount, expiresAt: input.expiresAt });
    return;
  }
  if (input.expiresAt > current.expiresAt) current.expiresAt = input.expiresAt;
}

export function getFlashLoanDemandHint(
  chain: SupportedExecutionChain,
  asset: string,
  now = Date.now(),
): bigint | null {
  const entryKey = key(chain, asset);
  const current = hints.get(entryKey);
  if (!current || current.expiresAt <= now) {
    if (current) hints.delete(entryKey);
    return null;
  }
  return current.amount;
}
