import WebSocket from 'ws';
import logger from '../../../logger.js';
import type { MempoolAnalysis, PendingTransaction } from './alchemy-integration.js';

export type FilteredAlchemyNetwork = 'ethereum' | 'polygon';

const WS_HOSTS: Record<FilteredAlchemyNetwork, string> = {
  ethereum: 'eth-mainnet.g.alchemy.com',
  polygon: 'polygon-mainnet.g.alchemy.com',
};

const DEFAULT_ROUTERS: Record<FilteredAlchemyNetwork, string[]> = {
  ethereum: [
    '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
    '0xDef1C0ded9bec7F1a1670819833240f027b25EfF',
  ],
  polygon: [
    '0xa5E0829CaCEd8fD D4De3c43696c57F7D7A678ff'.replace(/ /g, ''),
    '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    '0xDef1C0ded9bec7F1a1670819833240f027b25EfF',
  ],
};

const SWAP_SIGNATURES = new Set([
  '0x38ed1739', '0x8803dbee', '0x7ff36ab5', '0xfb3bdb41', '0x18cbafe5', '0x4a25d94a',
  '0x5c11d795', '0xb6f9de95', '0x791ac947', '0x414bf389', '0xc04b8d59', '0xdb3e2198', '0xf28c0498',
]);

interface ConnectionState {
  socket: WebSocket;
  network: FilteredAlchemyNetwork;
  subscriptionId: string | null;
  requestId: number;
  active: boolean;
}

function configuredNetworks(): FilteredAlchemyNetwork[] {
  if (process.env.ALCHEMY_MEMPOOL_MONITORING_ENABLED !== 'true') return [];
  const requested = new Set((process.env.ALCHEMY_MEMPOOL_NETWORKS || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean));
  return (['ethereum', 'polygon'] as const).filter(network => requested.has(network));
}

function normalizeAddress(value: string): string | null {
  const trimmed = value.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function configuredRouters(network: FilteredAlchemyNetwork): string[] {
  const extra = (process.env.ALCHEMY_MEMPOOL_TO_ADDRESSES || '')
    .split(',')
    .map(value => normalizeAddress(value))
    .filter((value): value is string => !!value);
  return [...new Set([...DEFAULT_ROUTERS[network].map(value => value.toLowerCase()), ...extra])].slice(0, 1000);
}

function hexOrDecimal(value: unknown, fallback = '0x0'): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return `0x${Math.floor(value).toString(16)}`;
  return fallback;
}

function decodeMethodSignature(input: string): string | null {
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

function parsePendingTransaction(raw: any): PendingTransaction | null {
  if (!raw || typeof raw !== 'object' || typeof raw.hash !== 'string' || typeof raw.from !== 'string') return null;
  const input = typeof raw.input === 'string' ? raw.input : typeof raw.data === 'string' ? raw.data : '0x';
  const potentialArbitrage = input.length >= 10 && SWAP_SIGNATURES.has(input.slice(0, 10).toLowerCase());
  return {
    hash: raw.hash,
    from: raw.from,
    to: typeof raw.to === 'string' ? raw.to : '',
    value: hexOrDecimal(raw.value),
    gas: hexOrDecimal(raw.gas ?? raw.gasLimit),
    gasPrice: hexOrDecimal(raw.gasPrice),
    maxFeePerGas: raw.maxFeePerGas == null ? null : hexOrDecimal(raw.maxFeePerGas),
    maxPriorityFeePerGas: raw.maxPriorityFeePerGas == null ? null : hexOrDecimal(raw.maxPriorityFeePerGas),
    input,
    nonce: hexOrDecimal(raw.nonce),
    timestamp: Date.now(),
    potentialArbitrage,
    decodedMethod: decodeMethodSignature(input),
  };
}

class AlchemyFilteredMempool {
  private readonly connections = new Map<FilteredAlchemyNetwork, ConnectionState>();
  private readonly cache = new Map<string, { network: FilteredAlchemyNetwork; transaction: PendingTransaction }>();
  private lastObservationAt: number | null = null;
  private stopped = true;
  private analyzed = 0;

  async start(): Promise<void> {
    const apiKey = process.env.ALCHEMY_API_KEY?.trim();
    const networks = configuredNetworks();
    if (!apiKey || networks.length === 0) return;
    this.stopped = false;
    await Promise.all(networks.map(network => this.ensureConnection(network, apiKey)));
  }

  stop(): void {
    this.stopped = true;
    for (const connection of this.connections.values()) {
      connection.active = false;
      try { connection.socket.close(); } catch { /* best effort */ }
    }
    this.connections.clear();
    this.cache.clear();
    this.lastObservationAt = null;
  }

  private async ensureConnection(network: FilteredAlchemyNetwork, apiKey: string): Promise<void> {
    const existing = this.connections.get(network);
    if (existing?.active && existing.socket.readyState === WebSocket.OPEN) return;

    const socket = new WebSocket(`wss://${WS_HOSTS[network]}/v2/${apiKey}`);
    const state: ConnectionState = {
      socket,
      network,
      subscriptionId: null,
      requestId: Date.now() + (network === 'ethereum' ? 1 : 2),
      active: true,
    };
    this.connections.set(network, state);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Alchemy filtered mempool WebSocket timed out on ${network}`)), 8_000);
      socket.once('open', () => {
        clearTimeout(timeout);
        const toAddress = configuredRouters(network);
        socket.send(JSON.stringify({
          jsonrpc: '2.0',
          id: state.requestId,
          method: 'eth_subscribe',
          params: [
            'alchemy_pendingTransactions',
            {
              toAddress,
              hashesOnly: false,
            },
          ],
        }));
        logger.info('[AlchemyFilteredMempool] Server-side filtered pending stream opened', {
          component: 'AlchemyFilteredMempool',
          network,
          toAddressFilters: toAddress.length,
          hashesOnly: false,
          perHashDetailRpcRequired: false,
        });
        resolve();
      });
      socket.once('error', error => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    socket.on('message', data => this.consumeMessage(state, String(data)));
    socket.on('close', () => {
      state.active = false;
      if (this.connections.get(network) === state) this.connections.delete(network);
      if (!this.stopped && configuredNetworks().includes(network)) {
        setTimeout(() => {
          if (!this.stopped) void this.ensureConnection(network, apiKey).catch(error => {
            logger.warn('[AlchemyFilteredMempool] Reconnect degraded', {
              component: 'AlchemyFilteredMempool',
              network,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }, 5_000).unref?.();
      }
    });
  }

  private consumeMessage(state: ConnectionState, raw: string): void {
    let payload: any;
    try { payload = JSON.parse(raw); } catch { return; }

    if (payload?.id === state.requestId) {
      if (typeof payload.result === 'string') {
        state.subscriptionId = payload.result;
      } else if (payload?.error) {
        logger.warn('[AlchemyFilteredMempool] Subscription rejected', {
          component: 'AlchemyFilteredMempool',
          network: state.network,
          error: payload.error?.message || String(payload.error),
        });
      }
      return;
    }

    if (payload?.method !== 'eth_subscription') return;
    if (state.subscriptionId && payload?.params?.subscription !== state.subscriptionId) return;
    const transaction = parsePendingTransaction(payload?.params?.result);
    if (!transaction) return;

    const key = `${state.network}:${transaction.hash.toLowerCase()}`;
    if (this.cache.has(key)) return;
    this.cache.set(key, { network: state.network, transaction });
    this.lastObservationAt = transaction.timestamp;
    this.analyzed++;
    this.prune();
  }

  private prune(): void {
    const now = Date.now();
    const ttlMs = Math.max(15_000, Number(process.env.ALCHEMY_FILTERED_PENDING_CACHE_TTL_MS || 300_000));
    for (const [key, value] of this.cache.entries()) {
      if (now - value.transaction.timestamp > ttlMs) this.cache.delete(key);
    }
    const max = Math.max(100, Math.min(10_000, Number(process.env.ALCHEMY_MAX_PENDING_TX_CACHE || 5_000)));
    while (this.cache.size > max) {
      const first = this.cache.keys().next().value;
      if (!first) break;
      this.cache.delete(first);
    }
  }

  getAnalysis(): MempoolAnalysis {
    this.prune();
    const now = Date.now();
    const fresh = this.lastObservationAt !== null && now - this.lastObservationAt <= 15_000;
    const activeNetworks = [...this.connections.values()].filter(connection => connection.active && connection.socket.readyState === WebSocket.OPEN);
    const transactions = [...this.cache.values()].map(item => item.transaction);
    const swaps = transactions.filter(transaction => transaction.potentialArbitrage);
    const gasPrices = transactions
      .map(transaction => {
        const raw = transaction.gasPrice || '0';
        return raw.startsWith('0x') ? parseInt(raw, 16) : Number(raw);
      })
      .filter(value => Number.isFinite(value) && value > 0);
    return {
      available: activeNetworks.length > 0 && fresh,
      observedAt: fresh ? this.lastObservationAt : null,
      provenance: activeNetworks.flatMap(connection => [
        `alchemy:filtered_pending:${connection.network}`,
        'alchemy_pendingTransactions:server_side_toAddress_filter',
        'full_transaction_payload:no_per_hash_detail_rpc',
      ]),
      totalPending: transactions.length,
      swapTransactions: swaps.length,
      liquidityAdditions: 0,
      largeTransfers: transactions.filter(transaction => {
        try { return BigInt(transaction.value || '0') > 1_000_000_000_000_000_000n; } catch { return false; }
      }).length,
      arbitrageOpportunities: swaps.slice(0, 50),
      avgGasPrice: gasPrices.length ? gasPrices.reduce((sum, value) => sum + value, 0) / gasPrices.length : 0,
      maxGasPrice: gasPrices.length ? Math.max(...gasPrices) : 0,
    };
  }

  getStatistics() {
    return {
      activeNetworks: [...this.connections.values()].filter(connection => connection.active).map(connection => connection.network),
      cachedTransactions: this.cache.size,
      analyzedTransactions: this.analyzed,
      serverSideFiltered: true,
      perHashDetailRpcRequired: false,
      unfilteredPendingRequired: false,
    };
  }
}

export const alchemyFilteredMempool = new AlchemyFilteredMempool();
