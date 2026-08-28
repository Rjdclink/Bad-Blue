import WebSocket from 'ws';
import logger from '../../../logger.js';
import { multiProviderRpcManager, type SupportedChain } from '../api/blockchain-providers.js';

export type FilteredAlchemyNetwork = 'ethereum' | 'polygon';

export interface FilteredPendingTransaction {
  chain: FilteredAlchemyNetwork;
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

export interface FilteredAlchemyPendingStats {
  authority: 'mempool_evidence_only';
  executionAuthority: false;
  running: boolean;
  configuredNetworks: FilteredAlchemyNetwork[];
  activeNetworks: FilteredAlchemyNetwork[];
  providerFilteredHashes: number;
  detailFetches: number;
  detailFetchesBlockedByBudget: number;
  cachedTransactions: number;
  reconnects: number;
  errors: number;
  lastObservationAt: number | null;
  hashesOnly: true;
  providerSideAddressFilter: true;
  exactChainBinding: true;
}

interface StreamState {
  network: FilteredAlchemyNetwork;
  socket: WebSocket | null;
  subscriptionId: string | null;
  reconnectTimer: NodeJS.Timeout | null;
  closedByOperator: boolean;
}

const ENDPOINT_SLUGS: Record<FilteredAlchemyNetwork, string> = {
  ethereum: 'eth',
  polygon: 'polygon',
};

const DEX_ROUTERS: Record<FilteredAlchemyNetwork, string[]> = {
  ethereum: [
    '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
  ],
  polygon: [
    '0xa5E0829CaCEd8fD D4De3c43696c57F7D7A678ff'.replace(/ /g, ''),
    '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
  ],
};

const SWAP_SIGNATURES = new Set([
  '0x38ed1739', '0x8803dbee', '0x7ff36ab5', '0xfb3bdb41', '0x18cbafe5',
  '0x4a25d94a', '0x5c11d795', '0xb6f9de95', '0x791ac947', '0x414bf389',
  '0xc04b8d59', '0xdb3e2198', '0xf28c0498',
]);

const CACHE_TTL_MS = Math.max(5_000, Number(process.env.ALCHEMY_FILTERED_PENDING_CACHE_TTL_MS || 60_000));
const MAX_CACHE = Math.max(100, Math.min(10_000, Number(process.env.ALCHEMY_FILTERED_PENDING_MAX_CACHE || 2_000)));
const MAX_DETAILS_PER_MINUTE = Math.max(1, Math.min(5_000, Number(process.env.ALCHEMY_FILTERED_PENDING_MAX_DETAILS_PER_MINUTE || 120)));
const RECONNECT_MS = Math.max(1_000, Number(process.env.ALCHEMY_FILTERED_PENDING_RECONNECT_MS || 5_000));

function configuredNetworks(): FilteredAlchemyNetwork[] {
  const raw = process.env.ALCHEMY_MEMPOOL_NETWORKS?.trim();
  if (!raw) return [];
  const supported = new Set<FilteredAlchemyNetwork>(['ethereum', 'polygon']);
  return [...new Set(raw.split(',')
    .map(value => value.trim().toLowerCase())
    .filter((value): value is FilteredAlchemyNetwork => supported.has(value as FilteredAlchemyNetwork)))];
}

function monitoringEnabled(): boolean {
  return process.env.ALCHEMY_MEMPOOL_MONITORING_ENABLED === 'true' && process.env.NO_INTERVALS !== 'true';
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function hex(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
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

class FilteredAlchemyPendingStream {
  private readonly states = new Map<FilteredAlchemyNetwork, StreamState>();
  private readonly transactions = new Map<string, FilteredPendingTransaction>();
  private readonly detailRequestTimes: number[] = [];
  private running = false;
  private providerFilteredHashes = 0;
  private detailFetches = 0;
  private detailFetchesBlockedByBudget = 0;
  private reconnects = 0;
  private errors = 0;
  private lastObservationAt: number | null = null;

  start(): void {
    if (this.running || !monitoringEnabled()) return;
    const apiKey = process.env.ALCHEMY_API_KEY?.trim();
    if (!apiKey || apiKey.toLowerCase() === 'demo') {
      logger.info('[FilteredAlchemyPending] Withheld: live Alchemy key is unavailable', {
        component: 'FilteredAlchemyPendingStream',
        executionAuthority: false,
      });
      return;
    }
    const networks = configuredNetworks();
    if (networks.length === 0) return;
    this.running = true;
    for (const network of networks) this.connect(network, apiKey);
    logger.info('[FilteredAlchemyPending] Hash-first provider-filtered monitoring enabled', {
      component: 'FilteredAlchemyPendingStream',
      networks,
      providerSubscription: 'alchemy_pendingTransactions',
      hashesOnly: true,
      providerSideAddressFilter: true,
      exactChainBinding: true,
      maxDetailFetchesPerMinute: MAX_DETAILS_PER_MINUTE,
      executionAuthority: false,
    });
  }

  stop(): void {
    this.running = false;
    for (const state of this.states.values()) {
      state.closedByOperator = true;
      if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
      try { state.socket?.close(); } catch { /* already closed */ }
      state.socket = null;
      state.subscriptionId = null;
    }
    this.states.clear();
  }

  getRecentObservations(maxAgeMs = 15_000): FilteredPendingTransaction[] {
    const now = Date.now();
    this.prune(now);
    return [...this.transactions.values()]
      .filter(transaction => now - transaction.timestamp <= Math.max(1_000, maxAgeMs))
      .sort((left, right) => right.timestamp - left.timestamp)
      .map(transaction => ({ ...transaction, provenance: [...transaction.provenance] }));
  }

  getStatistics(): FilteredAlchemyPendingStats {
    this.prune(Date.now());
    return {
      authority: 'mempool_evidence_only',
      executionAuthority: false,
      running: this.running,
      configuredNetworks: configuredNetworks(),
      activeNetworks: [...this.states.values()]
        .filter(state => state.socket?.readyState === WebSocket.OPEN && !!state.subscriptionId)
        .map(state => state.network),
      providerFilteredHashes: this.providerFilteredHashes,
      detailFetches: this.detailFetches,
      detailFetchesBlockedByBudget: this.detailFetchesBlockedByBudget,
      cachedTransactions: this.transactions.size,
      reconnects: this.reconnects,
      errors: this.errors,
      lastObservationAt: this.lastObservationAt,
      hashesOnly: true,
      providerSideAddressFilter: true,
      exactChainBinding: true,
    };
  }

  private connect(network: FilteredAlchemyNetwork, apiKey: string): void {
    if (!this.running) return;
    const previous = this.states.get(network);
    if (previous?.socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(previous.socket.readyState)) return;
    const state: StreamState = previous || {
      network,
      socket: null,
      subscriptionId: null,
      reconnectTimer: null,
      closedByOperator: false,
    };
    state.closedByOperator = false;
    state.subscriptionId = null;
    this.states.set(network, state);

    const socket = new WebSocket(`wss://${ENDPOINT_SLUGS[network]}-mainnet.g.alchemy.com/v2/${apiKey}`);
    state.socket = socket;
    const requestId = Date.now();

    socket.on('open', () => {
      const addresses = DEX_ROUTERS[network].map(address => address.toLowerCase()).slice(0, 1_000);
      socket.send(JSON.stringify({
        jsonrpc: '2.0',
        id: requestId,
        method: 'eth_subscribe',
        params: ['alchemy_pendingTransactions', {
          toAddress: addresses,
          hashesOnly: true,
        }],
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
        } else {
          this.errors += 1;
          logger.warn('[FilteredAlchemyPending] Provider rejected filtered subscription', {
            component: 'FilteredAlchemyPendingStream',
            network,
            error: message?.error || 'missing subscription id',
          });
          try { socket.close(); } catch { /* best effort */ }
        }
        return;
      }
      const hash = message?.method === 'eth_subscription'
        && message?.params?.subscription === state.subscriptionId
        ? message?.params?.result
        : null;
      if (!validHash(hash)) return;
      this.providerFilteredHashes += 1;
      void this.fetchRelevantTransaction(network, hash);
    });

    socket.on('error', error => {
      this.errors += 1;
      logger.warn('[FilteredAlchemyPending] WebSocket transport degraded', {
        component: 'FilteredAlchemyPendingStream', network,
        error: error instanceof Error ? error.message : String(error),
        executionBlocked: false,
      });
    });

    socket.on('close', () => {
      state.socket = null;
      state.subscriptionId = null;
      if (!this.running || state.closedByOperator || process.env.NO_INTERVALS === 'true') return;
      if (state.reconnectTimer) return;
      this.reconnects += 1;
      state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = null;
        this.connect(network, apiKey);
      }, RECONNECT_MS);
      state.reconnectTimer.unref?.();
    });
  }

  private detailBudgetAvailable(now: number): boolean {
    while (this.detailRequestTimes.length > 0 && now - this.detailRequestTimes[0] >= 60_000) {
      this.detailRequestTimes.shift();
    }
    if (this.detailRequestTimes.length >= MAX_DETAILS_PER_MINUTE) return false;
    this.detailRequestTimes.push(now);
    return true;
  }

  private async fetchRelevantTransaction(network: FilteredAlchemyNetwork, hash: string): Promise<void> {
    if (this.transactions.has(hash)) return;
    const now = Date.now();
    if (!this.detailBudgetAvailable(now)) {
      this.detailFetchesBlockedByBudget += 1;
      return;
    }
    try {
      // The paid/native Alchemy stream performs the cheap relevance filter first.
      // Full transaction detail is then routed through the shared RPC authority,
      // allowing non-Alchemy providers to satisfy the detail request when healthy.
      const { result: transaction, provenance } = await multiProviderRpcManager.execute(
        network as SupportedChain,
        'transactions',
        provider => provider.getTransaction(hash),
      );
      this.detailFetches += 1;
      if (!transaction?.hash) return;
      const input = transaction.data || '';
      const decodedMethod = decodeMethod(input);
      const observation: FilteredPendingTransaction = {
        chain: network,
        hash: transaction.hash,
        from: transaction.from || '',
        to: transaction.to || '',
        value: hex(transaction.value),
        gas: hex(transaction.gasLimit),
        gasPrice: hex(transaction.gasPrice),
        maxFeePerGas: transaction.maxFeePerGas ? hex(transaction.maxFeePerGas) : null,
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas ? hex(transaction.maxPriorityFeePerGas) : null,
        input,
        nonce: `0x${Number(transaction.nonce || 0).toString(16)}`,
        timestamp: Date.now(),
        potentialArbitrage: !!decodedMethod || (input.length >= 10 && SWAP_SIGNATURES.has(input.slice(0, 10).toLowerCase())),
        decodedMethod,
        provenance: [
          `alchemy_pendingTransactions:${network}:provider_filtered`,
          'hashesOnly:true',
          `detail_provider:${provenance.provider}`,
          `chain_binding:${network}`,
          'synthetic_evidence:false',
        ],
      };
      this.transactions.set(observation.hash, observation);
      this.lastObservationAt = observation.timestamp;
      this.prune(observation.timestamp);
    } catch (error) {
      this.errors += 1;
      logger.debug('[FilteredAlchemyPending] Relevant transaction detail unavailable', {
        component: 'FilteredAlchemyPendingStream', network, hash,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private prune(now: number): void {
    for (const [hash, transaction] of this.transactions.entries()) {
      if (now - transaction.timestamp > CACHE_TTL_MS) this.transactions.delete(hash);
    }
    while (this.transactions.size > MAX_CACHE) {
      const oldest = [...this.transactions.values()].sort((a, b) => a.timestamp - b.timestamp)[0];
      if (!oldest) break;
      this.transactions.delete(oldest.hash);
    }
  }
}

export const filteredAlchemyPendingStream = new FilteredAlchemyPendingStream();

export function ensureFilteredAlchemyPendingStream(): FilteredAlchemyPendingStream {
  filteredAlchemyPendingStream.start();
  return filteredAlchemyPendingStream;
}
