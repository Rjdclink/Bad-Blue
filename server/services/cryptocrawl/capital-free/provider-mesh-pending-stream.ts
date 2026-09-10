import WebSocket from 'ws';
import logger from '../../../logger.js';
import {
  multiProviderRpcManager,
  type LogicalSubscription,
  type SupportedChain,
} from '../api/blockchain-providers.js';

export type ProviderMeshPendingNetwork = 'ethereum' | 'polygon';

export interface ProviderMeshPendingTransaction {
  chain: ProviderMeshPendingNetwork;
  hash: string;
  from: string;
  to: string;
  value: string;
  gas: string;
  gasPrice: string;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  input: string;
  nonce: string;
  timestamp: number;
  potentialArbitrage: boolean;
  decodedMethod: string | null;
  provenance: string[];
}

export interface ProviderMeshPendingStats {
  authority: 'mempool_evidence_only';
  executionAuthority: false;
  running: boolean;
  configuredNetworks: ProviderMeshPendingNetwork[];
  activeNetworks: ProviderMeshPendingNetwork[];
  fullTransactionPushes: number;
  fallbackHashes: number;
  fallbackDetailFetches: number;
  fallbackDetailFetchesBlockedByBudget: number;
  cachedTransactions: number;
  reconnects: number;
  errors: number;
  lastObservationAt: number | null;
  hashesOnly: false;
  providerSideAddressFilter: false;
  applicationSideRouterFilter: true;
  exactChainBinding: true;
  alchemyDependency: false;
}

interface StreamState {
  network: ProviderMeshPendingNetwork;
  socket: WebSocket | null;
  subscriptionId: string | null;
  reconnectTimer: NodeJS.Timeout | null;
  fallbackSubscription: LogicalSubscription | null;
  closedByOperator: boolean;
}

const FREE_FULL_PENDING_ENDPOINTS: Record<ProviderMeshPendingNetwork, string> = {
  ethereum: 'wss://eth.drpc.org',
  polygon: 'wss://polygon.drpc.org',
};

const DEX_ROUTERS: Record<ProviderMeshPendingNetwork, Set<string>> = {
  ethereum: new Set([
    '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
    '0xe592427a0aece92de3edee1f18e0157c05861564',
    '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f',
  ]),
  polygon: new Set([
    '0xa5e0829caced8ffdd4de3c43696c57f7d7a678ff',
    '0x1b02da8cb0d097eb8d57a175b88c7d8b47997506',
  ]),
};

const SWAP_SIGNATURES = new Set([
  '0x38ed1739', '0x8803dbee', '0x7ff36ab5', '0xfb3bdb41', '0x18cbafe5',
  '0x4a25d94a', '0x5c11d795', '0xb6f9de95', '0x791ac947', '0x414bf389',
  '0xc04b8d59', '0xdb3e2198', '0xf28c0498',
]);

const CACHE_TTL_MS = Math.max(5_000, Number(process.env.CRYPTOCRAWL_PENDING_CACHE_TTL_MS || 60_000));
const MAX_CACHE = Math.max(100, Math.min(10_000, Number(process.env.CRYPTOCRAWL_PENDING_MAX_CACHE || 2_000)));
const MAX_FALLBACK_DETAILS_PER_MINUTE = Math.max(1, Math.min(5_000, Number(process.env.CRYPTOCRAWL_PENDING_MAX_DETAILS_PER_MINUTE || 120)));
const RECONNECT_MS = Math.max(1_000, Number(process.env.CRYPTOCRAWL_PENDING_RECONNECT_MS || 5_000));

function configuredNetworks(): ProviderMeshPendingNetwork[] {
  const raw = process.env.CRYPTOCRAWL_MEMPOOL_NETWORKS?.trim();
  const supported = new Set<ProviderMeshPendingNetwork>(['ethereum', 'polygon']);
  if (!raw) return ['ethereum', 'polygon'];
  return [...new Set(raw.split(',')
    .map(value => value.trim().toLowerCase())
    .filter((value): value is ProviderMeshPendingNetwork => supported.has(value as ProviderMeshPendingNetwork)))];
}

function monitoringEnabled(): boolean {
  if (process.env.NO_INTERVALS === 'true') return false;
  return process.env.CRYPTOCRAWL_PROVIDER_MESH_MEMPOOL_ENABLED?.trim().toLowerCase() !== 'false';
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function hex(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return `0x${value.toString(16)}`;
  const candidate = value as { toHexString?: () => string };
  return typeof candidate.toHexString === 'function' ? candidate.toHexString() : String(value);
}

function decodeMethod(input: string): string | null {
  if (!input || input.length < 10) return null;
  const known: Record<string, string> = {
    '0x38ed1739': 'swapExactTokensForTokens',
    '0x8803dbee': 'swapTokensForExactTokens',
    '0x7ff36ab5': 'swapExactETHForTokens',
    '0xfb3bdb41': 'swapETHForExactTokens',
    '0x18cbafe5': 'swapExactTokensForETH',
    '0x4a25d94a': 'swapTokensForExactETH',
    '0x414bf389': 'exactInputSingle',
    '0xc04b8d59': 'exactInput',
    '0xdb3e2198': 'exactOutputSingle',
    '0xf28c0498': 'exactOutput',
  };
  return known[input.slice(0, 10).toLowerCase()] || null;
}

function relevantTransaction(network: ProviderMeshPendingNetwork, transaction: any): boolean {
  const to = String(transaction?.to || '').toLowerCase();
  const input = String(transaction?.input ?? transaction?.data ?? '');
  const signature = input.length >= 10 ? input.slice(0, 10).toLowerCase() : '';
  return DEX_ROUTERS[network].has(to) || SWAP_SIGNATURES.has(signature);
}

class ProviderMeshPendingStream {
  private readonly states = new Map<ProviderMeshPendingNetwork, StreamState>();
  private readonly transactions = new Map<string, ProviderMeshPendingTransaction>();
  private readonly fallbackDetailRequestTimes: number[] = [];
  private running = false;
  private fullTransactionPushes = 0;
  private fallbackHashes = 0;
  private fallbackDetailFetches = 0;
  private fallbackDetailFetchesBlockedByBudget = 0;
  private reconnects = 0;
  private errors = 0;
  private lastObservationAt: number | null = null;

  start(): void {
    if (this.running || !monitoringEnabled()) return;
    const networks = configuredNetworks();
    if (networks.length === 0) return;
    this.running = true;
    for (const network of networks) this.connectFreeFullPending(network);
    logger.info('[ProviderMeshPending] Alchemy-free pending monitoring enabled', {
      component: 'ProviderMeshPendingStream',
      networks,
      primaryTransport: 'dRPC_public_full_pending_websocket',
      fallbackTransport: 'canonical_rpc_manager_standard_pending_hashes',
      providerSideAddressFilter: false,
      applicationSideRouterFilter: true,
      exactChainBinding: true,
      alchemyDependency: false,
      operatorBillingLiability: false,
      executionAuthority: false,
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    const cleanups: Promise<void>[] = [];
    for (const state of this.states.values()) {
      state.closedByOperator = true;
      if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
      if (state.fallbackSubscription) cleanups.push(state.fallbackSubscription.unsubscribe().catch(() => undefined));
      state.fallbackSubscription = null;
      try { state.socket?.close(); } catch { /* already closed */ }
      state.socket = null;
      state.subscriptionId = null;
    }
    this.states.clear();
    await Promise.all(cleanups);
  }

  getRecentObservations(maxAgeMs = 15_000): ProviderMeshPendingTransaction[] {
    const now = Date.now();
    this.prune(now);
    return [...this.transactions.values()]
      .filter(transaction => now - transaction.timestamp <= Math.max(1_000, maxAgeMs))
      .sort((left, right) => right.timestamp - left.timestamp)
      .map(transaction => ({ ...transaction, provenance: [...transaction.provenance] }));
  }

  getStatistics(): ProviderMeshPendingStats {
    this.prune(Date.now());
    return {
      authority: 'mempool_evidence_only',
      executionAuthority: false,
      running: this.running,
      configuredNetworks: configuredNetworks(),
      activeNetworks: [...this.states.values()]
        .filter(state => (state.socket?.readyState === WebSocket.OPEN && !!state.subscriptionId) || state.fallbackSubscription?.state === 'healthy')
        .map(state => state.network),
      fullTransactionPushes: this.fullTransactionPushes,
      fallbackHashes: this.fallbackHashes,
      fallbackDetailFetches: this.fallbackDetailFetches,
      fallbackDetailFetchesBlockedByBudget: this.fallbackDetailFetchesBlockedByBudget,
      cachedTransactions: this.transactions.size,
      reconnects: this.reconnects,
      errors: this.errors,
      lastObservationAt: this.lastObservationAt,
      hashesOnly: false,
      providerSideAddressFilter: false,
      applicationSideRouterFilter: true,
      exactChainBinding: true,
      alchemyDependency: false,
    };
  }

  private connectFreeFullPending(network: ProviderMeshPendingNetwork): void {
    if (!this.running) return;
    const previous = this.states.get(network);
    if (previous?.socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(previous.socket.readyState)) return;
    const state: StreamState = previous || {
      network,
      socket: null,
      subscriptionId: null,
      reconnectTimer: null,
      fallbackSubscription: null,
      closedByOperator: false,
    };
    state.closedByOperator = false;
    state.subscriptionId = null;
    this.states.set(network, state);

    const socket = new WebSocket(FREE_FULL_PENDING_ENDPOINTS[network]);
    state.socket = socket;
    const requestId = Date.now();

    socket.on('open', () => {
      socket.send(JSON.stringify({
        jsonrpc: '2.0',
        id: requestId,
        method: 'eth_subscribe',
        params: ['drpc_pendingTransactions'],
      }));
    });

    socket.on('message', data => {
      let message: any;
      try {
        message = JSON.parse(data.toString());
      } catch {
        this.errors += 1;
        return;
      }
      if (message?.id === requestId) {
        if (typeof message.result === 'string') {
          state.subscriptionId = message.result;
          void state.fallbackSubscription?.unsubscribe().catch(() => undefined);
          state.fallbackSubscription = null;
        } else {
          this.errors += 1;
          void this.ensureStandardFallback(network);
          try { socket.close(); } catch { /* best effort */ }
        }
        return;
      }
      const transaction = message?.method === 'eth_subscription'
        && message?.params?.subscription === state.subscriptionId
        ? message?.params?.result
        : null;
      if (!transaction || typeof transaction !== 'object') return;
      this.fullTransactionPushes += 1;
      if (!relevantTransaction(network, transaction)) return;
      this.recordTransaction(network, transaction, 'drpc_public_full_pending_push');
    });

    socket.on('error', error => {
      this.errors += 1;
      logger.warn('[ProviderMeshPending] Free full-pending WebSocket degraded; standard provider-mesh fallback remains local', {
        component: 'ProviderMeshPendingStream',
        network,
        error: error instanceof Error ? error.message : String(error),
        routeLocalFailure: true,
        alchemyFallback: false,
      });
      void this.ensureStandardFallback(network);
    });

    socket.on('close', () => {
      state.socket = null;
      state.subscriptionId = null;
      if (!this.running || state.closedByOperator || process.env.NO_INTERVALS === 'true') return;
      void this.ensureStandardFallback(network);
      if (state.reconnectTimer) return;
      this.reconnects += 1;
      state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = null;
        this.connectFreeFullPending(network);
      }, RECONNECT_MS);
      state.reconnectTimer.unref?.();
    });
  }

  private async ensureStandardFallback(network: ProviderMeshPendingNetwork): Promise<void> {
    if (!this.running) return;
    const state = this.states.get(network);
    if (!state || state.fallbackSubscription) return;
    try {
      await multiProviderRpcManager.initialize([network as SupportedChain]);
      state.fallbackSubscription = await multiProviderRpcManager.subscribe(
        network as SupportedChain,
        'pending_transactions',
        hash => {
          if (!validHash(hash)) return;
          this.fallbackHashes += 1;
          void this.fetchFallbackTransaction(network, hash);
        },
      );
    } catch (error) {
      this.errors += 1;
      logger.debug('[ProviderMeshPending] Standard pending fallback unavailable on this chain', {
        component: 'ProviderMeshPendingStream',
        network,
        error: error instanceof Error ? error.message : String(error),
        routeLocalFailure: true,
        alchemyFallback: false,
      });
    }
  }

  private fallbackDetailBudgetAvailable(now: number): boolean {
    while (this.fallbackDetailRequestTimes.length > 0 && now - this.fallbackDetailRequestTimes[0] >= 60_000) {
      this.fallbackDetailRequestTimes.shift();
    }
    if (this.fallbackDetailRequestTimes.length >= MAX_FALLBACK_DETAILS_PER_MINUTE) return false;
    this.fallbackDetailRequestTimes.push(now);
    return true;
  }

  private async fetchFallbackTransaction(network: ProviderMeshPendingNetwork, hash: string): Promise<void> {
    if (this.transactions.has(hash)) return;
    const now = Date.now();
    if (!this.fallbackDetailBudgetAvailable(now)) {
      this.fallbackDetailFetchesBlockedByBudget += 1;
      return;
    }
    try {
      const { result: transaction, provenance } = await multiProviderRpcManager.execute(
        network as SupportedChain,
        'transactions',
        provider => provider.getTransaction(hash),
      );
      this.fallbackDetailFetches += 1;
      if (!transaction?.hash || !relevantTransaction(network, transaction)) return;
      this.recordTransaction(network, transaction, `standard_pending_detail_provider:${provenance.provider}`);
    } catch {
      this.errors += 1;
    }
  }

  private recordTransaction(network: ProviderMeshPendingNetwork, transaction: any, source: string): void {
    const hash = String(transaction.hash || '');
    if (!validHash(hash)) return;
    const input = String(transaction.input ?? transaction.data ?? '');
    const decodedMethod = decodeMethod(input);
    const observation: ProviderMeshPendingTransaction = {
      chain: network,
      hash,
      from: String(transaction.from || ''),
      to: String(transaction.to || ''),
      value: hex(transaction.value),
      gas: hex(transaction.gas ?? transaction.gasLimit),
      gasPrice: hex(transaction.gasPrice),
      maxFeePerGas: transaction.maxFeePerGas ? hex(transaction.maxFeePerGas) : null,
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas ? hex(transaction.maxPriorityFeePerGas) : null,
      input,
      nonce: hex(transaction.nonce),
      timestamp: Date.now(),
      potentialArbitrage: true,
      decodedMethod,
      provenance: [
        source,
        `chain_binding:${network}`,
        'application_side_router_or_swap_signature_filter:true',
        'operator_billing_liability:false',
        'alchemy_dependency:false',
        'synthetic_evidence:false',
      ],
    };
    this.transactions.set(hash, observation);
    this.lastObservationAt = observation.timestamp;
    this.prune(observation.timestamp);
  }

  private prune(now: number): void {
    for (const [hash, transaction] of this.transactions.entries()) {
      if (now - transaction.timestamp > CACHE_TTL_MS) this.transactions.delete(hash);
    }
    while (this.transactions.size > MAX_CACHE) {
      const oldest = [...this.transactions.values()].sort((left, right) => left.timestamp - right.timestamp)[0];
      if (!oldest) break;
      this.transactions.delete(oldest.hash);
    }
  }
}

export const providerMeshPendingStream = new ProviderMeshPendingStream();

export function ensureProviderMeshPendingStream(): ProviderMeshPendingStream {
  providerMeshPendingStream.start();
  return providerMeshPendingStream;
}
