// Blockchain API Services - Alchemy (Access) + Etherscan (Data)
// Implements hyper-optimized API layer with advanced rate limiting

import { ethers } from 'ethers';
import logger from '../../../logger.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type SupportedChain = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'base' | 'avalanche' | 'bsc';

export interface BlockchainProviderConfig {
  chain: SupportedChain;
  alchemyApiKey?: string;
  etherscanApiKey?: string;
  region?: EdenRegion;
}

export type RpcTransport = 'http' | 'websocket';
export type RpcProviderState = 'unconfigured' | 'connecting' | 'healthy' | 'degraded' | 'cooldown' | 'unavailable' | 'shutting_down';

export type RpcCapability =
  | 'json_rpc'
  | 'network'
  | 'blocks'
  | 'transactions'
  | 'receipts'
  | 'gas'
  | 'logs'
  | 'contract_calls'
  | 'subscriptions'
  | 'pending_transactions';

export interface RpcProvenance {
  provider: string;
  chain: SupportedChain;
  transport: RpcTransport;
  observedAt: number;
  latencyMs: number | null;
  failoverGeneration: number;
  mode: 'live' | 'degraded';
}

export interface ManagedRpcProvider {
  provider: string;
  chain: SupportedChain;
  http: ethers.providers.JsonRpcProvider;
  websocketUrl?: string;
  capabilities: ReadonlySet<RpcCapability>;
  provenance: RpcProvenance;
}

interface RpcCandidate {
  provider: string;
  chain: SupportedChain;
  priority: number;
  httpUrl: string;
  websocketUrl?: string;
  capabilities: ReadonlySet<RpcCapability>;
  httpProvider: ethers.providers.JsonRpcProvider;
  state: RpcProviderState;
  latencyMs: number | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  cooldownUntil: number;
  websocketState: RpcProviderState;
  websocketConsecutiveFailures: number;
    websocketConsecutiveSuccesses: number;
    websocketLastError?: string;
  websocketCooldownUntil: number;
  websocketLastObservedAt: number;
  lastError?: string;
  lastObservedAt: number;
}

const CHAIN_IDS: Record<SupportedChain, number> = {
  ethereum: 1,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
  avalanche: 43114,
  bsc: 56,
};

const PUBLIC_RPC_URLS: Partial<Record<SupportedChain, string>> = {
  polygon: 'https://polygon-rpc.com',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
  optimism: 'https://mainnet.optimism.io',
  avalanche: 'https://api.avax.network/ext/bc/C/rpc',
  bsc: 'https://bsc-dataseed.binance.org',
};

const ALCHEMY_SLUGS: Partial<Record<SupportedChain, string>> = {
  ethereum: 'eth', polygon: 'polygon', arbitrum: 'arb', optimism: 'opt', base: 'base',
};

const INFURA_SLUGS: Partial<Record<SupportedChain, string>> = {
  ethereum: 'mainnet', polygon: 'polygon-mainnet', arbitrum: 'arbitrum-mainnet', optimism: 'optimism-mainnet',
};

type RpcCandidateDefinition = Pick<RpcCandidate, 'provider' | 'chain' | 'priority' | 'httpUrl' | 'websocketUrl' | 'capabilities'>;

function configuredRpcCandidates(chain: SupportedChain): RpcCandidateDefinition[] {
  const candidates: RpcCandidateDefinition[] = [];
  const add = (provider: string, httpUrl: string | undefined, priority: number, websocketUrl?: string, capabilities: RpcCapability[] = ['json_rpc', 'network', 'blocks', 'transactions', 'receipts', 'gas', 'logs', 'contract_calls']): void => {
    if (!httpUrl?.trim()) return;
    candidates.push({ provider, chain, priority, httpUrl: httpUrl.trim(), websocketUrl, capabilities: new Set(capabilities) });
  };

  const alchemySlug = ALCHEMY_SLUGS[chain];
  const alchemyKey = process.env.ALCHEMY_API_KEY?.trim();
  if (alchemySlug && alchemyKey) {
    add('Alchemy', `https://${alchemySlug}-mainnet.g.alchemy.com/v2/${alchemyKey}`, 10, `wss://${alchemySlug}-mainnet.g.alchemy.com/v2/${alchemyKey}`, ['json_rpc', 'network', 'blocks', 'transactions', 'receipts', 'gas', 'logs', 'contract_calls', 'subscriptions', 'pending_transactions']);
  }

  const infuraSlug = INFURA_SLUGS[chain];
  const infuraKey = process.env.INFURA_API_KEY?.trim();
  if (infuraSlug && infuraKey) {
    add('Infura', `https://${infuraSlug}.infura.io/v3/${infuraKey}`, 9, `wss://${infuraSlug}.infura.io/ws/v3/${infuraKey}`, ['json_rpc', 'network', 'blocks', 'transactions', 'receipts', 'gas', 'logs', 'contract_calls', 'subscriptions']);
  }

  const quickNodeUrl = process.env[`${chain.toUpperCase()}_QUICKNODE_RPC_URL`]?.trim() || process.env.QUICKNODE_RPC_URL?.trim();
  const quickNodeWsUrl = process.env[`${chain.toUpperCase()}_QUICKNODE_WS_URL`]?.trim() || process.env.QUICKNODE_WS_URL?.trim();
  add('QuickNode', quickNodeUrl, 8, quickNodeWsUrl, ['json_rpc', 'network', 'blocks', 'transactions', 'receipts', 'gas', 'logs', 'contract_calls', ...(quickNodeWsUrl ? ['subscriptions' as RpcCapability] : [])]);

  const ankrKey = process.env.ANKR_API_KEY?.trim() || process.env.ANKR_KEY?.trim();
  const ankrSlug: Partial<Record<SupportedChain, string>> = {
    ethereum: 'eth', polygon: 'polygon', arbitrum: 'arbitrum', optimism: 'optimism', avalanche: 'avalanche', bsc: 'bsc',
  };
  const ankrUrl = process.env[`${chain.toUpperCase()}_ANKR_RPC_URL`]?.trim()
    || (ankrKey && ankrSlug[chain] ? `https://rpc.ankr.com/${ankrSlug[chain]}/${ankrKey}` : undefined);
  const ankrWsUrl = process.env[`${chain.toUpperCase()}_ANKR_WS_URL`]?.trim();
  add('Ankr', ankrUrl, 7, ankrWsUrl, ['json_rpc', 'network', 'blocks', 'transactions', 'receipts', 'gas', 'logs', 'contract_calls', ...(ankrWsUrl ? ['subscriptions' as RpcCapability] : [])]);

  const configuredUrl = (process.env[`${chain.toUpperCase()}_RPC_URL`] || (chain === 'ethereum' ? process.env.PRIVATE_RPC_URL || process.env.RPC_URL : undefined))?.trim();
  const configuredWsUrl = (process.env[`${chain.toUpperCase()}_WS_URL`] || (chain === 'ethereum' ? process.env.PRIVATE_WS_URL : undefined))?.trim();
  add('ConfiguredRPC', configuredUrl, 6, configuredWsUrl, ['json_rpc', 'network', 'blocks', 'transactions', 'receipts', 'gas', 'logs', 'contract_calls', ...(configuredWsUrl ? ['subscriptions' as RpcCapability] : [])]);

  if (!configuredUrl && PUBLIC_RPC_URLS[chain]) add(chain === 'bsc' ? 'Binance' : 'PublicRPC', PUBLIC_RPC_URLS[chain], 1);
  return candidates;
}

export interface RpcHealthObservation {
  provider: string;
  chain: SupportedChain;
  transport: RpcTransport;
  state: RpcProviderState;
  success: boolean;
  latencyMs: number | null;
  observedAt: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastError?: string;
}

export interface WebSocketTransportLike {
  on(event: string, listener: (...args: any[]) => void): void;
  removeListener?(event: string, listener: (...args: any[]) => void): void;
  removeAllListeners?(): void;
  close?(): void;
  terminate?(): void;
}

export function attachWebSocketTransportGuards(
  socket: WebSocketTransportLike,
  handlers: { onOpen?: () => void; onFailure: (error?: unknown) => void; onClose?: () => void },
): () => void {
  let failed = false;
  const onOpen = () => handlers.onOpen?.();
  const onError = (error: unknown) => {
    if (failed) return;
    failed = true;
    handlers.onFailure(error);
  };
  const onClose = () => {
    if (!failed) failed = true;
    handlers.onClose?.();
  };
  socket.on('open', onOpen);
  socket.on('error', onError);
  socket.on('close', onClose);
  return () => {
    socket.removeListener?.('open', onOpen);
    socket.removeListener?.('error', onError);
    socket.removeListener?.('close', onClose);
  };
}

export async function probeRpcEndpoint(
  provider: string,
  chain: SupportedChain,
  url: string,
): Promise<RpcHealthObservation> {
  const observedAt = Date.now();
  const rpc = new ethers.providers.JsonRpcProvider(url);
  try {
    const startedAt = Date.now();
    const [network, blockNumber] = await Promise.all([rpc.getNetwork(), rpc.getBlockNumber()]);
    if (network.chainId !== CHAIN_IDS[chain]) {
      throw new Error(`RPC chain identity mismatch: expected ${CHAIN_IDS[chain]}, received ${network.chainId}`);
    }
    if (blockNumber < 0) throw new Error('RPC returned invalid network evidence');
    return {
      provider, chain, transport: 'http', state: 'healthy', success: true,
      latencyMs: Date.now() - startedAt, observedAt, consecutiveFailures: 0, consecutiveSuccesses: 1,
    };
  } catch (error) {
    return {
      provider, chain, transport: 'http', state: 'unavailable', success: false,
      latencyMs: null, observedAt, consecutiveFailures: 1, consecutiveSuccesses: 0,
      lastError: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface RpcHealthSnapshot {
  provider: string;
  chain: SupportedChain;
  http: RpcHealthObservation;
  websocket: RpcHealthObservation;
  capabilities: RpcCapability[];
  httpUrl: string;
  hasWebSocket: boolean;
}

export interface LogicalSubscription {
  id: string;
  chain: SupportedChain;
  type: 'blocks' | 'pending_transactions';
  capability: 'subscriptions' | 'pending_transactions';
  provider: string | null;
  transport: RpcTransport | null;
  generation: number;
  state: 'healthy' | 'degraded' | 'unavailable' | 'shutting_down';
  unsubscribe: () => Promise<void>;
}

export interface RegisterRpcProviderInput {
  provider: string;
  chain: SupportedChain;
  httpUrl: string;
  priority?: number;
  websocketUrl?: string;
  capabilities?: RpcCapability[];
}

export interface MultiProviderRpcManagerOptions {
  httpProviderFactory?: (url: string) => ethers.providers.JsonRpcProvider;
  websocketProviderFactory?: (url: string) => ethers.providers.WebSocketProvider;
  operationTimeoutMs?: number;
  cooldownMs?: number;
  discoverConfiguredProviders?: boolean;
}

type SubscriptionCallback = (value: number | string) => void;

interface SubscriptionRecord extends LogicalSubscription {
  callback: SubscriptionCallback;
  currentProvider: ethers.providers.WebSocketProvider | null;
  socketCleanup: (() => void) | null;
  migrationTimer: NodeJS.Timeout | null;
  pollingTimer: NodeJS.Timeout | null;
  migrating: boolean;
}

/**
 * The sole operational RPC boundary for ordinary CryptoCrawler blockchain access.
 * Eden may rank identities, but only this manager owns provider instances, health,
 * cooldowns, failover, and logical subscription migration.
 */
export class MultiProviderRpcManager {
  private readonly candidates = new Map<SupportedChain, RpcCandidate[]>();
  private readonly subscriptions = new Map<string, SubscriptionRecord>();
  private readonly failoverGenerations = new Map<SupportedChain, number>();
  private readonly initializedChains = new Set<SupportedChain>();
  private shuttingDown = false;
  private readonly failureThreshold = 2;
  private readonly cooldownMs: number;
  private readonly operationTimeoutMs: number;
  private readonly httpProviderFactory: (url: string) => ethers.providers.JsonRpcProvider;
  private readonly websocketProviderFactory: (url: string) => ethers.providers.WebSocketProvider;
  private readonly discoverConfiguredProviders: boolean;
  private subscriptionSequence = 0;

  constructor(options: MultiProviderRpcManagerOptions = {}) {
    this.cooldownMs = options.cooldownMs ?? 15000;
    this.operationTimeoutMs = options.operationTimeoutMs ?? 12000;
    this.httpProviderFactory = options.httpProviderFactory || (url => new ethers.providers.JsonRpcProvider(url));
    this.websocketProviderFactory = options.websocketProviderFactory || (url => new ethers.providers.WebSocketProvider(url));
    this.discoverConfiguredProviders = options.discoverConfiguredProviders ?? true;
  }

  async initialize(chains: SupportedChain[] = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'avalanche', 'bsc']): Promise<void> {
    if (this.shuttingDown) throw new Error('RPC manager is shutting down');
    for (const chain of chains) {
      if (this.initializedChains.has(chain)) continue;
      const definitions = this.discoverConfiguredProviders ? configuredRpcCandidates(chain) : [];
      const candidates = definitions.map(definition => ({
        ...definition,
        httpProvider: this.httpProviderFactory(definition.httpUrl),
        state: 'connecting' as RpcProviderState,
        latencyMs: null,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        cooldownUntil: 0,
        websocketState: definition.websocketUrl ? 'unconfigured' : 'unavailable',
        websocketConsecutiveFailures: 0,
        websocketConsecutiveSuccesses: 0,
        websocketCooldownUntil: 0,
        websocketLastObservedAt: 0,
        lastObservedAt: 0,
      }));
      this.candidates.set(chain, candidates);
      this.failoverGenerations.set(chain, 0);
      this.initializedChains.add(chain);
      await Promise.all(candidates.map(candidate => this.probeCandidate(candidate)));
    }
  }

  private async ensureInitialized(chain: SupportedChain): Promise<void> {
    if (!this.initializedChains.has(chain)) await this.initialize([chain]);
  }

  async registerProvider(input: RegisterRpcProviderInput): Promise<void> {
    await this.ensureInitialized(input.chain);
    const chainCandidates = this.candidates.get(input.chain) || [];
    if (chainCandidates.some(candidate => candidate.httpUrl === input.httpUrl)) return;
    const capabilities = input.capabilities || ['json_rpc', 'network', 'blocks', 'transactions', 'receipts', 'gas', 'logs', 'contract_calls'];
    const candidate: RpcCandidate = {
      provider: input.provider,
      chain: input.chain,
      priority: input.priority ?? 5,
      httpUrl: input.httpUrl.trim(),
      websocketUrl: input.websocketUrl?.trim(),
      capabilities: new Set(capabilities),
      httpProvider: this.httpProviderFactory(input.httpUrl.trim()),
      state: 'connecting',
      latencyMs: null,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      cooldownUntil: 0,
      websocketState: input.websocketUrl ? 'unconfigured' : 'unavailable',
      websocketConsecutiveFailures: 0,
      websocketConsecutiveSuccesses: 0,
      websocketCooldownUntil: 0,
      websocketLastObservedAt: 0,
      lastObservedAt: 0,
    };
    chainCandidates.push(candidate);
    this.candidates.set(input.chain, chainCandidates);
    await this.probeCandidate(candidate);
    if (candidate.websocketUrl && candidate.websocketState !== 'unavailable') {
      await Promise.all(
        Array.from(this.subscriptions.values())
          .filter(subscription => subscription.chain === input.chain && ['subscriptions', 'pending_transactions'].includes(subscription.capability) && subscription.state === 'unavailable')
          .map(subscription => this.connectSubscription(subscription)),
      );
    }
  }

  private async probeCandidate(candidate: RpcCandidate): Promise<void> {
    candidate.state = 'connecting';
    const startedAt = Date.now();
    try {
      const network = await this.withTimeout(candidate.httpProvider.getNetwork(), this.operationTimeoutMs, 'RPC network probe timed out');
      if (network.chainId !== CHAIN_IDS[candidate.chain]) {
        throw new Error(`RPC chain identity mismatch: expected ${CHAIN_IDS[candidate.chain]}, received ${network.chainId}`);
      }
      await this.withTimeout(candidate.httpProvider.getBlockNumber(), this.operationTimeoutMs, 'RPC block probe timed out');
      candidate.latencyMs = Date.now() - startedAt;
      candidate.consecutiveFailures = 0;
      candidate.consecutiveSuccesses += 1;
      candidate.cooldownUntil = 0;
      candidate.state = 'healthy';
      candidate.lastError = undefined;
      candidate.lastObservedAt = Date.now();
    } catch (error) {
      this.recordFailure(candidate, error);
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
  }

  private recordFailure(candidate: RpcCandidate, error: unknown): void {
    candidate.consecutiveFailures += 1;
    candidate.consecutiveSuccesses = 0;
    candidate.lastError = error instanceof Error ? error.message : String(error);
    candidate.lastObservedAt = Date.now();
    candidate.state = candidate.consecutiveFailures >= this.failureThreshold ? 'cooldown' : 'degraded';
    candidate.cooldownUntil = Date.now() + this.cooldownMs;
  }

  private recordSuccess(candidate: RpcCandidate, latencyMs: number): void {
    candidate.latencyMs = latencyMs;
    candidate.consecutiveFailures = 0;
    candidate.consecutiveSuccesses += 1;
    candidate.cooldownUntil = 0;
    candidate.state = 'healthy';
    candidate.lastError = undefined;
    candidate.lastObservedAt = Date.now();
  }

  private eligibleCandidates(chain: SupportedChain, capability: RpcCapability, excluded = new Set<string>()): RpcCandidate[] {
    const now = Date.now();
    return (this.candidates.get(chain) || [])
      .filter(candidate => candidate.capabilities.has(capability) && !excluded.has(candidate.provider))
      .filter(candidate => candidate.state === 'healthy' && candidate.cooldownUntil <= now)
      .sort((left, right) => {
        if (left.priority !== right.priority) return right.priority - left.priority;
        return (left.latencyMs ?? Number.MAX_SAFE_INTEGER) - (right.latencyMs ?? Number.MAX_SAFE_INTEGER);
      });
  }

  private eligibleWebSocketCandidates(chain: SupportedChain, capability: RpcCapability, excluded = new Set<string>()): RpcCandidate[] {
    const now = Date.now();
    return (this.candidates.get(chain) || [])
      .filter(candidate => candidate.capabilities.has(capability) && candidate.websocketUrl && !excluded.has(candidate.provider))
      .filter(candidate => (
        candidate.websocketState === 'healthy' ||
        candidate.websocketState === 'unconfigured' ||
        (['degraded', 'cooldown'].includes(candidate.websocketState) && candidate.websocketCooldownUntil <= now)
      ))
      .sort((left, right) => {
        if (left.priority !== right.priority) return right.priority - left.priority;
        return (left.latencyMs ?? Number.MAX_SAFE_INTEGER) - (right.latencyMs ?? Number.MAX_SAFE_INTEGER);
      });
  }

  private async recoverCooldownCandidates(chain: SupportedChain, capability: RpcCapability): Promise<void> {
    const now = Date.now();
    const candidates = (this.candidates.get(chain) || [])
      .filter(candidate => candidate.capabilities.has(capability) && ['degraded', 'cooldown'].includes(candidate.state) && candidate.cooldownUntil <= now);
    await Promise.all(candidates.map(candidate => this.probeCandidate(candidate)));
  }

  async getProvider(chain: SupportedChain, capability: RpcCapability = 'json_rpc'): Promise<ManagedRpcProvider> {
    await this.ensureInitialized(chain);
    await this.recoverCooldownCandidates(chain, capability);
    const candidate = this.eligibleCandidates(chain, capability)[0];
    if (!candidate) {
      throw new Error(`No healthy configured ${capability} provider is available for ${chain}`);
    }
    return this.toManagedProvider(candidate, 'http');
  }

  async getHttpProvider(chain: SupportedChain, capability: RpcCapability = 'json_rpc'): Promise<ManagedRpcProvider> {
    return this.getProvider(chain, capability);
  }

  async execute<T>(
    chain: SupportedChain,
    capability: RpcCapability,
    operation: (provider: ethers.providers.JsonRpcProvider) => Promise<T>,
  ): Promise<{ result: T; provenance: RpcProvenance }> {
    await this.ensureInitialized(chain);
    await this.recoverCooldownCandidates(chain, capability);
    const attempted = new Set<string>();
    const candidates = [...(this.candidates.get(chain) || [])]
      .filter(candidate => candidate.capabilities.has(capability))
      .sort((left, right) => right.priority - left.priority);
    let lastError: unknown;

    for (let attempt = 0; attempt < candidates.length; attempt++) {
      const candidate = this.eligibleCandidates(chain, capability, attempted)[0];
      if (!candidate) break;
      attempted.add(candidate.provider);
      const startedAt = Date.now();
      try {
        const result = await this.withTimeout(operation(candidate.httpProvider), this.operationTimeoutMs, 'RPC operation timed out');
        this.recordSuccess(candidate, Date.now() - startedAt);
        return { result, provenance: this.toManagedProvider(candidate, 'http').provenance };
      } catch (error) {
        lastError = error;
        this.recordFailure(candidate, error);
      }
    }

    throw new Error(`RPC ${capability} operation failed for ${chain}: ${lastError instanceof Error ? lastError.message : String(lastError || 'no healthy provider')}`);
  }

  private toManagedProvider(candidate: RpcCandidate, transport: RpcTransport): ManagedRpcProvider {
    return {
      provider: candidate.provider,
      chain: candidate.chain,
      http: candidate.httpProvider,
      websocketUrl: candidate.websocketUrl,
      capabilities: candidate.capabilities,
      provenance: {
        provider: candidate.provider,
        chain: candidate.chain,
        transport,
        observedAt: candidate.lastObservedAt || Date.now(),
        latencyMs: candidate.latencyMs,
        failoverGeneration: this.failoverGenerations.get(candidate.chain) || 0,
        mode: candidate.state === 'healthy' ? 'live' : 'degraded',
      },
    };
  }

  getHealth(chain?: SupportedChain): RpcHealthSnapshot[] {
    const candidates = chain ? (this.candidates.get(chain) || []) : Array.from(this.candidates.values()).flat();
    return candidates.map(candidate => ({
      provider: candidate.provider,
      chain: candidate.chain,
      http: {
        provider: candidate.provider, chain: candidate.chain, transport: 'http', state: candidate.state,
        success: candidate.state === 'healthy', latencyMs: candidate.latencyMs, observedAt: candidate.lastObservedAt,
        consecutiveFailures: candidate.consecutiveFailures, consecutiveSuccesses: candidate.consecutiveSuccesses,
        lastError: candidate.lastError,
      },
      websocket: {
        provider: candidate.provider, chain: candidate.chain, transport: 'websocket',
        state: candidate.websocketState, success: candidate.websocketState === 'healthy', latencyMs: null,
        observedAt: candidate.websocketLastObservedAt, consecutiveFailures: candidate.websocketConsecutiveFailures,
        consecutiveSuccesses: candidate.websocketConsecutiveSuccesses,
        lastError: candidate.websocketLastError,
      },
      capabilities: Array.from(candidate.capabilities), httpUrl: candidate.httpUrl, hasWebSocket: !!candidate.websocketUrl,
    }));
  }

  async subscribe(
    chain: SupportedChain,
    type: 'blocks' | 'pending_transactions',
    callback: SubscriptionCallback,
  ): Promise<LogicalSubscription> {
    await this.ensureInitialized(chain);
    const capability: RpcCapability = type === 'blocks' ? 'subscriptions' : 'pending_transactions';
    const record: SubscriptionRecord = {
      id: `${chain}-${type}-${Date.now()}-${++this.subscriptionSequence}`,
      chain, type, capability, provider: null, transport: null, generation: 0,
      state: 'degraded', callback, currentProvider: null, socketCleanup: null,
      migrationTimer: null, migrating: false,
      pollingTimer: null,
      unsubscribe: async () => this.unsubscribe(record.id),
    };
    this.subscriptions.set(record.id, record);
    await this.connectSubscription(record);
    return record;
  }

  private async connectSubscription(record: SubscriptionRecord): Promise<void> {
    if (this.shuttingDown || record.state === 'shutting_down' || record.migrating) return;
    record.migrating = true;
    const currentCandidate = record.provider
      ? (this.candidates.get(record.chain) || []).find(candidate => candidate.provider === record.provider)
      : undefined;
    const excluded = currentCandidate && currentCandidate.websocketCooldownUntil > Date.now()
      ? new Set([currentCandidate.provider])
      : new Set<string>();
    let selectedCandidate: RpcCandidate | undefined;
    let wsProvider: ethers.providers.WebSocketProvider | null = null;
    try {
      const websocketCandidates = this.eligibleWebSocketCandidates(record.chain, record.capability, excluded);
      const alternateCandidates = record.provider
        ? websocketCandidates.filter(item => item.provider !== record.provider)
        : websocketCandidates;
      const candidate = alternateCandidates[0] || websocketCandidates[0];
      if (!candidate?.websocketUrl) throw new Error(`No healthy WebSocket provider supports ${record.type} on ${record.chain}`);
      selectedCandidate = candidate;
      candidate.websocketState = 'connecting';
      wsProvider = this.websocketProviderFactory(candidate.websocketUrl);
      const socket = (wsProvider as any)._websocket as WebSocketTransportLike | undefined;
      let opened = false;
      const cleanup = socket && typeof socket.on === 'function' ? attachWebSocketTransportGuards(socket, {
        onOpen: () => { opened = true; },
        onFailure: error => this.handleSubscriptionTransportFailure(record, candidate, error),
        onClose: () => this.handleSubscriptionTransportFailure(record, candidate, new Error('WebSocket closed')),
      }) : null;
      await this.withTimeout(wsProvider.ready, this.operationTimeoutMs, 'WebSocket connection timed out');
      if (!opened && socket) opened = true;
      const event = record.type === 'blocks' ? 'block' : 'pending';
      wsProvider.on(event, record.callback);
      record.currentProvider = wsProvider;
      record.socketCleanup = cleanup;
      record.provider = candidate.provider;
      record.transport = 'websocket';
      record.generation += 1;
      record.state = 'healthy';
      this.stopSubscriptionPolling(record);
      candidate.websocketState = 'healthy';
      candidate.websocketConsecutiveFailures = 0;
      candidate.websocketConsecutiveSuccesses += 1;
      candidate.websocketCooldownUntil = 0;
      candidate.websocketLastObservedAt = Date.now();
      candidate.websocketLastError = undefined;
      this.failoverGenerations.set(record.chain, (this.failoverGenerations.get(record.chain) || 0) + 1);
    } catch (error) {
      if (selectedCandidate) {
        const failedCandidate = selectedCandidate;
        failedCandidate.websocketConsecutiveFailures += 1;
        failedCandidate.websocketState = failedCandidate.websocketConsecutiveFailures >= this.failureThreshold ? 'cooldown' : 'degraded';
        failedCandidate.websocketCooldownUntil = Date.now() + this.cooldownMs;
        failedCandidate.websocketLastObservedAt = Date.now();
        failedCandidate.websocketConsecutiveSuccesses = 0;
        failedCandidate.websocketLastError = error instanceof Error ? error.message : String(error);
      }
      try { wsProvider?.removeAllListeners(); } catch { /* transport cleanup is best effort */ }
      try { (wsProvider as any)?.destroy?.(); } catch { /* transport cleanup is best effort */ }
      record.state = 'unavailable';
      if (record.type === 'blocks') this.startSubscriptionPolling(record);
      logger.warn('Logical RPC subscription unavailable', {
        component: 'MultiProviderRpcManager', chain: record.chain, type: record.type,
        error: error instanceof Error ? error.message : String(error),
      });
      if (selectedCandidate) this.scheduleSubscriptionMigration(record);
    } finally {
      record.migrating = false;
    }
  }

  private handleSubscriptionTransportFailure(record: SubscriptionRecord, candidate: RpcCandidate, error: unknown): void {
    if (record.state === 'shutting_down' || record.provider !== candidate.provider) return;
    candidate.websocketConsecutiveFailures += 1;
    candidate.websocketState = candidate.websocketConsecutiveFailures >= this.failureThreshold ? 'cooldown' : 'degraded';
    candidate.websocketCooldownUntil = Date.now() + this.cooldownMs;
    candidate.websocketLastObservedAt = Date.now();
    candidate.websocketConsecutiveSuccesses = 0;
    candidate.websocketLastError = error instanceof Error ? error.message : String(error);
    record.state = 'degraded';
    this.detachSubscriptionTransport(record);
    if (record.type === 'blocks') this.startSubscriptionPolling(record);
    this.scheduleSubscriptionMigration(record);
  }

  private detachSubscriptionTransport(record: SubscriptionRecord): void {
    record.socketCleanup?.();
    record.socketCleanup = null;
    try { record.currentProvider?.removeAllListeners(); } catch { /* transport cleanup is best effort */ }
    try { (record.currentProvider as any)?.destroy?.(); } catch { /* transport cleanup is best effort */ }
    record.currentProvider = null;
    record.transport = null;
  }

  private scheduleSubscriptionMigration(record: SubscriptionRecord): void {
    if (record.migrationTimer || record.state === 'shutting_down' || this.shuttingDown) return;
    record.migrationTimer = setTimeout(() => {
      record.migrationTimer = null;
      this.connectSubscription(record).catch(error => logger.warn('Subscription migration failed', {
        component: 'MultiProviderRpcManager', subscriptionId: record.id,
        error: error instanceof Error ? error.message : String(error),
      }));
    }, 1000);
  }

  private startSubscriptionPolling(record: SubscriptionRecord): void {
    if (record.pollingTimer || record.type !== 'blocks' || record.state === 'shutting_down') return;
    record.pollingTimer = setInterval(() => {
      this.execute(record.chain, 'blocks', provider => provider.getBlockNumber())
        .then(({ result }) => record.callback(result))
        .catch(error => logger.warn('Logical block subscription polling degraded', {
          component: 'MultiProviderRpcManager', chain: record.chain,
          error: error instanceof Error ? error.message : String(error),
        }));
    }, 2000);
  }

  private stopSubscriptionPolling(record: SubscriptionRecord): void {
    if (!record.pollingTimer) return;
    clearInterval(record.pollingTimer);
    record.pollingTimer = null;
  }

  private async unsubscribe(id: string): Promise<void> {
    const record = this.subscriptions.get(id);
    if (!record) return;
    record.state = 'shutting_down';
    if (record.migrationTimer) clearTimeout(record.migrationTimer);
    record.migrationTimer = null;
    this.stopSubscriptionPolling(record);
    this.detachSubscriptionTransport(record);
    this.subscriptions.delete(id);
  }

  async destroy(): Promise<void> {
    this.shuttingDown = true;
    for (const id of Array.from(this.subscriptions.keys())) await this.unsubscribe(id);
    for (const candidates of this.candidates.values()) {
      for (const candidate of candidates) {
        candidate.state = 'shutting_down';
        try { candidate.httpProvider.removeAllListeners(); } catch { /* provider cleanup is best effort */ }
      }
    }
    this.candidates.clear();
    this.initializedChains.clear();
  }
}

export const multiProviderRpcManager = new MultiProviderRpcManager();

export type EdenRegion = 
  | 'us-east-1'      // New York - Primary Eden
  | 'us-west-2'      // AWS us-west (backup)
  | 'eu-central-1'   // Frankfurt
  | 'eu-west-2'      // London
  | 'ap-northeast-1' // Tokyo
  | 'ap-southeast-1' // Singapore
  | 'local';         // Local development

export interface RateLimitConfig {
  maxRequestsPerSecond: number;
  burstLimit: number;
  cooldownMs: number;
  adaptiveThrottling: boolean;
}

export interface GasData {
  baseFee: string;
  maxPriorityFee: string;
  maxFee: string;
  gasPrice: string;
  timestamp: number;
}

export interface BlockData {
  number: number;
  hash: string;
  timestamp: number;
  transactions: string[];
  baseFeePerGas?: string;
}

export interface TransactionData {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  gasPrice: string;
  gasLimit: string;
  nonce: number;
  data: string;
  blockNumber: number | null;
  status?: 'pending' | 'confirmed' | 'failed';
}

export interface TokenTransfer {
  from: string;
  to: string;
  tokenAddress: string;
  value: string;
  tokenSymbol: string;
  tokenDecimals: number;
  transactionHash: string;
  blockNumber: number;
}

export interface ContractVerification {
  verified: boolean;
  contractName?: string;
  compiler?: string;
  sourceCode?: string;
  abi?: any[];
}

// ============================================================================
// ALCHEMY ENDPOINTS BY CHAIN AND REGION
// ============================================================================

const ALCHEMY_ENDPOINTS: Record<SupportedChain, Record<EdenRegion, string>> = {
  ethereum: {
    'us-east-1': 'https://eth-mainnet.g.alchemy.com/v2',
    'us-west-2': 'https://eth-mainnet.g.alchemy.com/v2',
    'eu-central-1': 'https://eth-mainnet.g.alchemy.com/v2',
    'eu-west-2': 'https://eth-mainnet.g.alchemy.com/v2',
    'ap-northeast-1': 'https://eth-mainnet.g.alchemy.com/v2',
    'ap-southeast-1': 'https://eth-mainnet.g.alchemy.com/v2',
    'local': 'https://eth-mainnet.g.alchemy.com/v2'
  },
  polygon: {
    'us-east-1': 'https://polygon-mainnet.g.alchemy.com/v2',
    'us-west-2': 'https://polygon-mainnet.g.alchemy.com/v2',
    'eu-central-1': 'https://polygon-mainnet.g.alchemy.com/v2',
    'eu-west-2': 'https://polygon-mainnet.g.alchemy.com/v2',
    'ap-northeast-1': 'https://polygon-mainnet.g.alchemy.com/v2',
    'ap-southeast-1': 'https://polygon-mainnet.g.alchemy.com/v2',
    'local': 'https://polygon-mainnet.g.alchemy.com/v2'
  },
  arbitrum: {
    'us-east-1': 'https://arb-mainnet.g.alchemy.com/v2',
    'us-west-2': 'https://arb-mainnet.g.alchemy.com/v2',
    'eu-central-1': 'https://arb-mainnet.g.alchemy.com/v2',
    'eu-west-2': 'https://arb-mainnet.g.alchemy.com/v2',
    'ap-northeast-1': 'https://arb-mainnet.g.alchemy.com/v2',
    'ap-southeast-1': 'https://arb-mainnet.g.alchemy.com/v2',
    'local': 'https://arb-mainnet.g.alchemy.com/v2'
  },
  optimism: {
    'us-east-1': 'https://opt-mainnet.g.alchemy.com/v2',
    'us-west-2': 'https://opt-mainnet.g.alchemy.com/v2',
    'eu-central-1': 'https://opt-mainnet.g.alchemy.com/v2',
    'eu-west-2': 'https://opt-mainnet.g.alchemy.com/v2',
    'ap-northeast-1': 'https://opt-mainnet.g.alchemy.com/v2',
    'ap-southeast-1': 'https://opt-mainnet.g.alchemy.com/v2',
    'local': 'https://opt-mainnet.g.alchemy.com/v2'
  },
  base: {
    'us-east-1': 'https://base-mainnet.g.alchemy.com/v2',
    'us-west-2': 'https://base-mainnet.g.alchemy.com/v2',
    'eu-central-1': 'https://base-mainnet.g.alchemy.com/v2',
    'eu-west-2': 'https://base-mainnet.g.alchemy.com/v2',
    'ap-northeast-1': 'https://base-mainnet.g.alchemy.com/v2',
    'ap-southeast-1': 'https://base-mainnet.g.alchemy.com/v2',
    'local': 'https://base-mainnet.g.alchemy.com/v2'
  }
};

const ALCHEMY_WS_ENDPOINTS: Record<SupportedChain, string> = {
  ethereum: 'wss://eth-mainnet.g.alchemy.com/v2',
  polygon: 'wss://polygon-mainnet.g.alchemy.com/v2',
  arbitrum: 'wss://arb-mainnet.g.alchemy.com/v2',
  optimism: 'wss://opt-mainnet.g.alchemy.com/v2',
  base: 'wss://base-mainnet.g.alchemy.com/v2'
};

// ============================================================================
// ETHERSCAN ENDPOINTS BY CHAIN
// ============================================================================

const ETHERSCAN_ENDPOINTS: Record<SupportedChain, string> = {
  ethereum: 'https://api.etherscan.io/api',
  polygon: 'https://api.polygonscan.com/api',
  arbitrum: 'https://api.arbiscan.io/api',
  optimism: 'https://api-optimistic.etherscan.io/api',
  base: 'https://api.basescan.org/api'
};

// ============================================================================
// ADVANCED RATE LIMITER - Sliding Window + Adaptive Throttling
// ============================================================================

export class AdvancedRateLimiter {
  private requestTimestamps: number[] = [];
  private burstTimestamps: number[] = [];
  private currentCooldown: number = 0;
  private errorCount: number = 0;
  private lastErrorTime: number = 0;
  private adaptiveMultiplier: number = 1.0;

  constructor(private config: RateLimitConfig) {}

  /**
   * Check if request can proceed using sliding window algorithm
   */
  async canProceed(): Promise<boolean> {
    const now = Date.now();
    
    // Check cooldown
    if (this.currentCooldown > now) {
      return false;
    }

    // Clean old timestamps (sliding window of 1 second)
    this.requestTimestamps = this.requestTimestamps.filter(
      ts => now - ts < 1000
    );
    
    // Clean old burst timestamps (10 second window)
    this.burstTimestamps = this.burstTimestamps.filter(
      ts => now - ts < 10000
    );

    // Calculate effective limit with adaptive throttling
    const effectiveLimit = Math.floor(
      this.config.maxRequestsPerSecond / this.adaptiveMultiplier
    );

    // Check sliding window limit
    if (this.requestTimestamps.length >= effectiveLimit) {
      return false;
    }

    // Check burst limit
    if (this.burstTimestamps.length >= this.config.burstLimit) {
      this.currentCooldown = now + this.config.cooldownMs;
      return false;
    }

    return true;
  }

  /**
   * Record a successful request
   */
  recordRequest(): void {
    const now = Date.now();
    this.requestTimestamps.push(now);
    this.burstTimestamps.push(now);

    // Decay error count over time
    if (now - this.lastErrorTime > 60000) {
      this.errorCount = Math.max(0, this.errorCount - 1);
      this.adaptiveMultiplier = Math.max(1.0, this.adaptiveMultiplier - 0.1);
    }
  }

  /**
   * Record an error (rate limit hit or API error)
   */
  recordError(isRateLimit: boolean = false): void {
    const now = Date.now();
    this.lastErrorTime = now;
    this.errorCount++;

    if (this.config.adaptiveThrottling) {
      if (isRateLimit) {
        // Aggressive backoff for rate limits
        this.adaptiveMultiplier = Math.min(10.0, this.adaptiveMultiplier * 2);
        this.currentCooldown = now + (this.config.cooldownMs * this.adaptiveMultiplier);
      } else {
        // Moderate backoff for other errors
        this.adaptiveMultiplier = Math.min(5.0, this.adaptiveMultiplier + 0.5);
      }
    }

    logger.warn('Rate limiter recorded error', {
      component: 'AdvancedRateLimiter',
      isRateLimit,
      errorCount: this.errorCount,
      adaptiveMultiplier: this.adaptiveMultiplier
    });
  }

  /**
   * Wait until request can proceed
   */
  async waitForSlot(): Promise<void> {
    while (!(await this.canProceed())) {
      // Add jitter to prevent thundering herd
      const jitter = Math.random() * 52 + 5; // 5-57ms
      await new Promise(resolve => setTimeout(resolve, jitter));
    }
  }

  /**
   * Get current stats
   */
  getStats(): { requestsInWindow: number; burstCount: number; cooldownRemaining: number; adaptiveMultiplier: number } {
    const now = Date.now();
    return {
      requestsInWindow: this.requestTimestamps.filter(ts => now - ts < 1000).length,
      burstCount: this.burstTimestamps.filter(ts => now - ts < 10000).length,
      cooldownRemaining: Math.max(0, this.currentCooldown - now),
      adaptiveMultiplier: this.adaptiveMultiplier
    };
  }
}

// ============================================================================
// ALCHEMY PROVIDER - Network Access Layer
// ============================================================================

export class AlchemyProvider {
  private httpProvider: ethers.providers.JsonRpcProvider | null = null;
  private wsProvider: ethers.providers.WebSocketProvider | null = null;
  private rateLimiter: AdvancedRateLimiter;
  private chain: SupportedChain;
  private region: EdenRegion;
  private apiKey: string;
  private latencyHistory: number[] = [];
  private readonly MAX_LATENCY_SAMPLES = 100;
  private wsState: RpcProviderState = 'unconfigured';
  private wsFailureCount = 0;
  private wsReconnectTimer: NodeJS.Timeout | null = null;
  private wsReconnecting = false;
  private blockSubscriptions: Array<(blockNumber: number) => void> = [];
  private pendingSubscriptions: Array<(txHash: string) => void> = [];
  private blockPollingTimer: NodeJS.Timeout | null = null;
  private wsSocket: { on?: (event: string, listener: (...args: any[]) => void) => void; removeAllListeners?: () => void; close?: () => void; terminate?: () => void } | null = null;

  constructor(config: BlockchainProviderConfig) {
    this.chain = config.chain;
    this.region = config.region || 'us-east-1';
    this.apiKey = config.alchemyApiKey || process.env.ALCHEMY_API_KEY || '';
    
    // Alchemy free tier: 330 CU/s, ~25-30 requests/second
    this.rateLimiter = new AdvancedRateLimiter({
      maxRequestsPerSecond: 25,
      burstLimit: 100,
      cooldownMs: 1000,
      adaptiveThrottling: true
    });
  }

  /**
   * Initialize HTTP and WebSocket providers
   */
  async initialize(): Promise<void> {
    if (!this.apiKey) {
      this.wsState = 'unconfigured';
      throw new Error(`ALCHEMY_API_KEY is required for ${this.chain} Alchemy access`);
    }
    const httpUrl = `${ALCHEMY_ENDPOINTS[this.chain][this.region]}/${this.apiKey}`;
    const wsUrl = `${ALCHEMY_WS_ENDPOINTS[this.chain]}/${this.apiKey}`;

    try {
      this.httpProvider = new ethers.providers.JsonRpcProvider(httpUrl);
      
      // Test connection with latency measurement
      const start = Date.now();
      await this.httpProvider.getBlockNumber();
      const latency = Date.now() - start;
      this.recordLatency(latency);

      logger.info('Alchemy HTTP provider initialized', {
        component: 'AlchemyProvider',
        chain: this.chain,
        region: this.region,
        latency: `${latency}ms`
      });

      // Initialize WebSocket for real-time data
      try {
        await this.connectWebSocket(wsUrl);
        logger.info('Alchemy WebSocket provider initialized', {
          component: 'AlchemyProvider',
          chain: this.chain
        });
      } catch (wsError) {
        this.wsState = 'degraded';
        this.destroyFailedWebSocket();
        this.startBlockPolling();
        this.scheduleWebSocketReconnect();
        logger.warn('WebSocket initialization failed, using HTTP only', {
          component: 'AlchemyProvider',
          error: wsError instanceof Error ? wsError.message : String(wsError)
        });
      }
    } catch (error) {
      logger.error('Failed to initialize Alchemy provider', {
        component: 'AlchemyProvider',
        chain: this.chain,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private async connectWebSocket(wsUrl: string): Promise<void> {
    this.wsState = 'connecting';
    const provider = new ethers.providers.WebSocketProvider(wsUrl);
    this.wsProvider = provider;
    this.attachWebSocketGuards();
    await provider.ready;
    this.wsState = 'healthy';
    if (this.blockPollingTimer) {
      clearInterval(this.blockPollingTimer);
      this.blockPollingTimer = null;
    }
    this.blockSubscriptions.forEach(callback => provider.on('block', callback));
    this.pendingSubscriptions.forEach(callback => provider.on('pending', callback));
  }

  private attachWebSocketGuards(): void {
    const socket = (this.wsProvider as any)?._websocket;
    if (!socket || typeof socket.on !== 'function') {
      this.wsState = 'degraded';
      return;
    }
    this.wsSocket = socket;
    attachWebSocketTransportGuards(socket, {
      onOpen: () => {
      this.wsState = 'healthy';
      this.wsFailureCount = 0;
      },
      onFailure: (error: unknown) => {
      this.wsFailureCount++;
      this.wsState = 'degraded';
      logger.warn('Alchemy WebSocket transport degraded; HTTP remains available', {
        component: 'AlchemyProvider', chain: this.chain,
        error: error instanceof Error ? error.message : String(error),
      });
      this.destroyFailedWebSocket();
      this.startBlockPolling();
      this.scheduleWebSocketReconnect();
      },
      onClose: () => {
      if (this.wsState !== 'shutting_down') {
        this.wsState = 'degraded';
        this.scheduleWebSocketReconnect();
      }
      },
    });
  }

  private scheduleWebSocketReconnect(): void {
    if (this.wsReconnectTimer || this.wsReconnecting || this.wsState === 'shutting_down') return;
    this.wsReconnectTimer = setTimeout(async () => {
      this.wsReconnectTimer = null;
      this.wsReconnecting = true;
      try {
        await this.connectWebSocket(`${ALCHEMY_WS_ENDPOINTS[this.chain]}/${this.apiKey}`);
      } catch (error) {
        this.wsState = 'degraded';
        logger.warn('Alchemy WebSocket reconnect failed; HTTP remains available', {
          component: 'AlchemyProvider', chain: this.chain,
          error: error instanceof Error ? error.message : String(error),
        });
        this.scheduleWebSocketReconnect();
      } finally {
        this.wsReconnecting = false;
      }
    }, Math.max(1000, Number(process.env.ALCHEMY_WS_RECONNECT_DELAY_MS || 5000)));
  }

  private destroyFailedWebSocket(): void {
    const socket = this.wsSocket;
    if (!socket) return;
    try { socket.removeAllListeners?.(); } catch { /* transport cleanup is best effort */ }
    try { socket.terminate?.(); } catch { try { socket.close?.(); } catch { /* already closed */ } }
    this.wsSocket = null;
    this.wsProvider?.removeAllListeners();
    this.wsProvider = null;
  }

  getHealth(): RpcHealthObservation {
    return {
      provider: 'Alchemy', chain: this.chain, transport: 'websocket', state: this.wsState,
      success: this.wsState === 'healthy', latencyMs: this.getAverageLatency() || null,
      observedAt: Date.now(), consecutiveFailures: this.wsFailureCount,
      consecutiveSuccesses: this.wsState === 'healthy' ? 1 : 0,
    };
  }

  /**
   * Record latency for performance monitoring
   */
  private recordLatency(latency: number): void {
    this.latencyHistory.push(latency);
    if (this.latencyHistory.length > this.MAX_LATENCY_SAMPLES) {
      this.latencyHistory.shift();
    }
  }

  /**
   * Get average latency
   */
  getAverageLatency(): number {
    if (this.latencyHistory.length === 0) return 0;
    return this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length;
  }

  /**
   * Get current block number
   */
  async getBlockNumber(): Promise<number> {
    await this.rateLimiter.waitForSlot();
    
    const start = Date.now();
    try {
      const blockNumber = await this.httpProvider!.getBlockNumber();
      this.rateLimiter.recordRequest();
      this.recordLatency(Date.now() - start);
      return blockNumber;
    } catch (error) {
      this.rateLimiter.recordError(this.isRateLimitError(error));
      throw error;
    }
  }

  /**
   * Get block by number
   */
  async getBlock(blockNumber: number | 'latest' | 'pending'): Promise<BlockData | null> {
    await this.rateLimiter.waitForSlot();

    const start = Date.now();
    try {
      const block = await this.httpProvider!.getBlock(blockNumber);
      this.rateLimiter.recordRequest();
      this.recordLatency(Date.now() - start);

      if (!block) return null;

      return {
        number: block.number,
        hash: block.hash || '',
        timestamp: block.timestamp,
        transactions: block.transactions as string[],
        baseFeePerGas: block.baseFeePerGas?.toString()
      };
    } catch (error) {
      this.rateLimiter.recordError(this.isRateLimitError(error));
      throw error;
    }
  }

  /**
   * Get gas price data (EIP-1559 compatible)
   */
  async getGasData(): Promise<GasData> {
    await this.rateLimiter.waitForSlot();

    const start = Date.now();
    try {
      const feeData = await this.httpProvider!.getFeeData();
      this.rateLimiter.recordRequest();
      this.recordLatency(Date.now() - start);

      return {
        baseFee: (feeData.maxFeePerGas || ethers.BigNumber.from(0)).toString(),
        maxPriorityFee: (feeData.maxPriorityFeePerGas || ethers.BigNumber.from(0)).toString(),
        maxFee: (feeData.maxFeePerGas || ethers.BigNumber.from(0)).toString(),
        gasPrice: (feeData.gasPrice || ethers.BigNumber.from(0)).toString(),
        timestamp: Date.now()
      };
    } catch (error) {
      this.rateLimiter.recordError(this.isRateLimitError(error));
      throw error;
    }
  }

  /**
   * Get pending transactions from mempool (Alchemy enhanced API)
   */
  async getPendingTransactions(options?: { fromAddress?: string; toAddress?: string }): Promise<TransactionData[]> {
    await this.rateLimiter.waitForSlot();

    const start = Date.now();
    try {
      // Use Alchemy's alchemy_pendingTransactions enhanced API
      const params: any = {};
      if (options?.fromAddress) params.fromAddress = options.fromAddress;
      if (options?.toAddress) params.toAddress = options.toAddress;

      const result = await this.httpProvider!.send('alchemy_pendingTransactions', [params]);
      this.rateLimiter.recordRequest();
      this.recordLatency(Date.now() - start);

      return (result || []).map((tx: any) => ({
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: tx.value || '0',
        gasPrice: tx.gasPrice || '0',
        gasLimit: tx.gas || '0',
        nonce: parseInt(tx.nonce, 16),
        data: tx.input,
        blockNumber: null,
        status: 'pending' as const
      }));
    } catch (error) {
      this.rateLimiter.recordError(this.isRateLimitError(error));
      throw error;
    }
  }

  /**
   * Subscribe to new blocks (WebSocket)
   */
  onBlock(callback: (blockNumber: number) => void): void {
    this.blockSubscriptions.push(callback);
    if (this.wsProvider) {
      this.wsProvider.on('block', callback);
    } else this.startBlockPolling();
  }

  private startBlockPolling(): void {
    if (this.blockPollingTimer) return;
    this.blockPollingTimer = setInterval(async () => {
      try {
        const blockNumber = await this.getBlockNumber();
        this.blockSubscriptions.forEach(callback => callback(blockNumber));
      } catch (error) {
        logger.warn('Alchemy HTTP block polling degraded', { component: 'AlchemyProvider', error });
      }
    }, 2000);
  }

  /**
   * Subscribe to pending transactions (WebSocket)
   */
  onPendingTransaction(callback: (txHash: string) => void): void {
    this.pendingSubscriptions.push(callback);
    if (this.wsProvider) {
      this.wsProvider.on('pending', callback);
    }
  }

  /**
   * Send raw transaction
   */
  async sendTransaction(signedTx: string): Promise<string> {
    getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: this.chain });
    await this.rateLimiter.waitForSlot();

    const start = Date.now();
    try {
      const response = await this.httpProvider!.sendTransaction(signedTx);
      this.rateLimiter.recordRequest();
      this.recordLatency(Date.now() - start);
      return response.hash;
    } catch (error) {
      this.rateLimiter.recordError(this.isRateLimitError(error));
      throw error;
    }
  }

  /**
   * Get transaction receipt
   */
  async getTransactionReceipt(txHash: string): Promise<ethers.providers.TransactionReceipt | null> {
    await this.rateLimiter.waitForSlot();

    const start = Date.now();
    try {
      const receipt = await this.httpProvider!.getTransactionReceipt(txHash);
      this.rateLimiter.recordRequest();
      this.recordLatency(Date.now() - start);
      return receipt;
    } catch (error) {
      this.rateLimiter.recordError(this.isRateLimitError(error));
      throw error;
    }
  }

  /**
   * Check if error is a rate limit error
   */
  private isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes('rate limit') || 
             message.includes('429') ||
             message.includes('too many requests') ||
             message.includes('compute units');
    }
    return false;
  }

  /**
   * Get rate limiter stats
   */
  getRateLimitStats() {
    return this.rateLimiter.getStats();
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    this.wsState = 'shutting_down';
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.blockPollingTimer) {
      clearInterval(this.blockPollingTimer);
      this.blockPollingTimer = null;
    }
    this.wsReconnecting = false;
    this.destroyFailedWebSocket();
    if (this.wsProvider) {
      // ethers v5 doesn't have destroy method, use removeAllListeners
      this.wsProvider.removeAllListeners();
    }
    this.blockSubscriptions = [];
    this.pendingSubscriptions = [];
  }
}

// ============================================================================
// ETHERSCAN PROVIDER - Data Layer
// ============================================================================

export class EtherscanProvider {
  private baseUrl: string;
  private apiKey: string;
  private rateLimiter: AdvancedRateLimiter;
  private chain: SupportedChain;
  private responseCache: Map<string, { value: unknown; expiresAt: number }> = new Map();
  private inFlightRequests: Map<string, Promise<unknown>> = new Map();

  constructor(config: BlockchainProviderConfig) {
    this.chain = config.chain;
    this.baseUrl = ETHERSCAN_ENDPOINTS[config.chain];
    this.apiKey = config.etherscanApiKey || process.env.ETHERSCAN_API_KEY || '';

    // Etherscan free tier: 5 calls/second
    this.rateLimiter = new AdvancedRateLimiter({
      maxRequestsPerSecond: 5,
      burstLimit: 20,
      cooldownMs: 1000,
      adaptiveThrottling: true
    });
  }

  private getCacheKey(params: Record<string, string>): string {
    const encoded = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    return `${this.chain}:${encoded}`;
  }

  private getCacheTtlMs(params: Record<string, string>): number {
    const action = params.action || '';
    switch (action) {
      case 'gasoracle':
        return 5000;
      case 'balance':
        return 6000;
      case 'txlist':
      case 'tokentx':
        return 8000;
      case 'getabi':
      case 'getsourcecode':
      case 'tokeninfo':
        return 60000;
      default:
        return 5000;
    }
  }

  private getCached<T>(cacheKey: string): T | null {
    const cached = this.responseCache.get(cacheKey);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      this.responseCache.delete(cacheKey);
      return null;
    }
    return cached.value as T;
  }

  private setCached<T>(cacheKey: string, value: T, ttlMs: number): void {
    this.responseCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + ttlMs,
    });

    if (this.responseCache.size > 512) {
      for (const [key, entry] of this.responseCache.entries()) {
        if (entry.expiresAt <= Date.now()) {
          this.responseCache.delete(key);
        }
      }
    }
  }

  /**
   * Make API request to Etherscan
   */
  private async request<T>(params: Record<string, string>): Promise<T> {
    const cacheKey = this.getCacheKey(params);
    const cached = this.getCached<T>(cacheKey);
    if (cached !== null) return cached;

    const inFlight = this.inFlightRequests.get(cacheKey);
    if (inFlight) return inFlight as Promise<T>;

    const requestPromise = (async (): Promise<T> => {
      await this.rateLimiter.waitForSlot();

      const url = new URL(this.baseUrl);
      url.searchParams.set('apikey', this.apiKey);
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });

      const data = await fetchJsonWithRetry<any>(url.toString(), {
        maxRetries: 3,
        baseDelayMs: 500,
        maxDelayMs: 10000,
        timeoutMs: 10000,
      });

      this.rateLimiter.recordRequest();

      if (data.status === '0' && data.message !== 'No transactions found') {
        if (typeof data.result === 'string' && data.result.toLowerCase().includes('rate limit')) {
          this.rateLimiter.recordError(true);
        }
        throw new Error(data.result || data.message || 'Etherscan request failed');
      }

      const result = data.result as T;
      this.setCached(cacheKey, result, this.getCacheTtlMs(params));
      return result;
    })()
      .catch(error => {
        this.rateLimiter.recordError(this.isRateLimitError(error));
        throw error;
      })
      .finally(() => {
        this.inFlightRequests.delete(cacheKey);
      });

    this.inFlightRequests.set(cacheKey, requestPromise);
    return requestPromise as Promise<T>;
  }

  /**
   * Get account balance
   */
  async getBalance(address: string): Promise<bigint> {
    const result = await this.request<string>({
      module: 'account',
      action: 'balance',
      address,
      tag: 'latest'
    });
    return BigInt(result);
  }

  /**
   * Get token transfers for address
   */
  async getTokenTransfers(address: string, options?: {
    contractAddress?: string;
    startBlock?: number;
    endBlock?: number;
    page?: number;
    offset?: number;
  }): Promise<TokenTransfer[]> {
    const params: Record<string, string> = {
      module: 'account',
      action: 'tokentx',
      address,
      sort: 'desc'
    };

    if (options?.contractAddress) params.contractaddress = options.contractAddress;
    if (options?.startBlock) params.startblock = options.startBlock.toString();
    if (options?.endBlock) params.endblock = options.endBlock.toString();
    if (options?.page) params.page = options.page.toString();
    if (options?.offset) params.offset = options.offset.toString();

    const result = await this.request<any[]>(params);
    
    return (result || []).map(tx => ({
      from: tx.from,
      to: tx.to,
      tokenAddress: tx.contractAddress,
      value: tx.value,
      tokenSymbol: tx.tokenSymbol,
      tokenDecimals: parseInt(tx.tokenDecimal),
      transactionHash: tx.hash,
      blockNumber: parseInt(tx.blockNumber)
    }));
  }

  /**
   * Get normal transactions for address
   */
  async getTransactions(address: string, options?: {
    startBlock?: number;
    endBlock?: number;
    page?: number;
    offset?: number;
  }): Promise<TransactionData[]> {
    const params: Record<string, string> = {
      module: 'account',
      action: 'txlist',
      address,
      sort: 'desc'
    };

    if (options?.startBlock) params.startblock = options.startBlock.toString();
    if (options?.endBlock) params.endblock = options.endBlock.toString();
    if (options?.page) params.page = options.page.toString();
    if (options?.offset) params.offset = options.offset.toString();

    const result = await this.request<any[]>(params);

    return (result || []).map(tx => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value || '0',
      gasPrice: tx.gasPrice || '0',
      gasLimit: tx.gas || '0',
      nonce: parseInt(tx.nonce),
      data: tx.input,
      blockNumber: parseInt(tx.blockNumber),
      status: tx.isError === '0' ? 'confirmed' as const : 'failed' as const
    }));
  }

  /**
   * Get contract ABI (verified contracts only)
   */
  async getContractABI(contractAddress: string): Promise<any[] | null> {
    try {
      const result = await this.request<string>({
        module: 'contract',
        action: 'getabi',
        address: contractAddress
      });
      return JSON.parse(result);
    } catch {
      return null;
    }
  }

  /**
   * Get contract source code and verification status
   */
  async getContractVerification(contractAddress: string): Promise<ContractVerification> {
    try {
      const result = await this.request<any[]>({
        module: 'contract',
        action: 'getsourcecode',
        address: contractAddress
      });

      if (!result || result.length === 0 || !result[0].SourceCode) {
        return { verified: false };
      }

      const contract = result[0];
      return {
        verified: true,
        contractName: contract.ContractName,
        compiler: contract.CompilerVersion,
        sourceCode: contract.SourceCode,
        abi: contract.ABI ? JSON.parse(contract.ABI) : undefined
      };
    } catch {
      return { verified: false };
    }
  }

  /**
   * Get gas oracle data
   */
  async getGasOracle(): Promise<{ SafeGasPrice: string; ProposeGasPrice: string; FastGasPrice: string }> {
    return await this.request({
      module: 'gastracker',
      action: 'gasoracle'
    });
  }

  /**
   * Get ERC20 token info
   */
  async getTokenInfo(contractAddress: string): Promise<{
    name: string;
    symbol: string;
    decimals: number;
    totalSupply: string;
  } | null> {
    try {
      const result = await this.request<any>({
        module: 'token',
        action: 'tokeninfo',
        contractaddress: contractAddress
      });

      if (!result || result.length === 0) return null;

      const token = Array.isArray(result) ? result[0] : result;
      return {
        name: token.name || token.tokenName,
        symbol: token.symbol || token.tokenSymbol,
        decimals: parseInt(token.decimals || token.tokenDecimal || '18'),
        totalSupply: token.totalSupply || '0'
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if error is rate limit error
   */
  private isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes('rate limit') ||
             message.includes('max rate limit') ||
             message.includes('too many');
    }
    return false;
  }

  /**
   * Get rate limiter stats
   */
  getRateLimitStats() {
    return this.rateLimiter.getStats();
  }
}

// ============================================================================
// UNIFIED BLOCKCHAIN API SERVICE
// ============================================================================

export class BlockchainAPIService {
  private alchemyProviders: Map<SupportedChain, AlchemyProvider> = new Map();
  private etherscanProviders: Map<SupportedChain, EtherscanProvider> = new Map();
  private initialized: boolean = false;

  /**
   * Initialize providers for all chains
   */
  async initialize(chains: SupportedChain[] = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base']): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing Blockchain API Service', {
      component: 'BlockchainAPIService',
      chains
    });

    for (const chain of chains) {
      // Initialize Alchemy (access layer)
      if (process.env.ALCHEMY_API_KEY?.trim()) {
        const alchemyProvider = new AlchemyProvider({
          chain,
          alchemyApiKey: process.env.ALCHEMY_API_KEY,
          region: (process.env.EDEN_REGION as EdenRegion) || 'us-east-1'
        });
        try {
          await alchemyProvider.initialize();
          this.alchemyProviders.set(chain, alchemyProvider);
        } catch (error) {
          logger.warn('Alchemy unavailable; continuing with independent provider paths', {
            component: 'BlockchainAPIService',
            chain,
            error: error instanceof Error ? error.message : String(error),
          });
          await alchemyProvider.destroy();
        }
      } else {
        logger.info('Alchemy is unconfigured; continuing without Alchemy access layer', {
          component: 'BlockchainAPIService', chain,
        });
      }

      // Initialize Etherscan (data layer)
      const etherscanProvider = new EtherscanProvider({
        chain,
        etherscanApiKey: process.env.ETHERSCAN_API_KEY
      });
      this.etherscanProviders.set(chain, etherscanProvider);
    }

    this.initialized = true;
    logger.info('Blockchain API Service initialized', {
      component: 'BlockchainAPIService',
      alchemyChains: Array.from(this.alchemyProviders.keys()),
      etherscanChains: Array.from(this.etherscanProviders.keys())
    });
  }

  /**
   * Get Alchemy provider for chain (access operations)
   */
  getAlchemy(chain: SupportedChain): AlchemyProvider {
    const provider = this.alchemyProviders.get(chain);
    if (!provider) {
      throw new Error(`Alchemy provider not initialized for chain: ${chain}`);
    }
    return provider;
  }

  /**
   * Get Etherscan provider for chain (data operations)
   */
  getEtherscan(chain: SupportedChain): EtherscanProvider {
    const provider = this.etherscanProviders.get(chain);
    if (!provider) {
      throw new Error(`Etherscan provider not initialized for chain: ${chain}`);
    }
    return provider;
  }

  /**
   * Get all provider stats
   */
  getStats(): Record<string, any> {
    const stats: Record<string, any> = {};

    Array.from(this.alchemyProviders.entries()).forEach(([chain, provider]) => {
      stats[`alchemy_${chain}`] = {
        rateLimitStats: provider.getRateLimitStats(),
        avgLatency: provider.getAverageLatency(),
        health: provider.getHealth(),
      };
    });

    Array.from(this.etherscanProviders.entries()).forEach(([chain, provider]) => {
      stats[`etherscan_${chain}`] = {
        rateLimitStats: provider.getRateLimitStats()
      };
    });

    return stats;
  }

  /**
   * Cleanup all resources
   */
  async destroy(): Promise<void> {
    for (const provider of Array.from(this.alchemyProviders.values())) {
      await provider.destroy();
    }
    this.alchemyProviders.clear();
    this.etherscanProviders.clear();
    this.initialized = false;
  }
}

// Singleton instance
export const blockchainAPI = new BlockchainAPIService();
