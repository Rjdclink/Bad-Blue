import type { GhostWalletMatchedIntentPair, GhostWalletSignedIntent } from './intent-book.js';

export type SerializedGhostWalletSignedIntent = Omit<GhostWalletSignedIntent, 'sellAmount' | 'minBuyAmount' | 'nonce'> & {
  sellAmount: string;
  minBuyAmount: string;
  nonce: string;
};

export interface SerializedGhostWalletMatchedIntentPair {
  pairId: string;
  chain: string;
  chainId: number;
  intermediary: string;
  intentA: SerializedGhostWalletSignedIntent;
  intentB: SerializedGhostWalletSignedIntent;
  feeBpsA: number;
  feeBpsB: number;
  feeAmountA: string;
  feeAmountB: string;
  userBuyAmountA: string;
  userBuyAmountB: string;
  expiresAt: number;
}

function serializeIntent(intent: GhostWalletSignedIntent): SerializedGhostWalletSignedIntent {
  return {
    ...intent,
    sellAmount: intent.sellAmount.toString(),
    minBuyAmount: intent.minBuyAmount.toString(),
    nonce: intent.nonce.toString(),
  };
}

function parsePositiveIntegerString(label: string, value: unknown, allowZero = false): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error(`${label} must be an unsigned integer string`);
  const parsed = BigInt(value);
  if (allowZero ? parsed < 0n : parsed <= 0n) throw new Error(`${label} is outside the permitted range`);
  return parsed;
}

function deserializeIntent(value: any): GhostWalletSignedIntent {
  if (!value || typeof value !== 'object') throw new Error('Ghost Wallet persisted intent is missing');
  return {
    chain: String(value.chain || '').trim().toLowerCase(),
    chainId: Number(value.chainId),
    intermediary: String(value.intermediary || ''),
    owner: String(value.owner || ''),
    sellToken: String(value.sellToken || ''),
    buyToken: String(value.buyToken || ''),
    sellAmount: parsePositiveIntegerString('sellAmount', value.sellAmount),
    minBuyAmount: parsePositiveIntegerString('minBuyAmount', value.minBuyAmount),
    maxFeeBps: Number(value.maxFeeBps),
    nonce: parsePositiveIntegerString('nonce', value.nonce, true),
    deadline: Number(value.deadline),
    signature: String(value.signature || ''),
    receivedAt: Number(value.receivedAt),
  };
}

export function serializeMatchedIntentPair(pair: GhostWalletMatchedIntentPair): SerializedGhostWalletMatchedIntentPair {
  return {
    pairId: pair.pairId,
    chain: pair.chain,
    chainId: pair.chainId,
    intermediary: pair.intermediary,
    intentA: serializeIntent(pair.intentA),
    intentB: serializeIntent(pair.intentB),
    feeBpsA: pair.feeBpsA,
    feeBpsB: pair.feeBpsB,
    feeAmountA: pair.feeAmountA.toString(),
    feeAmountB: pair.feeAmountB.toString(),
    userBuyAmountA: pair.userBuyAmountA.toString(),
    userBuyAmountB: pair.userBuyAmountB.toString(),
    expiresAt: pair.expiresAt,
  };
}

export function deserializeMatchedIntentPair(value: unknown): GhostWalletMatchedIntentPair {
  const row = value as any;
  if (!row || typeof row !== 'object') throw new Error('Ghost Wallet persisted matched pair is missing');
  const pair: GhostWalletMatchedIntentPair = {
    pairId: String(row.pairId || ''),
    chain: String(row.chain || '').trim().toLowerCase(),
    chainId: Number(row.chainId),
    intermediary: String(row.intermediary || ''),
    intentA: deserializeIntent(row.intentA),
    intentB: deserializeIntent(row.intentB),
    feeBpsA: Number(row.feeBpsA),
    feeBpsB: Number(row.feeBpsB),
    feeAmountA: parsePositiveIntegerString('feeAmountA', String(row.feeAmountA ?? '0'), true),
    feeAmountB: parsePositiveIntegerString('feeAmountB', String(row.feeAmountB ?? '0'), true),
    userBuyAmountA: parsePositiveIntegerString('userBuyAmountA', row.userBuyAmountA),
    userBuyAmountB: parsePositiveIntegerString('userBuyAmountB', row.userBuyAmountB),
    expiresAt: Number(row.expiresAt),
    apiKeyRequired: false,
    signupRequired: false,
    sameTransactionSettlement: true,
    repaymentFailureReverts: true,
    profitLadderAuthority: false,
  };
  if (!pair.pairId || !pair.chain || !Number.isSafeInteger(pair.chainId) || pair.chainId <= 0) {
    throw new Error('Ghost Wallet persisted matched pair identity is invalid');
  }
  if (!(pair.feeAmountA > 0n || pair.feeAmountB > 0n)) throw new Error('Ghost Wallet persisted pair has no positive intermediary fee');
  return pair;
}
