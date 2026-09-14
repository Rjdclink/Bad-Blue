import type { SupportedExecutionChain } from './onchain-payload-builder.js';

type FlashLoanDemandHint = {
  amount: bigint;
  expiresAt: number;
};

const hints = new Map<string, FlashLoanDemandHint[]>();

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
 * Records already-arrived live amounts for one chain/asset in the current APE pass.
 * Each amount keeps its own expiry so a smaller, longer-lived candidate can never
 * extend the freshness of a larger amount.
 */
export function observeFlashLoanDemandHint(input: {
  chain: SupportedExecutionChain;
  asset: string;
  amount: bigint;
  expiresAt: number;
}): void {
  const now = Date.now();
  if (input.amount <= 0n || input.expiresAt <= now) return;
  const entryKey = key(input.chain, input.asset);
  const current = (hints.get(entryKey) || []).filter(item => item.expiresAt > now);
  const matching = current.find(item => item.amount === input.amount);
  if (matching) matching.expiresAt = Math.max(matching.expiresAt, input.expiresAt);
  else current.push({ amount: input.amount, expiresAt: input.expiresAt });
  hints.set(entryKey, current);
}

export function getFlashLoanDemandHint(
  chain: SupportedExecutionChain,
  asset: string,
  now = Date.now(),
): bigint | null {
  const entryKey = key(chain, asset);
  const live = (hints.get(entryKey) || []).filter(item => item.expiresAt > now);
  if (live.length === 0) {
    hints.delete(entryKey);
    return null;
  }
  hints.set(entryKey, live);
  let maximum = live[0].amount;
  for (let index = 1; index < live.length; index += 1) {
    if (live[index].amount > maximum) maximum = live[index].amount;
  }
  return maximum;
}
