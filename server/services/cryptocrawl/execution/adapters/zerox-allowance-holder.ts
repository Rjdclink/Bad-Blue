import { ethers } from 'ethers';
import { fetchJsonWithRetry } from '../../utils/resilient-http.js';
import { zeroXRequestBudget } from '../../intelligence/zerox-request-budget.js';
import type { SupportedExecutionChain } from './onchain-payload-builder.js';

const CANCUN_ALLOWANCE_HOLDER = '0x0000000000001fF3684f28c67538d4D072C22734';
const SHANGHAI_ALLOWANCE_HOLDER = '0x0000000000005E88410CcDFaDe4a5EfaE4b49562';

const CANCUN_CHAINS = new Set<SupportedExecutionChain>([
  'ethereum',
  'polygon',
  'arbitrum',
  'optimism',
  'bsc',
  'avalanche',
]);

export interface ZeroXFirmQuote {
  chain: SupportedExecutionChain;
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  minBuyAmount: string;
  allowanceTarget: string;
  transaction: {
    to: string;
    data: string;
    value: string;
    gas: string | null;
    gasPrice: string | null;
  };
  routeSources: string[];
  simulationIncomplete: boolean;
  balanceIssue: boolean;
  taxEvidenceComplete: boolean;
  observedAt: number;
  zid: string | null;
}

function requireAddress(label: string, raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!ethers.utils.isAddress(value)) throw new Error(`${label} must be a valid EVM address`);
  return ethers.utils.getAddress(value);
}

function requireInteger(label: string, raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new Error(`${label} must be a positive integer string`);
  return value;
}

function requireHexData(label: string, raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!/^0x(?:[a-fA-F0-9]{2})+$/.test(value)) throw new Error(`${label} must be non-empty hex calldata`);
  return value;
}

function boundedPpm(raw: unknown): number {
  const value = Number(raw);
  const normalized = Number.isFinite(value) ? Math.trunc(value) : 10_000; // 100 BPS default quote tolerance.
  return Math.max(0, Math.min(100_000, normalized)); // hard safety ceiling = 10%.
}

export function resolveZeroXAllowanceHolder(chain: SupportedExecutionChain): string | null {
  if (CANCUN_CHAINS.has(chain)) return CANCUN_ALLOWANCE_HOLDER;
  // Europa is not a 0x-supported production execution chain. Mantle is not in
  // SupportedExecutionChain today; the Shanghai address remains documented here
  // only so adding Mantle later requires an explicit chain-model change.
  void SHANGHAI_ALLOWANCE_HOLDER;
  return null;
}

function taxValue(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function taxEvidenceComplete(payload: any): boolean {
  const buy = payload?.tokenMetadata?.buyToken;
  const sell = payload?.tokenMetadata?.sellToken;
  if (!buy || !sell) return false;
  return [
    buy.buyTaxBps,
    buy.sellTaxBps,
    buy.transferTaxBps,
    sell.buyTaxBps,
    sell.sellTaxBps,
    sell.transferTaxBps,
  ].every(value => taxValue(value) !== null);
}

function routeSources(payload: any): string[] {
  const fills = Array.isArray(payload?.route?.fills) ? payload.route.fills : [];
  return [...new Set(fills
    .map((fill: any) => typeof fill?.source === 'string' ? fill.source.trim() : '')
    .filter(Boolean))];
}

export async function fetchZeroXAllowanceHolderFirmQuote(input: {
  chain: SupportedExecutionChain;
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  taker: string;
  txOrigin: string;
  recipient?: string;
  sellEntireBalance?: boolean;
  slippagePpm?: number;
}): Promise<ZeroXFirmQuote> {
  const apiKey = process.env.ZEROX_API_KEY?.trim();
  if (!apiKey) throw new Error('ZEROX_API_KEY is not configured');
  const allowanceHolder = resolveZeroXAllowanceHolder(input.chain);
  if (!allowanceHolder) throw new Error(`0x AllowanceHolder is not approved for ${input.chain}`);

  const sellToken = requireAddress('0x sellToken', input.sellToken);
  const buyToken = requireAddress('0x buyToken', input.buyToken);
  const taker = requireAddress('0x taker', input.taker);
  const txOrigin = requireAddress('0x txOrigin', input.txOrigin);
  const recipient = requireAddress('0x recipient', input.recipient || taker);
  const sellAmount = requireInteger('0x sellAmount', input.sellAmount);
  const slippagePpm = boundedPpm(input.slippagePpm ?? process.env.ZEROX_ATOMIC_SLIPPAGE_PPM);

  const admission = zeroXRequestBudget.tryAcquire('execution');
  if (!admission.allowed) throw new Error(admission.reason);
  try {
    const params = new URLSearchParams({
      chainId: String(input.chainId),
      sellToken,
      buyToken,
      sellAmount,
      taker,
      txOrigin,
      recipient,
      slippagePpm: String(slippagePpm),
      ...(input.sellEntireBalance ? { sellEntireBalance: 'true' } : {}),
    });
    const payload = await fetchJsonWithRetry<any>(
      `https://api.0x.org/swap/allowance-holder/quote?${params.toString()}`,
      {
        init: {
          headers: {
            accept: 'application/json',
            '0x-api-key': apiKey,
            '0x-version': 'v2',
          },
        },
        maxRetries: 1,
        baseDelayMs: 150,
        maxDelayMs: 750,
        timeoutMs: Math.max(1_000, Math.min(6_000, Number(process.env.ZEROX_ATOMIC_QUOTE_TIMEOUT_MS || 3_000))),
      },
    );

    if (payload?.liquidityAvailable !== true) throw new Error('0x firm quote reported no usable liquidity');
    const target = requireAddress('0x transaction.to', payload?.transaction?.to);
    const allowanceTarget = requireAddress(
      '0x allowance target',
      payload?.issues?.allowance?.spender || payload?.allowanceTarget || target,
    );
    if (target.toLowerCase() !== allowanceHolder.toLowerCase()) {
      throw new Error(`0x returned unexpected AllowanceHolder entry point ${target}`);
    }
    if (allowanceTarget.toLowerCase() !== allowanceHolder.toLowerCase()) {
      throw new Error(`0x returned unexpected allowance spender ${allowanceTarget}`);
    }

    const value = String(payload?.transaction?.value ?? '0');
    if (!/^\d+$/.test(value) || BigInt(value) !== 0n) {
      throw new Error('0x atomic flash-loan route requires an ERC20-only zero-native-value transaction');
    }

    const quote: ZeroXFirmQuote = {
      chain: input.chain,
      chainId: input.chainId,
      sellToken,
      buyToken,
      sellAmount: requireInteger('0x response sellAmount', payload?.sellAmount || sellAmount),
      buyAmount: requireInteger('0x buyAmount', payload?.buyAmount),
      minBuyAmount: requireInteger('0x minBuyAmount', payload?.minBuyAmount),
      allowanceTarget,
      transaction: {
        to: target,
        data: requireHexData('0x transaction.data', payload?.transaction?.data),
        value: '0',
        gas: /^\d+$/.test(String(payload?.transaction?.gas ?? '')) ? String(payload.transaction.gas) : null,
        gasPrice: /^\d+$/.test(String(payload?.transaction?.gasPrice ?? '')) ? String(payload.transaction.gasPrice) : null,
      },
      routeSources: routeSources(payload),
      simulationIncomplete: payload?.issues?.simulationIncomplete === true,
      balanceIssue: payload?.issues?.balance != null,
      taxEvidenceComplete: taxEvidenceComplete(payload),
      observedAt: Date.now(),
      zid: typeof payload?.zid === 'string' ? payload.zid : null,
    };

    if (!quote.taxEvidenceComplete) {
      throw new Error('0x token tax evidence is incomplete; atomic execution fails closed');
    }
    return quote;
  } finally {
    admission.release();
  }
}

export function maxSellAmountForDependentLeg(expectedAmount: string, slippagePpm?: number): string {
  const expected = BigInt(requireInteger('expected dependent-leg amount', expectedAmount));
  const ppm = BigInt(boundedPpm(slippagePpm ?? process.env.ZEROX_ATOMIC_SLIPPAGE_PPM));
  return (expected + ((expected * ppm + 999_999n) / 1_000_000n)).toString();
}
