import { providers } from 'ethers';
import logger from '../../../logger.js';
import { ghostWalletProviderSupportsSettlementLogs } from './ghost-wallet-log-policy.js';
import { recordGhostWalletPerformance } from './ghost-wallet-performance-intelligence.js';

export type GhostWalletChain = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'base' | 'bsc' | 'avalanche';

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

interface Candidate {
  label: string;
  url: string;
  provider: providers.JsonRpcProvider;
  latencyMs: number;
  ewmaLatencyMs: number;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  cooldownUntil: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
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
  return process.env.INFURA_API_KEY?.trim()
    || process.env.INFURA_PUBLIC_ID?.trim()
    || null;
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

function providerHealthTtlMs(): number {
  const configured = Number(process.env.GHOST_WALLET_PROVIDER_HEALTH_TTL_MS || 15_000);
  return Number.isFinite(configured)
    ? Math.max(2_000, Math.min(120_000, Math.trunc(configured)))
    : 15_000;
}

function hedgeDelayMs(): number {
  const configured = Number(process.env.GHOST_WALLET_RPC_HEDGE_DELAY_MS || 35);
  return Number.isFinite(configured) ? Math.max(5, Math.min(250, Math.trunc(configured))) : 35;
}

function maxHedgeAttempts(): number {
  const configured = Number(process.env.GHOST_WALLET_RPC_HEDGE_ATTEMPTS || 3);
  return Number.isFinite(configured) ? Math.max(1, Math.min(4, Math.trunc(configured))) : 3;
}

function providerFailureCooldownMs(candidate: Candidate, error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  const rateLimited = /429|rate limit|too many requests/i.test(message);
  const base = rateLimited ? 5_000 : 500;
  return Math.min(60_000, base * (2 ** Math.min(6, Math.max(0, candidate.consecutiveFailures))));
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
        const chain = chains[index];
        logger.warn('[GhostWalletProviderMesh] Chain unavailable; other Ghost routes remain live', {
          component: 'GhostWalletProviderMesh',
          chain,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          routeLocalFailure: true,
          alchemyEligible: false,
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
      try {
        const [network, block] = await timeout(
          Promise.all([provider.getNetwork(), provider.getBlockNumber()]),
          5_000,
          `Ghost ${chain} ${row.label}`,
        );
        if (network.chainId !== expectedChainId || block < 0) throw new Error('chain identity mismatch');
        const latencyMs = Date.now() - startedAt;
        recordGhostWalletPerformance({
          stage: 'provider_probe', chain, providerLabel: row.label, latencyMs, success: true,
        });
        return {
          ...row,
          provider,
          latencyMs,
          ewmaLatencyMs: latencyMs,
          successes: 1,
          failures: 0,
          consecutiveFailures: 0,
          cooldownUntil: 0,
          lastSuccessAt: Date.now(),
          lastFailureAt: null,
        } as Candidate;
      } catch (error) {
        recordGhostWalletPerformance({
          stage: 'provider_probe', chain, providerLabel: row.label,
          latencyMs: Date.now() - startedAt, success: false,
          errorType: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }));
    const priorByUrl = new Map((this.healthy.get(chain) || []).map(candidate => [candidate.url, candidate]));
    const healthy = measured
      .filter((result): result is PromiseFulfilledResult<Candidate> => result.status === 'fulfilled')
      .map(result => {
        const prior = priorByUrl.get(result.value.url);
        return prior ? {
          ...result.value,
          ewmaLatencyMs: prior.ewmaLatencyMs,
          successes: prior.successes + 1,
          failures: prior.failures,
          consecutiveFailures: 0,
          cooldownUntil: 0,
          lastSuccessAt: Date.now(),
          lastFailureAt: prior.lastFailureAt,
        } : result.value;
      });
    if (healthy.length === 0) {
      this.healthy.delete(chain);
      this.initialized.delete(chain);
      this.lastProbeAt.delete(chain);
      throw new Error(`GHOST_WALLET_RPC_UNAVAILABLE:${chain}`);
    }
    this.healthy.set(chain, healthy);
    this.sortCandidates(chain);
    this.initialized.add(chain);
    this.lastProbeAt.set(chain, Date.now());
    const ranked = this.healthy.get(chain) || [];
    logger.info('[GhostWalletProviderMesh] Alchemy-free RPC redundancy ready', {
      component: 'GhostWalletProviderMesh',
      chain,
      selected: ranked[0]?.label || null,
      healthyProviders: ranked.map(row => ({ label: row.label, latencyMs: Math.round(row.ewmaLatencyMs), cooldownUntil: row.cooldownUntil || null })),
      alchemyEligible: false,
      requestDrivenHealthRefresh: true,
      adaptiveLatencyRanking: true,
      hedgedReads: true,
      circuitBreaking: true,
      healthTtlMs: providerHealthTtlMs(),
      periodicHealthPolling: false,
    });
  }

  private sortCandidates(chain: GhostWalletChain): void {
    const now = Date.now();
    const rows = this.healthy.get(chain);
    if (!rows) return;
    rows.sort((left, right) => {
      const leftCooling = left.cooldownUntil > now ? 1 : 0;
      const rightCooling = right.cooldownUntil > now ? 1 : 0;
      if (leftCooling !== rightCooling) return leftCooling - rightCooling;
      if (left.consecutiveFailures !== right.consecutiveFailures) return left.consecutiveFailures - right.consecutiveFailures;
      return left.ewmaLatencyMs - right.ewmaLatencyMs;
    });
  }

  private candidateFor(chain: GhostWalletChain, provider: providers.JsonRpcProvider): Candidate | null {
    return (this.healthy.get(chain) || []).find(candidate => candidate.provider === provider) || null;
  }

  private recordOutcome(chain: GhostWalletChain, candidate: Candidate, operation: string, startedAt: number, success: boolean, error?: unknown): void {
    const latencyMs = Math.max(0, Date.now() - startedAt);
    candidate.ewmaLatencyMs = (candidate.ewmaLatencyMs * 0.8) + (latencyMs * 0.2);
    if (success) {
      candidate.successes += 1;
      candidate.consecutiveFailures = 0;
      candidate.cooldownUntil = 0;
      candidate.lastSuccessAt = Date.now();
    } else {
      candidate.failures += 1;
      candidate.consecutiveFailures += 1;
      candidate.lastFailureAt = Date.now();
      candidate.cooldownUntil = Date.now() + providerFailureCooldownMs(candidate, error);
    }
    recordGhostWalletPerformance({
      stage: 'provider_probe', chain, providerLabel: `${candidate.label}:${operation}`,
      latencyMs, success, errorType: success ? null : (error instanceof Error ? error.message : String(error)),
    });
    this.sortCandidates(chain);
  }

  async runHedged<T>(input: {
    chain: GhostWalletChain;
    operation: string;
    execute: (provider: providers.JsonRpcProvider, providerIndex: number) => Promise<T>;
    maxAttempts?: number;
    hedgeDelayMs?: number;
  }): Promise<T> {
    await this.ensureChain(input.chain);
    this.sortCandidates(input.chain);
    const now = Date.now();
    const candidates = (this.healthy.get(input.chain) || [])
      .filter(candidate => candidate.cooldownUntil <= now)
      .slice(0, Math.max(1, Math.min(input.maxAttempts ?? maxHedgeAttempts(), 4)));
    const fallbackCandidates = candidates.length > 0 ? candidates : (this.healthy.get(input.chain) || []).slice(0, 1);
    if (fallbackCandidates.length === 0) throw new Error(`GHOST_WALLET_RPC_UNAVAILABLE:${input.chain}`);
    const delay = Math.max(0, input.hedgeDelayMs ?? hedgeDelayMs());
    const attempts = fallbackCandidates.map((candidate, index) => (async () => {
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
    })());
    return Promise.any(attempts);
  }

  async broadcastRawTransaction(chain: GhostWalletChain, rawTransaction: string): Promise<string> {
    await this.ensureChain(chain);
    this.sortCandidates(chain);
    const candidates = (this.healthy.get(chain) || []).filter(candidate => candidate.cooldownUntil <= Date.now()).slice(0, maxHedgeAttempts());
    if (candidates.length === 0) throw new Error(`GHOST_WALLET_RPC_UNAVAILABLE:${chain}`);
    const expectedHash = providers.JsonRpcProvider.hexlify ? null : null;
    const attempts = candidates.map(async candidate => {
      const startedAt = Date.now();
      try {
        const response = await candidate.provider.sendTransaction(rawTransaction);
        this.recordOutcome(chain, candidate, 'eth_sendRawTransaction', startedAt, true);
        return response.hash;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/already known|known transaction|nonce too low/i.test(message)) {
          this.recordOutcome(chain, candidate, 'eth_sendRawTransaction', startedAt, true);
          return '';
        }
        this.recordOutcome(chain, candidate, 'eth_sendRawTransaction', startedAt, false, error);
        throw error;
      }
    });
    const result = await Promise.allSettled(attempts);
    const fulfilled = result.find((entry): entry is PromiseFulfilledResult<string> => entry.status === 'fulfilled' && Boolean(entry.value));
    if (fulfilled) return fulfilled.value;
    if (result.some(entry => entry.status === 'fulfilled')) return '';
    const firstFailure = result.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected');
    throw firstFailure?.reason || new Error('GHOST_WALLET_RPC_BROADCAST_FAILED');
  }

  async getProvider(chain: string): Promise<providers.JsonRpcProvider | null> {
    const normalized = chain.trim().toLowerCase() as GhostWalletChain;
    if (!(normalized in CHAIN_IDS)) return null;
    await this.ensureChain(normalized);
    this.sortCandidates(normalized);
    return (this.healthy.get(normalized) || []).find(candidate => candidate.cooldownUntil <= Date.now())?.provider
      || this.healthy.get(normalized)?.[0]?.provider
      || null;
  }

  async getProviders(chain: string): Promise<providers.JsonRpcProvider[]> {
    const normalized = chain.trim().toLowerCase() as GhostWalletChain;
    if (!(normalized in CHAIN_IDS)) return [];
    await this.ensureChain(normalized);
    this.sortCandidates(normalized);
    return (this.healthy.get(normalized) || []).map(row => row.provider);
  }

  getProviderLabel(chain: GhostWalletChain, provider: providers.JsonRpcProvider): string | null {
    return this.candidateFor(chain, provider)?.label || null;
  }

  async getLogProviders(chain: string): Promise<providers.JsonRpcProvider[]> {
    const normalized = chain.trim().toLowerCase() as GhostWalletChain;
    if (!(normalized in CHAIN_IDS)) return [];
    await this.ensureChain(normalized);
    this.sortCandidates(normalized);
    return (this.healthy.get(normalized) || [])
      .filter(row => row.cooldownUntil <= Date.now())
      .filter(row => ghostWalletProviderSupportsSettlementLogs(normalized, row.url))
      .map(row => row.provider);
  }

  getReadyProvider(chain: string): providers.JsonRpcProvider | null {
    const normalized = chain.trim().toLowerCase() as GhostWalletChain;
    this.sortCandidates(normalized);
    return (this.healthy.get(normalized) || []).find(candidate => candidate.cooldownUntil <= Date.now())?.provider
      || this.healthy.get(normalized)?.[0]?.provider
      || null;
  }

  getReadyChains(): GhostWalletChain[] {
    return [...this.healthy.entries()].filter(([, rows]) => rows.length > 0).map(([chain]) => chain);
  }

  getStatus() {
    const now = Date.now();
    return [...this.healthy.entries()].map(([chain, rows]) => ({
      chain,
      selected: [...rows].sort((a, b) => a.ewmaLatencyMs - b.ewmaLatencyMs)[0]?.label || null,
      redundancy: rows.length,
      availableNow: rows.filter(row => row.cooldownUntil <= now).length,
      providers: rows.map(row => ({
        label: row.label,
        ewmaLatencyMs: Math.round(row.ewmaLatencyMs * 100) / 100,
        successes: row.successes,
        failures: row.failures,
        consecutiveFailures: row.consecutiveFailures,
        cooldownUntil: row.cooldownUntil || null,
      })),
      lastProbeAt: this.lastProbeAt.get(chain) || null,
      healthTtlMs: providerHealthTtlMs(),
      hedgeDelayMs: hedgeDelayMs(),
      maxHedgeAttempts: maxHedgeAttempts(),
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
  parallelInitialProbe: true,
  requestDrivenHealthRefresh: true,
  adaptiveLatencyRanking: true,
  hedgedReadFailover: true,
  providerCircuitBreaking: true,
  identicalRawTransactionMultiProviderBroadcast: true,
  routeLocalFailure: true,
  periodicHealthPolling: false,
} as const;
