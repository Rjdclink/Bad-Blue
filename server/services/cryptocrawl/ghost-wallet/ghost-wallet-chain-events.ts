import { ethers, providers } from 'ethers';
import logger from '../../../logger.js';
import { getGhostWalletExternalBridgeDescriptor } from './ghost-wallet-external-bridge.js';
import { ghostWalletEngine } from './ghost-wallet-engine.js';
import { ghostWalletProviderMesh, ghostWalletWebSocketUrls, type GhostWalletChain } from './ghost-wallet-provider-mesh.js';
import { getGhostWalletReconciledBlock, recordGhostWalletRuntimeState } from './ghost-wallet-runtime-state.js';
import {
  GHOST_WALLET_SETTLEMENT_EVENT_TOPICS,
  ingestGhostWalletSettlementLog,
} from './ghost-wallet-settlement-ingest.js';

const STREAM_REDUNDANCY = 2;

interface ChainListener {
  key: string;
  chain: GhostWalletChain;
  url: string;
  addresses: string[];
  provider: providers.WebSocketProvider;
  stopping: boolean;
  reconnectTimer: NodeJS.Timeout | null;
}

async function monitoredAddresses(chain: GhostWalletChain): Promise<string[]> {
  const addresses = new Set<string>();
  const intermediary = ghostWalletEngine.getConfiguredIntermediary(chain);
  if (intermediary) addresses.add(ethers.utils.getAddress(intermediary));
  try {
    const bridge = await getGhostWalletExternalBridgeDescriptor(chain);
    addresses.add(bridge.address);
  } catch (error) {
    logger.warn('[GhostWalletUltra] External bridge descriptor unavailable for settlement monitor', {
      component: 'GhostWalletChainEvents',
      chain,
      error: error instanceof Error ? error.message : String(error),
      routeLocalFailure: true,
    });
  }
  return [...addresses];
}

async function backfillSettlementLogs(input: {
  chain: GhostWalletChain;
  addresses: string[];
  provider: providers.JsonRpcProvider;
  listenerConnected: boolean;
}): Promise<void> {
  if (input.addresses.length === 0) return;
  const latest = await input.provider.getBlockNumber();
  const cursor = await getGhostWalletReconciledBlock(input.chain);
  const fromBlock = Math.max(0, cursor === null ? latest - 64 : cursor + 1);
  if (fromBlock <= latest) {
    const logs = await input.provider.getLogs({
      address: input.addresses,
      topics: [GHOST_WALLET_SETTLEMENT_EVENT_TOPICS],
      fromBlock,
      toBlock: latest,
    });
    for (const log of logs) await ingestGhostWalletSettlementLog(input.chain, log);
  }
  await recordGhostWalletRuntimeState({
    chain: input.chain,
    reconciledBlock: latest,
    listenerConnected: input.listenerConnected,
    workerActivity: true,
    metadata: {
      websocketPush: input.listenerConnected,
      reconciliationAuthority: 'durable_cursor_plus_http_log_backfill',
      periodicPolling: false,
      alchemyDependency: false,
      monitoredAddresses: input.addresses,
    },
  });
}

class GhostWalletChainEvents {
  private readonly listeners = new Map<string, ChainListener>();
  private stopping = false;

  async start(): Promise<void> {
    this.stopping = false;
    const chains = ghostWalletProviderMesh.getReadyChains();
    const settled = await Promise.allSettled(chains.map(chain => this.ensureChain(chain)));
    settled.forEach((result, index) => {
      if (result.status === 'rejected') {
        logger.warn('[GhostWalletUltra] Settlement monitor unavailable on one chain; other chains remain live', {
          component: 'GhostWalletChainEvents',
          chain: chains[index],
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          routeLocalFailure: true,
        });
      }
    });
  }

  stop(): void {
    this.stopping = true;
    for (const listener of this.listeners.values()) this.closeListener(listener);
    this.listeners.clear();
  }

  private closeListener(listener: ChainListener): void {
    listener.stopping = true;
    if (listener.reconnectTimer) clearTimeout(listener.reconnectTimer);
    try { listener.provider.removeAllListeners(); } catch { /* best effort */ }
    try { (listener.provider as any)._websocket?.terminate?.(); } catch { /* best effort */ }
    try { (listener.provider as any)._websocket?.close?.(); } catch { /* best effort */ }
  }

  private async ensureChain(chain: GhostWalletChain): Promise<void> {
    if (this.stopping) return;
    const httpProvider = ghostWalletProviderMesh.getReadyProvider(chain);
    if (!httpProvider) return;
    const addresses = await monitoredAddresses(chain);
    if (addresses.length === 0) return;

    const urls = ghostWalletWebSocketUrls(chain).slice(0, STREAM_REDUNDANCY);
    await Promise.allSettled(urls.map(url => this.ensureStream(chain, url, addresses, httpProvider)));
    await backfillSettlementLogs({
      chain,
      addresses,
      provider: httpProvider,
      listenerConnected: urls.some(url => this.listeners.has(`${chain}:${url}`)),
    });

    if (urls.length === 0) {
      logger.warn('[GhostWalletUltra] Push settlement stream unavailable; startup reconciliation completed', {
        component: 'GhostWalletChainEvents',
        chain,
        periodicPollingEnabled: false,
        alchemyDependency: false,
      });
    }
  }

  private async ensureStream(
    chain: GhostWalletChain,
    url: string,
    addresses: string[],
    httpProvider: providers.JsonRpcProvider,
  ): Promise<void> {
    const key = `${chain}:${url}`;
    if (this.stopping || this.listeners.has(key)) return;
    const ws = new providers.WebSocketProvider(url);
    const listener: ChainListener = {
      key,
      chain,
      url,
      addresses,
      provider: ws,
      stopping: false,
      reconnectTimer: null,
    };
    try {
      const [network, httpNetwork] = await Promise.all([ws.getNetwork(), httpProvider.getNetwork()]);
      if (network.chainId !== httpNetwork.chainId) throw new Error('GHOST_WALLET_WEBSOCKET_CHAIN_IDENTITY_MISMATCH');
      this.listeners.set(key, listener);
      const filter = { address: addresses, topics: [GHOST_WALLET_SETTLEMENT_EVENT_TOPICS] };
      ws.on(filter, log => {
        void ingestGhostWalletSettlementLog(chain, log as providers.Log).catch(error => {
          logger.warn('[GhostWalletUltra] Settlement event ingestion failed', {
            component: 'GhostWalletChainEvents',
            chain,
            endpoint: url,
            error: error instanceof Error ? error.message : String(error),
            periodicPollingEnabled: false,
          });
        });
      });
      const socket = (ws as any)._websocket;
      const reconnect = () => this.scheduleReconnect(listener);
      socket?.once?.('close', reconnect);
      socket?.once?.('error', reconnect);
      ws.on('error', reconnect);
    } catch (error) {
      this.closeListener(listener);
      logger.warn('[GhostWalletUltra] Non-Alchemy settlement push stream unavailable', {
        component: 'GhostWalletChainEvents',
        chain,
        endpoint: url,
        error: error instanceof Error ? error.message : String(error),
        routeLocalFailure: true,
      });
    }
  }

  private scheduleReconnect(listener: ChainListener): void {
    if (listener.stopping || this.stopping || listener.reconnectTimer) return;
    listener.reconnectTimer = setTimeout(() => {
      this.listeners.delete(listener.key);
      this.closeListener(listener);
      const http = ghostWalletProviderMesh.getReadyProvider(listener.chain);
      if (!http || this.stopping) return;
      void this.ensureStream(listener.chain, listener.url, listener.addresses, http);
    }, 2_000);
    listener.reconnectTimer.unref?.();
  }
}

export const ghostWalletChainEvents = new GhostWalletChainEvents();

export const GHOST_WALLET_SETTLEMENT_STREAM_POLICY = {
  alchemyAllowed: false,
  parallelPushRedundancy: STREAM_REDUNDANCY,
  periodicPolling: false,
  durableCursorBackfill: true,
  singleSettlementIngestionAuthority: true,
  routeLocalFailure: true,
} as const;
