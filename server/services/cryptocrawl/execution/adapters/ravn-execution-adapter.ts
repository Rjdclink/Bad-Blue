import type { SupportedExecutionChain } from './onchain-payload-builder.js';

const DEFAULT_RAVN_API_BASE = 'https://app.ravn.exchange/api/v1';

const RAVN_CHAIN_IDS: Partial<Record<SupportedExecutionChain, number>> = {
  ethereum: 1,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  bsc: 56,
  avalanche: 43114,
};

export type RavnExecutionType = 'TRANSACTION' | 'SIGNATURE' | 'DEPOSIT';

export interface RavnQuoteRequest {
  chain: SupportedExecutionChain;
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  userAddress: string;
  destinationAddress?: string;
  refundAddress?: string;
  slippageBps?: number;
  timeoutMs?: number;
}

export interface RavnQuoteSnapshot {
  quoteToken: string;
  venueId: string | null;
  venueName: string | null;
  inputAmount: string;
  outputAmount: string;
  feeBps: number;
  feeAmount: string;
  gasUsd: number | null;
  gasless: boolean;
  expiresAt: number;
  observedAt: number;
  requestId: string | null;
}

export interface RavnExecutionInspection {
  executionType: RavnExecutionType;
  atomicFlashCompatible: boolean;
  solverPaysParentGas: boolean;
  requiresParentTransactionGas: boolean;
  reason: string;
  transaction?: {
    to: string;
    data: string;
    value: string;
    chainId: number;
  };
  raw: unknown;
}

type RavnEnvelope = {
  data?: any;
  error?: { code?: string; message?: string; details?: unknown };
  meta?: { requestId?: string };
};

function apiBase(environment: NodeJS.ProcessEnv = process.env): string {
  return String(environment.RAVN_API_BASE_URL || DEFAULT_RAVN_API_BASE).replace(/\/+$/, '');
}

function optionalApiKey(environment: NodeJS.ProcessEnv = process.env): string | null {
  const value = String(environment.RAVN_API_KEY || '').trim();
  return value || null;
}

function positiveIntegerString(label: string, value: string): string {
  const normalized = String(value || '').trim();
  if (!/^\d+$/.test(normalized) || BigInt(normalized) <= 0n) {
    throw new Error(`${label} must be a positive integer string in token base units`);
  }
  return normalized;
}

function requireEvmAddress(label: string, value: string): string {
  const normalized = String(value || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) throw new Error(`${label} must be a valid EVM address`);
  return normalized;
}

function timeoutMs(raw: number | undefined): number {
  const value = Number(raw ?? process.env.RAVN_EXECUTION_CHECK_TIMEOUT_MS ?? 800);
  return Number.isFinite(value) ? Math.max(100, Math.min(3_000, Math.trunc(value))) : 800;
}

async function postRavn(path: string, body: unknown, timeout: number): Promise<RavnEnvelope> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  timer.unref?.();
  try {
    const key = optionalApiKey();
    const response = await fetch(`${apiBase()}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(key ? { 'x-api-key': key } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const parsed = await response.json().catch(() => ({})) as RavnEnvelope;
    if (!response.ok || parsed.error) {
      const code = parsed.error?.code || `HTTP_${response.status}`;
      const message = parsed.error?.message || response.statusText || 'RAVN request failed';
      throw new Error(`RAVN ${path} ${code}: ${message}`);
    }
    if (!parsed.data) throw new Error(`RAVN ${path} returned no data`);
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Execution-time quote only. This adapter is intentionally not called from the
 * continuous APE quote loop because anonymous RAVN access is request-rate-limited.
 * Provider failure is local and callers must retain their existing route/fallback.
 */
export async function quoteRavnAtExecutionBoundary(input: RavnQuoteRequest): Promise<RavnQuoteSnapshot> {
  const chainId = RAVN_CHAIN_IDS[input.chain];
  if (!chainId) throw new Error(`RAVN execution check does not support ${input.chain}`);
  const slippageBps = Number(input.slippageBps);
  const request = {
    inputChainId: chainId,
    outputChainId: chainId,
    inputToken: requireEvmAddress('inputToken', input.inputToken),
    outputToken: requireEvmAddress('outputToken', input.outputToken),
    inputAmount: positiveIntegerString('inputAmount', input.inputAmount),
    userAddress: requireEvmAddress('userAddress', input.userAddress),
    ...(input.destinationAddress ? { destinationAddress: requireEvmAddress('destinationAddress', input.destinationAddress) } : {}),
    ...(input.refundAddress ? { refundAddress: requireEvmAddress('refundAddress', input.refundAddress) } : {}),
    ...(Number.isFinite(slippageBps) ? { slippageBps: Math.max(1, Math.min(5_000, Math.trunc(slippageBps))) } : {}),
    rankingMode: 'best_output',
  };
  const response = await postRavn('/quote', request, timeoutMs(input.timeoutMs));
  const data = response.data;
  const feeBps = Number(data?.fee?.bps ?? Number.NaN);
  const gasUsd = data?.gas?.usd === null || data?.gas?.usd === undefined ? null : Number(data.gas.usd);
  const expiresAt = Number(data?.expiresAt);
  const quoteToken = String(data?.quoteToken || '');
  const inputAmount = String(data?.input?.amount ?? input.inputAmount);
  const outputAmount = String(data?.output?.amount ?? '');
  if (!quoteToken || !/^\d+$/.test(inputAmount) || !/^\d+$/.test(outputAmount)) {
    throw new Error('RAVN quote response is incomplete');
  }
  if (!Number.isFinite(feeBps) || feeBps < 0) throw new Error('RAVN quote fee.bps is invalid');
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('RAVN quote is already expired');
  return {
    quoteToken,
    venueId: data?.venue?.id ? String(data.venue.id) : null,
    venueName: data?.venue?.name ? String(data.venue.name) : null,
    inputAmount,
    outputAmount,
    feeBps,
    feeAmount: String(data?.fee?.amount ?? '0'),
    gasUsd: gasUsd !== null && Number.isFinite(gasUsd) ? gasUsd : null,
    gasless: data?.gas === null,
    expiresAt,
    observedAt: Date.now(),
    requestId: response.meta?.requestId ? String(response.meta.requestId) : null,
  };
}

/**
 * Converts an opaque RAVN quote into a payload only for compatibility inspection.
 * It never signs, submits, broadcasts, approves, deposits, or changes canonical
 * execution authority.
 */
export async function inspectRavnExecution(
  quote: Pick<RavnQuoteSnapshot, 'quoteToken'>,
  expectedChain: SupportedExecutionChain,
  timeoutOverrideMs?: number,
): Promise<RavnExecutionInspection> {
  const expectedChainId = RAVN_CHAIN_IDS[expectedChain];
  if (!expectedChainId) throw new Error(`RAVN execution inspection does not support ${expectedChain}`);
  const response = await postRavn('/execute', { quoteToken: quote.quoteToken }, timeoutMs(timeoutOverrideMs));
  const data = response.data;
  const executionType = String(data?.executionType || '') as RavnExecutionType;

  if (executionType === 'SIGNATURE') {
    return {
      executionType,
      atomicFlashCompatible: false,
      solverPaysParentGas: true,
      requiresParentTransactionGas: false,
      reason: 'RAVN SIGNATURE execution is gasless to the signer but settles in an external solver transaction; flash principal is not proven borrowed and repaid atomically inside the canonical receiver transaction',
      raw: data,
    };
  }

  if (executionType === 'DEPOSIT') {
    return {
      executionType,
      atomicFlashCompatible: false,
      solverPaysParentGas: false,
      requiresParentTransactionGas: true,
      reason: 'RAVN DEPOSIT execution requires transferring origin assets before settlement and cannot prove same-transaction flash repayment',
      raw: data,
    };
  }

  if (executionType === 'TRANSACTION') {
    const transaction = data?.transaction;
    const to = String(transaction?.to || '');
    const calldata = String(transaction?.data || '');
    const value = String(transaction?.value ?? '0');
    const chainId = Number(transaction?.chainId);
    const shapeValid = /^0x[a-fA-F0-9]{40}$/.test(to)
      && /^0x[a-fA-F0-9]*$/.test(calldata)
      && /^\d+$/.test(value)
      && chainId === expectedChainId;
    return {
      executionType,
      // A valid transaction shape is only potentially callable from the receiver.
      // It is not promoted here because approval/spender semantics and atomic
      // repayment still require exact receiver simulation at the canonical executor.
      atomicFlashCompatible: false,
      solverPaysParentGas: false,
      requiresParentTransactionGas: true,
      reason: shapeValid
        ? 'RAVN TRANSACTION payload has a same-chain callable shape, but it is not gasless and requires exact receiver-level approval/repayment simulation before atomic compatibility can be proven'
        : 'RAVN TRANSACTION payload is not a valid same-chain callable shape for the canonical receiver',
      ...(shapeValid ? { transaction: { to, data: calldata, value, chainId } } : {}),
      raw: data,
    };
  }

  throw new Error(`Unsupported RAVN execution type: ${String(data?.executionType)}`);
}

export function ravnChainId(chain: SupportedExecutionChain): number | null {
  return RAVN_CHAIN_IDS[chain] ?? null;
}
