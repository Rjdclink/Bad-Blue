import { utils } from 'ethers';

export interface GhostWalletSignedIntent {
  chain: string;
  chainId: number;
  intermediary: string;
  owner: string;
  sellToken: string;
  buyToken: string;
  sellAmount: bigint;
  minBuyAmount: bigint;
  maxFeeBps: number;
  nonce: bigint;
  deadline: number;
  signature: string;
  receivedAt: number;
}

export interface GhostWalletMatchedIntentPair {
  pairId: string;
  chain: string;
  chainId: number;
  intermediary: string;
  intentA: GhostWalletSignedIntent;
  intentB: GhostWalletSignedIntent;
  feeBpsA: number;
  feeBpsB: number;
  feeAmountA: bigint;
  feeAmountB: bigint;
  userBuyAmountA: bigint;
  userBuyAmountB: bigint;
  expiresAt: number;
  apiKeyRequired: false;
  signupRequired: false;
  sameTransactionSettlement: true;
  repaymentFailureReverts: true;
  profitLadderAuthority: false;
}

const DOMAIN_NAME = 'CryptoCrawler Ghost Wallet';
const DOMAIN_VERSION = '1';
const INTENT_TYPES = {
  SignedIntent: [
    { name: 'owner', type: 'address' },
    { name: 'sellToken', type: 'address' },
    { name: 'buyToken', type: 'address' },
    { name: 'sellAmount', type: 'uint256' },
    { name: 'minBuyAmount', type: 'uint256' },
    { name: 'maxFeeBps', type: 'uint16' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

function normalizeChain(value: string): string {
  return value.trim().toLowerCase();
}

function address(value: string): string {
  return utils.getAddress(value.trim());
}

function intentKey(intent: GhostWalletSignedIntent): string {
  return `${intent.chainId}:${address(intent.intermediary).toLowerCase()}:${address(intent.owner).toLowerCase()}:${intent.nonce.toString()}`;
}

function oppositePair(left: GhostWalletSignedIntent, right: GhostWalletSignedIntent): boolean {
  return left.chainId === right.chainId
    && normalizeChain(left.chain) === normalizeChain(right.chain)
    && address(left.intermediary) === address(right.intermediary)
    && address(left.owner) !== address(right.owner)
    && address(left.sellToken) === address(right.buyToken)
    && address(left.buyToken) === address(right.sellToken)
    && address(left.sellToken) !== address(left.buyToken);
}

function maximumAffordableFeeBps(grossBuy: bigint, minimumBuy: bigint): number {
  if (grossBuy <= 0n || minimumBuy <= 0n || grossBuy < minimumBuy) return -1;
  const surplus = grossBuy - minimumBuy;
  return Number((surplus * 10_000n) / grossBuy);
}

function feeAmount(grossBuy: bigint, feeBps: number): bigint {
  return (grossBuy * BigInt(Math.max(0, Math.min(10_000, Math.trunc(feeBps))))) / 10_000n;
}

function normalizeIntent(input: GhostWalletSignedIntent): GhostWalletSignedIntent {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new Error('intent chainId must be a positive safe integer');
  if (!Number.isSafeInteger(input.deadline) || input.deadline <= 0) throw new Error('intent deadline must be a positive unix timestamp');
  if (!Number.isSafeInteger(input.receivedAt) || input.receivedAt <= 0) throw new Error('intent receivedAt must be a positive unix millisecond timestamp');
  if (!Number.isFinite(input.maxFeeBps) || input.maxFeeBps < 0 || input.maxFeeBps > 10_000) throw new Error('intent maxFeeBps must be between 0 and 10000');
  if (input.sellAmount <= 0n) throw new Error('intent sellAmount must be positive');
  if (input.minBuyAmount <= 0n) throw new Error('intent minBuyAmount must be positive');
  if (input.nonce < 0n) throw new Error('intent nonce cannot be negative');
  if (!utils.isHexString(input.signature, 65)) throw new Error('intent signature must be a 65-byte hex signature');
  return {
    ...input,
    chain: normalizeChain(input.chain),
    intermediary: address(input.intermediary),
    owner: address(input.owner),
    sellToken: address(input.sellToken),
    buyToken: address(input.buyToken),
    maxFeeBps: Math.trunc(input.maxFeeBps),
  };
}

function verifyIntentSignature(intent: GhostWalletSignedIntent): void {
  const recovered = utils.verifyTypedData(
    {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: intent.chainId,
      verifyingContract: intent.intermediary,
    },
    INTENT_TYPES,
    {
      owner: intent.owner,
      sellToken: intent.sellToken,
      buyToken: intent.buyToken,
      sellAmount: intent.sellAmount.toString(),
      minBuyAmount: intent.minBuyAmount.toString(),
      maxFeeBps: intent.maxFeeBps,
      nonce: intent.nonce.toString(),
      deadline: intent.deadline,
    },
    intent.signature,
  );
  if (recovered.toLowerCase() !== intent.owner.toLowerCase()) throw new Error('intent signature does not recover to owner');
}

export class GhostWalletIntentBook {
  private readonly intents = new Map<string, GhostWalletSignedIntent>();
  private readonly locallySettled = new Set<string>();

  register(input: GhostWalletSignedIntent, nowSeconds = Math.floor(Date.now() / 1000)): GhostWalletSignedIntent {
    const intent = normalizeIntent(input);
    if (intent.deadline <= nowSeconds) throw new Error('intent is expired');
    verifyIntentSignature(intent);
    const key = intentKey(intent);
    if (this.locallySettled.has(key)) throw new Error('intent nonce is already locally settled');
    this.intents.set(key, intent);
    return { ...intent };
  }

  remove(input: Pick<GhostWalletSignedIntent, 'chainId' | 'intermediary' | 'owner' | 'nonce'>): void {
    const key = `${input.chainId}:${address(input.intermediary).toLowerCase()}:${address(input.owner).toLowerCase()}:${input.nonce.toString()}`;
    this.intents.delete(key);
  }

  markSettled(pair: GhostWalletMatchedIntentPair): void {
    for (const intent of [pair.intentA, pair.intentB]) {
      const key = intentKey(intent);
      this.locallySettled.add(key);
      this.intents.delete(key);
    }
  }

  prune(nowSeconds = Math.floor(Date.now() / 1000)): number {
    let removed = 0;
    for (const [key, intent] of this.intents) {
      if (intent.deadline > nowSeconds) continue;
      this.intents.delete(key);
      removed += 1;
    }
    return removed;
  }

  getOpen(): GhostWalletSignedIntent[] {
    this.prune();
    return [...this.intents.values()].map(intent => ({ ...intent }));
  }

  match(nowSeconds = Math.floor(Date.now() / 1000)): GhostWalletMatchedIntentPair[] {
    this.prune(nowSeconds);
    const open = [...this.intents.values()];
    const used = new Set<string>();
    const pairs: GhostWalletMatchedIntentPair[] = [];

    // Do not add raw fee token amounts across different assets. Candidate ordering is
    // based only on dimensionless signed fee capacity plus urgency. Exact realized
    // token amounts remain in the pair and are reconciled on-chain.
    const candidates: Array<{
      left: GhostWalletSignedIntent;
      right: GhostWalletSignedIntent;
      feeBpsA: number;
      feeBpsB: number;
      scoreBps: number;
      expiresAt: number;
    }> = [];

    for (let leftIndex = 0; leftIndex < open.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < open.length; rightIndex++) {
        const left = open[leftIndex];
        const right = open[rightIndex];
        if (!oppositePair(left, right)) continue;
        const affordableA = maximumAffordableFeeBps(right.sellAmount, left.minBuyAmount);
        const affordableB = maximumAffordableFeeBps(left.sellAmount, right.minBuyAmount);
        if (affordableA < 0 || affordableB < 0) continue;
        const feeBpsA = Math.min(left.maxFeeBps, affordableA);
        const feeBpsB = Math.min(right.maxFeeBps, affordableB);
        const feeA = feeAmount(right.sellAmount, feeBpsA);
        const feeB = feeAmount(left.sellAmount, feeBpsB);
        if (feeA <= 0n && feeB <= 0n) continue;
        candidates.push({
          left,
          right,
          feeBpsA,
          feeBpsB,
          scoreBps: feeBpsA + feeBpsB,
          expiresAt: Math.min(left.deadline, right.deadline),
        });
      }
    }

    candidates.sort((a, b) => {
      if (a.expiresAt !== b.expiresAt) return a.expiresAt - b.expiresAt;
      if (a.scoreBps !== b.scoreBps) return b.scoreBps - a.scoreBps;
      const leftKey = `${intentKey(a.left)}:${intentKey(a.right)}`;
      const rightKey = `${intentKey(b.left)}:${intentKey(b.right)}`;
      return leftKey.localeCompare(rightKey);
    });

    for (const candidate of candidates) {
      const leftKey = intentKey(candidate.left);
      const rightKey = intentKey(candidate.right);
      if (used.has(leftKey) || used.has(rightKey)) continue;
      const feeAmountA = feeAmount(candidate.right.sellAmount, candidate.feeBpsA);
      const feeAmountB = feeAmount(candidate.left.sellAmount, candidate.feeBpsB);
      const userBuyAmountA = candidate.right.sellAmount - feeAmountA;
      const userBuyAmountB = candidate.left.sellAmount - feeAmountB;
      if (userBuyAmountA < candidate.left.minBuyAmount || userBuyAmountB < candidate.right.minBuyAmount) continue;
      if (feeAmountA <= 0n && feeAmountB <= 0n) continue;

      used.add(leftKey);
      used.add(rightKey);
      pairs.push({
        pairId: `cow:${leftKey}:${rightKey}`,
        chain: candidate.left.chain,
        chainId: candidate.left.chainId,
        intermediary: candidate.left.intermediary,
        intentA: { ...candidate.left },
        intentB: { ...candidate.right },
        feeBpsA: candidate.feeBpsA,
        feeBpsB: candidate.feeBpsB,
        feeAmountA,
        feeAmountB,
        userBuyAmountA,
        userBuyAmountB,
        expiresAt: candidate.expiresAt * 1000,
        apiKeyRequired: false,
        signupRequired: false,
        sameTransactionSettlement: true,
        repaymentFailureReverts: true,
        profitLadderAuthority: false,
      });
    }

    return pairs;
  }
}

export const ghostWalletIntentBook = new GhostWalletIntentBook();