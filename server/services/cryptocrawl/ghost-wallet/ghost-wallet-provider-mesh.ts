import { providers, utils } from 'ethers';
import logger from '../../../logger.js';
import { ghostWalletProviderSupportsSettlementLogs } from './ghost-wallet-log-policy.js';
import { recordGhostWalletPerformance } from './ghost-wallet-performance-intelligence.js';

export type GhostWalletChain = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'base' | 'bsc' | 'avalanche';
export type GhostWalletRpcOperationClass = 'read' | 'logs' | 'broadcast';

const CHAIN_IDS: Record<GhostWalletChain, number> = {
  ethereum: 1,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
  bsc: 56,
  avalanche: 43114,
};

const HTTP_PUBLIC: Record<GhostWalletChain, string[]> = {
  ethereum: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com'],
  polygon: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com'],
  arbitrum: ['https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc'],
  optimism: ['https://optimism-rpc.publicnode.com', 'https://mainnet.optimism.io'],
  base: ['https://base-rpc.publicnode.com', 'https://mainnet.base.org'],
  bsc: ['https://bsc-rpc.publicnode.com', 'https://bsc.drpc.org', 'https://bsc-dataseed.binance.org'],
  avalanche: ['https://avalanche-c-chain-rpc.publicnode.com', 'https://api.avax.network/ext/bc/C/rpc'],
};

const WS_PUBLIC: Partial<Record<GhostWalletChain, string[]>> = {
  ethereum: ['wss://ethereum-rpc.publicnode.com', 'wss://ethereum.drpc.org'],
  polygon: ['wss://polygon-bor-rpc.publicnode.com', 'wss://polygon.drpc.org'],
  arbitrum: ['wss://arbitrum-one-rpc.publicnode.com', 'wss://arbitrum.drpc.org'],
  optimism: ['wss://optimism-rpc.publicnode.com', 'wss://optimism.drpc.org'],
  base: ['wss://base-rpc.publicnode.com', 'wss://base.drpc.org'],
  bsc: ['wss://bsc-rpc.publicnode.com', 'wss://bsc.drpc.org'],
  avalanche: ['wss://avalanche-c-chain-rpc.publicnode.com', 'wss://avalanche.drpc.org'],
};

interface OperationHealth {
  ewmaLatencyMs: number;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  cooldownUntil: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
}

interface Candidate {
  label: string;
  url: string;
  provider: providers.JsonRpcProvider;
  latencyMs: number;
  operations: Record<GhostWalletRpcOperationClass, OperationHealth>;
}

function uniq(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function envHttp(chain: GhostWalletChain): string[] {
  const upper = chain.toUpperCase();
  const values = [
    process.env[`${upper}_RPC_URL`],
    ...(chain === 'ethereum' ? [process.env.ETHEREM_RPC_URL, process.env.RPC_URL, process.env.PRIVATE_RPC_URL] : []),
    ...(chain === 'bsc' ? [process.env.BNB_SMART_CHAIN_RPC_URL] : []),
  ];
  return uniq(values).filter(url => /^https?:\/\//i.test(url) && !/alchemy\.com/i.test(url));
}

function envWs(chain: GhostWalletChain): string[] {
  const upper = chain.toUpperCase();
  return uniq([
    process.env[`${upper}_WS_URL`],
    process.env[`${upper}_WEBSOCKET`],
    ...(chain === 'ethereum' ? [process.env.PRIVATE_WS_URL] : []),
  ]).filter(url => /^wss?:\/\//i.test(url) && !/alchemy\.com/i.test(url));
}

function infuraSlug(chain: GhostWalletChain): string | null {
  if (chain === 'ethereum') return 'mainnet';
  if (chain === 'polygon') return 'polygon-mainnet';
  if (chain === 'arbitrum') return 'arbitrum-mainnet';
  if (chain === 'optimism') return 'optimism-mainnet';
  if (chain === 'base') return 'base-mainnet';
  if (chain === 'avalanche') return 'avalanche-mainnet';
  return null;
}

function infuraProjectId(): string | null {
  return process.env.INFURA_API_KEY?.trim() || process.env.INFURA_PUBLIC_ID?.trim() || null;
}

function configuredHttpUrls(chain: GhostWalletChain): Array<{ label: string; url: string }> {
  const result: Array<{ label: string; url: string }> = [];
  for (const url of envHttp(chain)) result.push({ label: 'railway-configured', url });
  const infura = infuraProjectId();
  const slug = infuraSlug(chain);
  if (infura && slug) result.push({ label: 'infura', url: `https://${slug}.infura.io/v3/${infura}` });
  HTTP_PUBLIC[chain].forEach((url, index) => result.push({ label: `public-${index + 1}`, url }));
  return [...new Map(result.map(row => [row.url, row])).values()];
}

export function ghostWalletWebSocketUrls(chain: GhostWalletChain): string[] {
  const result = [...envWs(chain)];
  const infura = infuraProjectId();
  const slug = infuraSlug(chain);
  if (infura && slug) result.push(`wss://${slug}.infura.io/ws/v3/${infura}`);
  result.push(...(WS_PUBLIC[chain] || []));
  return uniq(result).filter(url => !/alchemy\.com/i.test(url));
}

function timeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref?.();
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

function firstSuccessful<T>(attempts: Array<Promise<T>>): Promise<T> {
  if (attempts.length === 0) return Promise.reject(new Error('GHOST_WALLET_RPC_NO_ATTEMPTS'));
  return new Promise<T>((resolve, reject) => {
    const failures: unknown[] = new Array(attempts.length);
    let remaining = attempts.length;
    let settled = false;
    attempts.forEach((attempt, index) => {
      attempt.then(value => {
        if (settled) return;
        settled = true;
        resolve(value);
      }, error => {
        failures[index] = error;
        remaining -= 1;
        if (!settled && remaining === 0) reject(failures.find(Boolean) || new Error('GHOST_WALLET_RPC_ALL_ATTEMPTS_FAILED'));
      });
    });
  });
}

function providerHealthTtlMs(): number {
  const configured = Number(process.env.GHOST_WALLET_PROVIDER_HEALTH_TTL_MS || 15_000);
  return Number.isFinite(configured) ? Math.max(2_000, Math.min(120_000, Math.trunc(configured))) : 15_000;
}

function hedgeDelayMs(): number {
  const configured = Number(process.env.GHOST_WALLET_RPC_HEDGE_DELAY_MS || 35);
  return Number.isFinite(configured) ? Math.max(5, Math.min(250, Math.trunc(configured))) : 35;
}

function maxHedgeAttempts(): number {
  const configured = Number(process.env.GHOST_WALLET_RPC_HEDGE_ATTEMPTS || 3);
  return Number.isFinite(configured) ? Math.max(1, Math.min(4, Math.trunc(configured))) : 3;
}

function operationClass(operation: string): GhostWalletRpcOperationClass {
  if (/sendRawTransaction|broadcast/i.test(operation)) return 'broadcast';
  if (/getLogs|settlement|log_|logs|backfill/i.test(operation)) return 'logs';
  return 'read';
}

function newHealth(latencyMs: number): OperationHealth {
  return {
    ewmaLatencyMs: latencyMs,
    successes: 1,
    failures: 0,
    consecutiveFailures: 0,
    cooldownUntil: 0,
    lastSuccessAt: Date.now(),
    lastFailureAt: null,
  };
}

function copyHealth(value: OperationHealth): OperationHealth {
  return { ...value };
}

function retryAfterMs(error: unknown): number | null {
  const candidate = error as any;
  const raw = candidate?.response?.headers?.['retry-after']
    ?? candidate?.response?.headers?.get?.('retry-after')
    ?? candidate?.headers?.['retry-after']
    ?? null;
  if (raw === null || raw === undefined) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const date = Date.parse(String(raw));
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function providerFailureCooldownMs(health: OperationHealth, error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  const rateLimited = /429|rate limit|too many requests|throttl/i.test(message);
  const explicit = retryAfterMs(error);
  if (explicit !== null) return Math.max(250, Math.min(120_000, explicit));
  const base = rateLimited ? 5_000 : 500;
  return Math.min(120_000, base * (2 ** Math.min(6, Math.max(0, health.consecutiveFailures))));
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

class GhostWalletProviderMesh {
  private readonly healthy = new Map<GhostWalletChain, Candidate[]>();
  private readonly initialized = new Set<GhostWalletChain>();
  private readonly lastProbeAt = new Map<GhostWalletChain, number>();
  private readonly inFlight = new Map<GhostWalletChain, Promise<void>>();

  async initialize(chains: GhostWalletChain[] = Object.keys(CHAIN_IDS) as GhostWalletChain[]): Promise<void> {
    const settled = await Promise.allSettled(chains.map(chain => this.ensureChain(chain)));
    settled.forEach((result, index) => {
      if (result.status === 'rejected') {
        logger.warn('[GhostWalletProviderMesh] Chain unavailable; other Ghost routes remain live', {
          component: 'GhostWalletProviderMesh', chain: chains[index],
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          routeLocalFailure: true, alchemyEligible: false,
        });
      }
    });
  }

  async ensureChain(chain: GhostWalletChain): Promise<void> {
    const lastProbe = this.lastProbeAt.get(chain) || 0;
    if (this.initialized.has(chain) && Date.now() - lastProbe < providerHealthTtlMs()) return;
    const existing = this.inFlight.get(chain);
    if (existing) return existing;
    const work = this.probeChain(chain).finally(() => this.inFlight.delete(chain));
    this.inFlight.set(chain, work);
    return work;
  }

  private async probeChain(chain: GhostWalletChain): Promise<void> {
    const expectedChainId = CHAIN_IDS[chain];
    const candidates = configuredHttpUrls(chain);
    const measured = await Promise.allSettled(candidates.map(async row => {
      const provider = new providers.JsonRpcProvider(row.url, expectedChainId);
      const startedAt = Date.now();
      const [network, block] = await timeout(Promise.all([provider.getNetwork(), provider.getBlockNumber()]), 5_000, `Ghost ${chain} ${row.label}`);
      if (network.chainId !== expectedChainId || block < 0) throw new Error('chain identity mismatch');
      const latencyMs = Date.now() - startedAt;
      recordGhostWalletPerformance({ stage: 'provider_probe', chain, providerLabel: row.label, latencyMs, success: true });
      return {
        ...row,
        provider,
        latencyMs,
        operations: {
          read: newHealth(latencyMs),
          logs: newHealth(latencyMs),
          broadcast: newHealth(latencyMs),
        },
      } satisfies Candidate;
    }));
    const priorByUrl = new Map((this.healthy.get(chain) || []).map(candidate => [candidate.url, candidate]));
    const healthy = measured
      .filter((result): result is PromiseFulfilledResult<Candidate> => result.status === 'fulfilled')
      .map(result => {
        const prior = priorByUrl.get(result.value.url);
        if (!prior) return result.value;
        return {
          ...result.value,
          operations: {
            read: copyHealth(prior.operations.read),
            logs: copyHealth(prior.operations.logs),
            broadcast: copyHealth(prior.operations.broadcast),
          },
        };
      });
    if (healthy.length === 0) {
      this.healthy.delete(chain);
      this.initialized.delete(chain);
      this.lastProbeAt.delete(chain);
      throw new Error(`GHOST_WALLET_RPC_UNAVAILABLE:${chain}`);
    }
    this.healthy.set(chain, healthy);
    this.initialized.add(chain);
    this.lastProbeAt.set(chain, Date.now());
    this.sortCandidates(chain, 'read');
    const ranked = this.healthy.get(chain) || [];
    logger.info('[GhostWalletProviderMesh] Alchemy-free RPC redundancy ready', {
      component: 'GhostWalletProviderMesh', chain,
      selected: ranked[0]?.label || null,
      healthyProviders: ranked.map(row => ({ label: row.label, latencyMs: Math.round(row.operations.read.ewmaLatencyMs) })),
      alchemyEligible: false,
      requestDrivenHealthRefresh: true,
      adaptiveLatencyRanking: true,
      operationClassHealth: true,
      retryAfterAwareCooldown: true,
      hedgedReads: true,
      circuitBreaking: true,
      healthTtlMs: providerHealthTtlMs(), periodicHealthPolling: false,
    });
  }

  private sortCandidates(chain: GhostWalletChain, opClass: GhostWalletRpcOperationClass): void {
    const rows = this.healthy.get(chain);
    if (!rows) return;
    const now = Date.now();
    rows.sort((left, right) => {
      const a = left.operations[opClass];
      const b = right.operations[opClass];
      const leftCooling = a.cooldownUntil > now ? 1 : 0;
      const rightCooling = b.cooldownUntil > now ? 1 : 0;
      if (leftCooling !== rightCooling) return leftCooling - rightCooling;
      if (a.consecutiveFailures !== b.consecutiveFailures) return a.consecutiveFailures - b.consecutiveFailures;
      return a.ewmaLatencyMs - b.ewmaLatencyMs;
    });
  }

  private candidateFor(chain: GhostWalletChain, provider: providers.JsonRpcProvider): Candidate | null {
    return (this.healthy.get(chain) || []).find(candidate => candidate.provider === provider) || null;
  }

  private recordOutcome(chain: GhostWalletChain, candidate: Candidate, operation: string, startedAt: number, success: boolean, error?: unknown): void {
    const opClass = operationClass(operation);
    const health = candidate.operations[opClass];
    const latencyMs = Math.max(0, Date.now() - startedAt);
    health.ewmaLatencyMs = (health.ewmaLatencyMs * 0.8) + (latencyMs * 0.2);
    if (success) {
      health.successes += 1;
      health.consecutiveFailures = 0;
      health.cooldownUntil = 0;
      health.lastSuccessAt = Date.now();
    } else {
      health.failures += 1;
      health.consecutiveFailures += 1;
      health.lastFailureAt = Date.now();
      health.cooldownUntil = Date.now() + providerFailureCooldownMs(health, error);
    }
    recordGhostWalletPerformance({
      stage: 'provider_probe', chain, providerLabel: `${candidate.label}:${opClass}:${operation}`,
      latencyMs, success, errorType: success ? null : (error instanceof Error ? error.message : String(error)),
    });
    this.sortCandidates(chain, opClass);
  }

  async runHedged<T>(input: {
    chain: GhostWalletChain;
    operation: string;
    execute: (provider: providers.JsonRpcProvider, providerIndex: number) => Promise<T>;
    maxAttempts?: number;
    hedgeDelayMs?: number;
  }): Promise<T> {
    await this.ensureChain(input.chain);
    const opClass = operationClass(input.operation);
    this.sortCandidates(input.chain, opClass);
    const now = Date.now();
    const all = this.healthy.get(input.chain) || [];
    const candidates = all
      .filter(candidate => candidate.operations[opClass].cooldownUntil <= now)
      .slice(0, Math.max(1, Math.min(input.maxAttempts ?? maxHedgeAttempts(), 4)));
    const fallbackCandidates = candidates.length > 0 ? candidates : all.slice(0, 1);
    if (fallbackCandidates.length === 0) throw new Error(`GHOST_WALLET_RPC_UNAVAILABLE:${input.chain}`);
    const delay = Math.max(0, input.hedgeDelayMs ?? hedgeDelayMs());
    return firstSuccessful(fallbackCandidates.map((candidate, index) => (async () => {
      if (index > 0) await wait(delay * index);
      const startedAt = Date.now();
      try {
        const result = await input.execute(candidate.provider, index);
        this.recordOutcome(input.chain, candidate, input.operation, startedAt, true);
        return result;
      } catch (error) {
        this.recordOutcome(input.chain, candidate, input.operation, startedAt, false, error);
        throw error;
      }
    })()));
  }

  async runHedgedLogs<T>(input: {
    chain: GhostWalletChain;
    operation: string;
    execute: (provider: providers.JsonRpcProvider, providerIndex: number) => Promise<T>;
    maxAttempts?: number;
    hedgeDelayMs?: number;
  }): Promise<T> {
    await this.ensureChain(input.chain);
    this.sortCandidates(input.chain, 'logs');
    const now = Date.now();
    const eligible = (this.healthy.get(input.chain) || [])
      .filter(candidate => ghostWalletProviderSupportsSettlementLogs(input.chain, candidate.url))
      .filter(candidate => candidate.operations.logs.cooldownUntil <= now)
      .slice(0, Math.max(1, Math.min(input.maxAttempts ?? maxHedgeAttempts(), 4)));
    if (eligible.length === 0) throw new Error(`GHOST_WALLET_LOG_RPC_UNAVAILABLE:${input.chain}`);
    const delay = Math.max(0, input.hedgeDelayMs ?? hedgeDelayMs());
    return firstSuccessful(eligible.map((candidate, index) => (async () => {
      if (index > 0) await wait(delay * index);
      const startedAt = Date.now();
      try {
        const result = await input.execute(candidate.provider, index);
        this.recordOutcome(input.chain, candidate, `getLogs:${input.operation}`, startedAt, true);
        return result;
      } catch (error) {
        this.recordOutcome(input.chain, candidate, `getLogs:${input.operation}`, startedAt, false, error);
        throw error;
      }
    })()));
  }

  async broadcastRawTransaction(chain: GhostWalletChain, rawTransaction: string): Promise<string> {
    await this.ensureChain(chain);
    this.sortCandidates(chain, 'broadcast');
    const candidates = (this.healthy.get(chain) || [])
      .filter(candidate => candidate.operations.broadcast.cooldownUntil <= Date.now())
      .slice(0, maxHedgeAttempts());
    if (candidates.length === 0) throw new Error(`GHOST_WALLET_RPC_UNAVAILABLE:${chain}`);
    const expectedHash = utils.keccak256(rawTransaction);
    const result = await Promise.allSettled(candidates.map(async candidate => {
      const startedAt = Date.now();
      try {
        const response = await candidate.provider.sendTransaction(rawTransaction);
        this.recordOutcome(chain, candidate, 'eth_sendRawTransaction', startedAt, true);
        return response.hash;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/already known|known transaction/i.test(message)) {
          this.recordOutcome(chain, candidate, 'eth_sendRawTransaction', startedAt, true);
          return expectedHash;
        }
        if (/nonce too low/i.test(message)) {
          const observed = await candidate.provider.getTransaction(expectedHash).catch(() => null);
          if (observed?.hash?.toLowerCase() === expectedHash.toLowerCase()) {
            this.recordOutcome(chain, candidate, 'eth_sendRawTransaction', startedAt, true);
            return expectedHash;
          }
        }
        this.recordOutcome(chain, candidate, 'eth_sendRawTransaction', startedAt, false, error);
        throw error;
      }
    }));
    const fulfilled = result.find((entry): entry is PromiseFulfilledResult<string> => entry.status === 'fulfilled' && Boolean(entry.value));
    if (fulfilled) return fulfilled.value;
    const firstFailure = result.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected');
    throw firstFailure?.reason || new Error('GHOST_WALLET_RPC_BROADCAST_FAILED');
  }

  async getProvider(chain: string): Promise<providers.JsonRpcProvider | null> {
    const normalized = chain.trim().toLowerCase() as GhostWalletChain;
    if (!(normalized in CHAIN_IDS)) return null;
    await this.ensureChain(normalized);
    this.sortCandidates(normalized, 'read');
    return (this.healthy.get(normalized) || []).find(candidate => candidate.operations.read.cooldownUntil <= Date.now())?.provider
      || this.healthy.get(normalized)?.[0]?.provider || null;
  }

  async getProviders(chain: string): Promise<providers.JsonRpcProvider[]> {
    const normalized = chain.trim().toLowerCase() as GhostWalletChain;
    if (!(normalized in CHAIN_IDS)) return [];
    await this.ensureChain(normalized);
    this.sortCandidates(normalized, 'read');
    return (this.healthy.get(normalized) || []).map(row => row.provider);
  }

  getProviderLabel(chain: GhostWalletChain, provider: providers.JsonRpcProvider): string | null {
    return this.candidateFor(chain, provider)?.label || null;
  }

  async getLogProviders(chain: string): Promise<providers.JsonRpcProvider[]> {
    const normalized = chain.trim().toLowerCase() as GhostWalletChain;
    if (!(normalized in CHAIN_IDS)) return [];
    await this.ensureChain(normalized);
    this.sortCandidates(normalized, 'logs');
    return (this.healthy.get(normalized) || [])
      .filter(row => row.operations.logs.cooldownUntil <= Date.now())
      .filter(row => ghostWalletProviderSupportsSettlementLogs(normalized, row.url))
      .map(row => row.provider);
  }

  getReadyProvider(chain: string): providers.JsonRpcProvider | null {
    const normalized = chain.trim().toLowerCase() as GhostWalletChain;
    this.sortCandidates(normalized, 'read');
    return (this.healthy.get(normalized) || []).find(candidate => candidate.operations.read.cooldownUntil <= Date.now())?.provider
      || this.healthy.get(normalized)?.[0]?.provider || null;
  }

  getReadyChains(): GhostWalletChain[] {
    return [...this.healthy.entries()].filter(([, rows]) => rows.length > 0).map(([chain]) => chain);
  }

  getStatus() {
    const now = Date.now();
    return [...this.healthy.entries()].map(([chain, rows]) => ({
      chain,
      selected: [...rows].sort((a, b) => a.operations.read.ewmaLatencyMs - b.operations.read.ewmaLatencyMs)[0]?.label || null,
      redundancy: rows.length,
      availableNow: rows.filter(row => row.operations.read.cooldownUntil <= now).length,
      providers: rows.map(row => ({
        label: row.label,
        operations: Object.fromEntries((['read', 'logs', 'broadcast'] as const).map(opClass => [opClass, {
          ewmaLatencyMs: Math.round(row.operations[opClass].ewmaLatencyMs * 100) / 100,
          successes: row.operations[opClass].successes,
          failures: row.operations[opClass].failures,
          consecutiveFailures: row.operations[opClass].consecutiveFailures,
          cooldownUntil: row.operations[opClass].cooldownUntil || null,
        }])),
      })),
      lastProbeAt: this.lastProbeAt.get(chain) || null,
      healthTtlMs: providerHealthTtlMs(), hedgeDelayMs: hedgeDelayMs(), maxHedgeAttempts: maxHedgeAttempts(),
      alchemy: false,
      websocketCandidates: ghostWalletWebSocketUrls(chain).length,
      settlementLogRedundancy: rows.filter(row => ghostWalletProviderSupportsSettlementLogs(chain, row.url)).length,
    }));
  }
}

export const ghostWalletProviderMesh = new GhostWalletProviderMesh();

export const GHOST_WALLET_PROVIDER_POLICY = {
  alchemyAllowed: false,
  configuredRailwayRpcPreferred: true,
  independentPublicFallbacks: true,
  methodAwareSettlementLogSelection: true,
  operationClassHealth: ['read', 'logs', 'broadcast'] as const,
  parallelInitialProbe: true,
  requestDrivenHealthRefresh: true,
  adaptiveLatencyRanking: true,
  hedgedReadFailover: true,
  hedgedLogFailover: true,
  retryAfterAwareCircuitBreaking: true,
  providerCircuitBreaking: true,
  identicalRawTransactionMultiProviderBroadcast: true,
  exactHashRequiredOnNonceConflict: true,
  routeLocalFailure: true,
  periodicHealthPolling: false,
} as const;