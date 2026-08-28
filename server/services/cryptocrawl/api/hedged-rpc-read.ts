import logger from '../../../logger.js';
import { multiProviderRpcManager, type SupportedChain } from './blockchain-providers.js';

const READ_ONLY_METHODS = new Set([
  'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBalance', 'eth_call', 'eth_getCode',
  'eth_getLogs', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_gasPrice', 'eth_feeHistory',
]);
const CHAIN_IDS: Record<SupportedChain, number> = {
  ethereum: 1, polygon: 137, arbitrum: 42161, optimism: 10, base: 8453, avalanche: 43114, bsc: 56,
};
interface ProviderBudget { windowStartedAt: number; requests: number; inFlight: number; }
const budgets = new Map<string, ProviderBudget>();

export interface HedgedRpcReadOptions<T> {
  validate?: (value: unknown) => value is T;
  quorum?: 1 | 2;
  deadlineMs?: number;
  hedgeDelayMs?: number;
  maxProviders?: number;
}
export interface HedgedRpcReadResult<T> {
  result: T;
  provider: string;
  providersConsulted: string[];
  chain: SupportedChain;
  method: string;
  observedAt: number;
  latencyMs: number;
  quorum: number;
  authority: 'validated_read_only';
}

function budgetFor(provider: string): ProviderBudget {
  const now = Date.now();
  const current = budgets.get(provider);
  if (!current || now - current.windowStartedAt >= 60_000) {
    const next = { windowStartedAt: now, requests: 0, inFlight: 0 };
    budgets.set(provider, next);
    return next;
  }
  return current;
}
function canSpend(provider: string): boolean {
  const budget = budgetFor(provider);
  const maxPerMinute = Math.max(1, Number(process.env.CRYPTO_RPC_HEDGE_REQUESTS_PER_PROVIDER_MINUTE || 600));
  const maxInFlight = Math.max(1, Number(process.env.CRYPTO_RPC_HEDGE_MAX_INFLIGHT_PER_PROVIDER || 16));
  return budget.requests + 2 <= maxPerMinute && budget.inFlight < maxInFlight;
}
function beginSpend(provider: string): void {
  const budget = budgetFor(provider);
  budget.requests += 2; // chain identity + requested read
  budget.inFlight += 1;
}
function endSpend(provider: string): void {
  budgetFor(provider).inFlight = Math.max(0, budgetFor(provider).inFlight - 1);
}
function defaultShape(method: string, value: unknown): boolean {
  if (method === 'eth_blockNumber' || method === 'eth_getBalance' || method === 'eth_gasPrice') return typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value);
  if (method === 'eth_getCode') return typeof value === 'string' && /^0x[0-9a-f]*$/i.test(value);
  if (method === 'eth_getLogs' || method === 'eth_feeHistory') return value !== null && typeof value === 'object';
  if (method === 'eth_call') return typeof value === 'string' && /^0x[0-9a-f]*$/i.test(value);
  return value === null || typeof value === 'object';
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
async function rpcCall(url: string, method: string, params: unknown[], controller: AbortController, timeoutMs: number): Promise<unknown> {
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as any;
    if (payload?.error) throw new Error(`RPC ${payload.error.code ?? 'error'}: ${payload.error.message ?? 'unknown'}`);
    if (!('result' in (payload || {}))) throw new Error('RPC response has no result');
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}
async function validatedProviderRead<T>(input: {
  provider: string; url: string; chain: SupportedChain; method: string; params: unknown[]; timeoutMs: number; validate?: (value: unknown) => value is T; controller: AbortController;
}): Promise<{ provider: string; value: T; latencyMs: number }> {
  if (!canSpend(input.provider)) throw new Error(`Provider hedge budget exhausted for ${input.provider}`);
  beginSpend(input.provider);
  const startedAt = Date.now();
  try {
    const chainValue = await rpcCall(input.url, 'eth_chainId', [], input.controller, input.timeoutMs);
    const chainId = typeof chainValue === 'string' ? Number.parseInt(chainValue, 16) : NaN;
    if (chainId !== CHAIN_IDS[input.chain]) throw new Error(`Chain identity mismatch expected=${CHAIN_IDS[input.chain]} actual=${chainId}`);
    const value = await rpcCall(input.url, input.method, input.params, input.controller, input.timeoutMs);
    if (!defaultShape(input.method, value)) throw new Error('RPC response shape failed validation');
    if (input.validate && !input.validate(value)) throw new Error('RPC operation-specific validation failed');
    return { provider: input.provider, value: value as T, latencyMs: Date.now() - startedAt };
  } finally {
    endSpend(input.provider);
  }
}

export async function hedgedRpcRead<T = unknown>(
  chain: SupportedChain,
  method: string,
  params: unknown[] = [],
  options: HedgedRpcReadOptions<T> = {},
): Promise<HedgedRpcReadResult<T>> {
  if (!READ_ONLY_METHODS.has(method)) throw new Error(`Hedged RPC forbids non-read-only method ${method}`);
  const deadlineMs = Math.max(250, Number(options.deadlineMs || process.env.CRYPTO_RPC_HEDGE_DEADLINE_MS || 5_000));
  const maxProviders = Math.max(1, Math.min(3, Number(options.maxProviders || process.env.CRYPTO_RPC_HEDGE_WIDTH || 3)));
  const quorum = options.quorum === 2 ? 2 : 1;
  const healthy = multiProviderRpcManager.getHealth(chain)
    .filter(item => item.http.success && item.httpUrl && canSpend(item.provider))
    .sort((left, right) => (left.http.latencyMs ?? Number.MAX_SAFE_INTEGER) - (right.http.latencyMs ?? Number.MAX_SAFE_INTEGER))
    .slice(0, maxProviders);
  if (healthy.length < quorum) throw new Error(`Hedged RPC has only ${healthy.length} eligible providers for quorum=${quorum}`);

  const learnedBase = healthy[0]?.http.latencyMs ?? 100;
  const hedgeDelayMs = Math.max(0, Number(options.hedgeDelayMs ?? process.env.CRYPTO_RPC_HEDGE_DELAY_MS ?? Math.min(250, Math.max(25, learnedBase * 0.6))));
  const controllers = healthy.map(() => new AbortController());
  const consulted: string[] = [];
  const startedAt = Date.now();

  return new Promise<HedgedRpcReadResult<T>>((resolve, reject) => {
    let settled = false;
    let completed = 0;
    const successes: Array<{ provider: string; value: T; latencyMs: number }> = [];
    const errors: string[] = [];
    const finishFailure = () => {
      if (settled || completed < healthy.length) return;
      settled = true;
      reject(new Error(`All hedged RPC reads failed validation for ${chain}/${method}: ${errors.join('; ')}`));
    };
    const accept = (success: { provider: string; value: T; latencyMs: number }) => {
      successes.push(success);
      if (quorum === 1) {
        settled = true;
        controllers.forEach(controller => controller.abort());
        resolve({ result: success.value, provider: success.provider, providersConsulted: [...consulted], chain, method, observedAt: Date.now(), latencyMs: Date.now() - startedAt, quorum: 1, authority: 'validated_read_only' });
        return;
      }
      const normalized = stableJson(success.value);
      const agreeing = successes.filter(item => stableJson(item.value) === normalized);
      if (agreeing.length >= quorum) {
        settled = true;
        controllers.forEach(controller => controller.abort());
        resolve({ result: success.value, provider: agreeing.map(item => item.provider).join('+'), providersConsulted: [...consulted], chain, method, observedAt: Date.now(), latencyMs: Date.now() - startedAt, quorum, authority: 'validated_read_only' });
      }
    };

    healthy.forEach((candidate, index) => {
      const delay = index === 0 ? 0 : hedgeDelayMs * index;
      const timer = setTimeout(() => {
        if (settled) return;
        consulted.push(candidate.provider);
        void validatedProviderRead<T>({ provider: candidate.provider, url: candidate.httpUrl, chain, method, params, timeoutMs: Math.max(250, deadlineMs - delay), validate: options.validate, controller: controllers[index] })
          .then(result => { completed++; if (!settled) accept(result); finishFailure(); })
          .catch(error => { completed++; if (!settled) errors.push(`${candidate.provider}:${error instanceof Error ? error.message : String(error)}`); finishFailure(); });
      }, delay);
      timer.unref?.();
    });

    const deadline = setTimeout(() => {
      if (settled) return;
      settled = true;
      controllers.forEach(controller => controller.abort());
      reject(new Error(`Hedged RPC deadline exceeded for ${chain}/${method}`));
    }, deadlineMs);
    deadline.unref?.();
  }).catch(error => {
    logger.warn('[RPC Hedge] validated read failed closed', { component: 'HedgedRpcRead', chain, method, error: error instanceof Error ? error.message : String(error), fabricatedFallback: false });
    throw error;
  });
}

export function getHedgedRpcReadHealth() {
  return {
    allowedMethods: [...READ_ONLY_METHODS],
    mutatingMethodsAllowed: false as const,
    orderSubmissionAllowed: false as const,
    fabricatedFallbackAllowed: false as const,
    providerBudgets: [...budgets.entries()].map(([provider,budget]) => ({ provider, ...budget })),
    authority: 'validated_read_only' as const,
  };
}
