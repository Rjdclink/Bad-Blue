import { ethers } from 'ethers';
import { ERC20_ABI, SUPPORTED_CHAINS } from './chain-config.js';
import type { ChainId } from './types.js';

export interface AcrossBridgeQuote {
  provider: 'across';
  quoteId: string | null;
  originChain: ChainId;
  destinationChain: ChainId;
  token: 'USDC' | 'USDT';
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  expectedOutputAmount: string;
  minOutputAmount: string | null;
  tokenDecimals: number;
  expectedFillTimeSec: number;
  quoteExpiryTimestamp: number;
  simulationSuccess: boolean;
  originGasUsd: number | null;
  totalFeeUsd: number | null;
  approvalTransactions: number;
  swapTransactionPresent: boolean;
  observedAt: number;
  expiresAt: number;
  provenance: string[];
}

export interface AcrossReadiness {
  configured: boolean;
  reason: string;
}

function config(): { apiKey: string; integratorId: string; depositor: string } | null {
  const apiKey = process.env.ACROSS_API_KEY?.trim();
  const integratorId = process.env.ACROSS_INTEGRATOR_ID?.trim();
  const depositor = (process.env.CRYPTOCRAWL_ACROSS_DEPOSITOR_ADDRESS || process.env.BRIDGE_WALLET_ADDRESS || '').trim();
  if (!apiKey || !integratorId || !/^0x[0-9a-fA-F]{4}$/.test(integratorId) || !/^0x[0-9a-fA-F]{40}$/.test(depositor)) return null;
  return { apiKey, integratorId, depositor };
}

function tokenAddress(chain: ChainId, token: 'USDC' | 'USDT'): string {
  return token === 'USDC' ? SUPPORTED_CHAINS[chain].usdc : SUPPORTED_CHAINS[chain].usdt;
}

async function tokenDecimals(chain: ChainId, token: 'USDC' | 'USDT'): Promise<number> {
  const provider = new ethers.providers.JsonRpcProvider(SUPPORTED_CHAINS[chain].rpcUrl);
  const contract = new ethers.Contract(tokenAddress(chain, token), ERC20_ABI, provider);
  const decimals = Number(await contract.decimals());
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error(`Invalid token decimals for ${chain}:${token}`);
  return decimals;
}

function amountUsd(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function quoteFeeUsd(payload: any): number | null {
  return amountUsd(payload?.fees?.total?.amountUsd)
    ?? amountUsd(payload?.fees?.totalFeeUsd)
    ?? null;
}

export function getAcrossBridgeReadiness(): AcrossReadiness {
  return config()
    ? { configured: true, reason: 'Across API key, 2-byte integrator ID, and depositor address are visible' }
    : { configured: false, reason: 'Across remains optional until ACROSS_API_KEY, ACROSS_INTEGRATOR_ID, and a depositor address are configured' };
}

export async function getAcrossBridgeQuote(input: {
  originChain: ChainId;
  destinationChain: ChainId;
  token: 'USDC' | 'USDT';
  amountHuman: number;
}): Promise<AcrossBridgeQuote | null> {
  const credentials = config();
  if (!credentials) return null;
  if (input.originChain === input.destinationChain) return null;
  if (!(input.amountHuman > 0) || !Number.isFinite(input.amountHuman)) return null;

  const decimals = await tokenDecimals(input.originChain, input.token);
  const outputDecimals = await tokenDecimals(input.destinationChain, input.token);
  if (decimals !== outputDecimals) return null;
  const amount = ethers.utils.parseUnits(input.amountHuman.toFixed(Math.min(decimals, 8)), decimals).toString();
  const origin = SUPPORTED_CHAINS[input.originChain];
  const destination = SUPPORTED_CHAINS[input.destinationChain];
  const params = new URLSearchParams({
    tradeType: 'exactInput',
    amount,
    inputToken: tokenAddress(input.originChain, input.token),
    outputToken: tokenAddress(input.destinationChain, input.token),
    originChainId: String(origin.chainId),
    destinationChainId: String(destination.chainId),
    depositor: credentials.depositor,
    recipient: credentials.depositor,
    refundAddress: credentials.depositor,
    integratorId: credentials.integratorId,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(3_000, Number(process.env.ACROSS_QUOTE_TIMEOUT_MS || 8_000)));
  try {
    const response = await fetch(`https://app.across.to/api/swap/approval?${params.toString()}`, {
      method: 'GET',
      headers: { accept: 'application/json', Authorization: `Bearer ${credentials.apiKey}` },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: any = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { /* handled below */ }
    if (!response.ok) throw new Error(`Across quote failed (${response.status})${payload?.message ? `: ${payload.message}` : ''}`);
    const expectedOutputAmount = typeof payload?.expectedOutputAmount === 'string' ? payload.expectedOutputAmount : null;
    const expectedFillTimeSec = Number(payload?.expectedFillTime);
    const quoteExpiryTimestamp = Number(payload?.quoteExpiryTimestamp);
    if (!expectedOutputAmount || !Number.isFinite(expectedFillTimeSec) || expectedFillTimeSec < 0 || !Number.isFinite(quoteExpiryTimestamp)) {
      throw new Error('Across quote response missing required output/fill/expiry evidence');
    }
    const observedAt = Date.now();
    const expiresAt = quoteExpiryTimestamp * 1000;
    if (expiresAt <= observedAt) return null;
    return {
      provider: 'across',
      quoteId: typeof payload?.id === 'string' ? payload.id : null,
      originChain: input.originChain,
      destinationChain: input.destinationChain,
      token: input.token,
      inputToken: tokenAddress(input.originChain, input.token),
      outputToken: tokenAddress(input.destinationChain, input.token),
      inputAmount: amount,
      expectedOutputAmount,
      minOutputAmount: typeof payload?.minOutputAmount === 'string' ? payload.minOutputAmount : null,
      tokenDecimals: decimals,
      expectedFillTimeSec,
      quoteExpiryTimestamp,
      simulationSuccess: payload?.swapTx?.simulationSuccess === true,
      originGasUsd: amountUsd(payload?.fees?.originGas?.amountUsd),
      totalFeeUsd: quoteFeeUsd(payload),
      approvalTransactions: Array.isArray(payload?.approvalTxns) ? payload.approvalTxns.length : 0,
      swapTransactionPresent: !!(payload?.swapTx?.to && payload?.swapTx?.data),
      observedAt,
      expiresAt,
      provenance: [
        'across_swap_api',
        'swap_approval_quote',
        'fresh_cross_chain_fee_and_fill_time',
        'provider_simulation_status',
      ],
    };
  } finally {
    clearTimeout(timeout);
  }
}
