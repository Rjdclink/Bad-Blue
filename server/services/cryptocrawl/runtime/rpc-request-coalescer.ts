import { createHash } from 'node:crypto';
import { ethers } from 'ethers';
import type { SupportedChain } from '../api/blockchain-providers.js';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
  chain: SupportedChain | null;
  blockScoped: boolean;
}

interface RpcCoalescerTelemetry {
  logicalRequests: number;
  physicalRequests: number;
  singleflightJoins: number;
  residentHits: number;
  blockInvalidations: number;
  cachedEntries: number;
  inFlightEntries: number;
}

const MAX_CACHE_ENTRIES = 5_000;
const BLOCK_NUMBER_TTL_MS = 250;
const LATEST_STATE_FALLBACK_TTL_MS = 2_000;
const IMMUTABLE_READ_TTL_MS = 60_000;
const STATIC_READ_TTL_MS = 5 * 60_000;

const chainIds: Record<SupportedChain, number> = {
  ethereum: 1,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
  avalanche: 43114,
  bsc: 56,
};
const chainById = new Map<number, SupportedChain>(Object.entries(chainIds).map(([chain, id]) => [id, chain as SupportedChain]));

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();
const endpointChain = new Map<string, SupportedChain>();
const latestBlockByChain = new Map<SupportedChain, number>();
const telemetry = {
  logicalRequests: 0,
  physicalRequests: 0,
  singleflightJoins: 0,
  residentHits: 0,
  blockInvalidations: 0,
};

let installed = false;
let originalSend: typeof ethers.providers.JsonRpcProvider.prototype.send | null = null;

function endpointFingerprint(provider: ethers.providers.JsonRpcProvider): string {
  const raw = String((provider as ethers.providers.JsonRpcProvider & { connection?: { url?: string } }).connection?.url || 'unknown');
  return createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

function stableParams(params: unknown[]): string {
  try {
    return JSON.stringify(params);
  } catch {
    return String(params);
  }
}

function requestKey(endpoint: string, method: string, params: unknown[]): string {
  return `${endpoint}:${method}:${createHash('sha256').update(stableParams(params)).digest('hex')}`;
}

function normalizeBlockTag(value: unknown): string {
  if (typeof value === 'string') return value.toLowerCase();
  return '';
}

function cachePolicy(method: string, params: unknown[]): { ttlMs: number; blockScoped: boolean } | null {
  if (method === 'eth_chainId' || method === 'net_version') return { ttlMs: STATIC_READ_TTL_MS, blockScoped: false };
  if (method === 'eth_blockNumber') return { ttlMs: BLOCK_NUMBER_TTL_MS, blockScoped: false };
  if (method === 'eth_getTransactionReceipt' || method === 'eth_getTransactionByHash') {
    return { ttlMs: 0, blockScoped: false };
  }
  if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') {
    return { ttlMs: LATEST_STATE_FALLBACK_TTL_MS, blockScoped: true };
  }
  if (method === 'eth_call') {
    const tag = normalizeBlockTag(params[1]);
    if (tag && tag !== 'latest' && tag !== 'pending' && tag !== 'safe' && tag !== 'finalized') {
      return { ttlMs: IMMUTABLE_READ_TTL_MS, blockScoped: false };
    }
    if (tag === 'pending') return { ttlMs: 0, blockScoped: false };
    return { ttlMs: LATEST_STATE_FALLBACK_TTL_MS, blockScoped: true };
  }
  if (method === 'eth_getBalance' || method === 'eth_getCode' || method === 'eth_getTransactionCount') {
    const tag = normalizeBlockTag(params[1]);
    if (tag && tag !== 'latest' && tag !== 'pending' && tag !== 'safe' && tag !== 'finalized') {
      return { ttlMs: IMMUTABLE_READ_TTL_MS, blockScoped: false };
    }
    if (tag === 'pending') return { ttlMs: 0, blockScoped: false };
    return { ttlMs: LATEST_STATE_FALLBACK_TTL_MS, blockScoped: true };
  }
  if (method === 'eth_getBlockByNumber') {
    const tag = normalizeBlockTag(params[0]);
    if (tag && tag !== 'latest' && tag !== 'pending' && tag !== 'safe' && tag !== 'finalized') {
      return { ttlMs: IMMUTABLE_READ_TTL_MS, blockScoped: false };
    }
    if (tag === 'pending') return { ttlMs: 0, blockScoped: false };
    return { ttlMs: LATEST_STATE_FALLBACK_TTL_MS, blockScoped: true };
  }
  return null;
}

function prune(now = Date.now()): void {
  for (const [key, entry] of cache) if (entry.expiresAt <= now) cache.delete(key);
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const overflow = cache.size - MAX_CACHE_ENTRIES;
  let removed = 0;
  for (const key of cache.keys()) {
    cache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function invalidateBlockScoped(chain: SupportedChain): void {
  let invalidated = 0;
  for (const [key, entry] of cache) {
    if (entry.blockScoped && entry.chain === chain) {
      cache.delete(key);
      invalidated += 1;
    }
  }
  if (invalidated > 0) telemetry.blockInvalidations += 1;
}

function learnChain(endpoint: string, rawChainId: unknown): SupportedChain | null {
  let numeric: number | null = null;
  if (typeof rawChainId === 'string' && /^0x[0-9a-f]+$/i.test(rawChainId)) numeric = Number.parseInt(rawChainId, 16);
  else if (typeof rawChainId === 'number' && Number.isFinite(rawChainId)) numeric = rawChainId;
  const chain = numeric === null ? null : chainById.get(numeric) || null;
  if (chain) endpointChain.set(endpoint, chain);
  return chain;
}

export function noteRpcChainBlock(chain: SupportedChain, blockNumber: number): void {
  if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) return;
  const previous = latestBlockByChain.get(chain);
  if (previous === blockNumber) return;
  latestBlockByChain.set(chain, blockNumber);
  if (previous !== undefined) invalidateBlockScoped(chain);
}

export function getRpcRequestCoalescerTelemetry(): RpcCoalescerTelemetry {
  return {
    ...telemetry,
    cachedEntries: cache.size,
    inFlightEntries: inFlight.size,
  };
}

export function installRpcRequestCoalescer(): void {
  if (installed) return;
  if (/^(0|false|off|no)$/i.test(String(process.env.CRYPTOCRAWL_RPC_COALESCER_ENABLED || 'true'))) return;
  installed = true;
  originalSend = ethers.providers.JsonRpcProvider.prototype.send;

  ethers.providers.JsonRpcProvider.prototype.send = async function coalescedSend(
    method: string,
    params: Array<any>,
  ): Promise<any> {
    const policy = cachePolicy(method, params || []);
    if (!policy || !originalSend) return originalSend!.call(this, method, params);

    telemetry.logicalRequests += 1;
    const endpoint = endpointFingerprint(this);
    const key = requestKey(endpoint, method, params || []);
    const now = Date.now();
    prune(now);

    if (policy.ttlMs > 0) {
      const resident = cache.get(key);
      if (resident && resident.expiresAt > now) {
        telemetry.residentHits += 1;
        return resident.value;
      }
    }

    const existing = inFlight.get(key);
    if (existing) {
      telemetry.singleflightJoins += 1;
      return existing;
    }

    telemetry.physicalRequests += 1;
    const pending = originalSend.call(this, method, params).then((value: unknown) => {
      let chain = endpointChain.get(endpoint) || null;
      if (method === 'eth_chainId') chain = learnChain(endpoint, value);
      if (method === 'eth_blockNumber' && chain) {
        const parsed = typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value)
          ? Number.parseInt(value, 16)
          : Number(value);
        if (Number.isSafeInteger(parsed) && parsed >= 0) noteRpcChainBlock(chain, parsed);
      }
      if (policy.ttlMs > 0) {
        cache.set(key, {
          value,
          expiresAt: Date.now() + policy.ttlMs,
          chain,
          blockScoped: policy.blockScoped,
        });
        prune();
      }
      return value;
    }).finally(() => {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    });

    inFlight.set(key, pending);
    return pending;
  };
}

export const RPC_REQUEST_COALESCER_POLICY = {
  canonicalProviderManagerPreserved: true,
  identicalReadSingleflight: true,
  blockScopedLatestStateCache: true,
  eventDrivenBlockInvalidationSupported: true,
  providerFailoverPreserved: true,
  transactionSubmissionCached: false,
  pendingStateCached: false,
  receiptResidentCaching: false,
  boundedCacheEntries: MAX_CACHE_ENTRIES,
  blockNumberTtlMs: BLOCK_NUMBER_TTL_MS,
  latestStateFallbackTtlMs: LATEST_STATE_FALLBACK_TTL_MS,
} as const;
