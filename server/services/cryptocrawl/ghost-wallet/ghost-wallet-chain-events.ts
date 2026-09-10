import { ethers, providers } from 'ethers';
import WebSocket, { type RawData } from 'ws';
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
const INITIAL_HANDSHAKE_TIMEOUT_MS = 8_000;
const BASE_RECONNECT_DELAY_MS = 5_000;
const THROTTLED_RECONNECT_DELAY_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 120_000;

interface ChainListener {
  key: string;
  chain: GhostWalletChain;
  url: string;
  addresses: string[];
  socket: WebSocket;
  stopping: boolean;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectAttempt: number;
}

function timeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref?.();
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      socket.off('open', onOpen);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    const onOpen = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onClose = (code: number, reason: Buffer) => {
      cleanup();
      reject(new Error(`websocket closed before ready (${code}${reason.length ? `: ${reason.toString()}` : ''})`));
    };
    socket.once('open', onOpen);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

function websocketRpc<T>(socket: WebSocket, id: number, method: string, params: unknown[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      socket.off('message', onMessage);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    const onMessage = (data: RawData) => {
      let payload: any;
      try {
        payload = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (payload?.id !== id) return;
      cleanup();
      if (payload.error) {
        const error = new Error(String(payload.error.message || `${method} failed`)) as Error & { code?: unknown };
        error.code = payload.error.code;
        reject(error);
        return;
      }
      resolve(payload.result as T);
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onClose = (code: number, reason: Buffer) => {
      cleanup();
      reject(new Error(`websocket closed during ${method} (${code}${reason.length ? `: ${reason.toString()}` : ''})`));
    };
    socket.on('message', onMessage);
    socket.once('error', onError);
    socket.once('close', onClose);
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }), error => {
      if (!error) return;
      cleanup();
      reject(error);
    });
  });
}

function isThrottleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  return /rate limit|too many requests|throttl|\b429\b/i.test(`${message} ${code}`) || code === '15';
}

function reconnectDelayMs(attempt: number, error?: unknown): number {
  const base = isThrottleError(error) ? THROTTLED_RECONNECT_DELAY_MS : BASE_RECONNECT_DELAY_MS;
  const exponential = Math.min(MAX_RECONNECT_DELAY_MS, base * (2 ** Math.min(attempt, 5)));
  const jittered = Math.round(exponential * (0.75 + Math.random() * 0.5));
  return Math.max(base, Math.min(MAX_RECONNECT_DELAY_MS, jittered));
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
    // ethers v5 normalizes Filter.address as one address/ENS name. Query each
    // monitored contract independently, then merge before advancing the chain cursor.
    const logGroups = await Promise.all(input.addresses.map(address => input.provider.getLogs({
      address,
      topics: [GHOST_WALLET_SETTLEMENT_EVENT_TOPICS],
      fromBlock,
      toBlock: latest,
    })));
    const uniqueLogs = new Map<string, providers.Log>();
    for (const log of logGroups.flat()) {
      uniqueLogs.set(`${log.transactionHash}:${log.logIndex}`, log);
    }
    const logs = [...uniqueLogs.values()].sort((a, b) =>
      a.blockNumber - b.blockNumber
      || a.transactionIndex - b.transactionIndex
      || a.logIndex - b.logIndex,
    );
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
  private readonly backfills = new Map<GhostWalletChain, Promise<void>>();
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
    this.backfills.clear();
  }

  private disposeTransport(listener: ChainListener): void {
    try {
      listener.socket.removeAllListeners();
      listener.socket.on('error', () => undefined);
      if (listener.socket.readyState !== WebSocket.CLOSED) listener.socket.terminate();
    } catch { /* best effort */ }
  }

  private closeListener(listener: ChainListener): void {
    listener.stopping = true;
    if (listener.reconnectTimer) clearTimeout(listener.reconnectTimer);
    listener.reconnectTimer = null;
    this.disposeTransport(listener);
  }

  private async ensureChain(chain: GhostWalletChain): Promise<void> {
    if (this.stopping) return;
    const httpProvider = await ghostWalletProviderMesh.getProvider(chain);
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

  private queueBackfill(listener: ChainListener, httpProvider: providers.JsonRpcProvider): void {
    if (listener.stopping || this.stopping || this.backfills.has(listener.chain)) return;
    const work = backfillSettlementLogs({
      chain: listener.chain,
      addresses: listener.addresses,
      provider: httpProvider,
      listenerConnected: true,
    }).catch(error => {
      logger.warn('[GhostWalletUltra] Settlement notification backfill failed; stream remains route-local', {
        component: 'GhostWalletChainEvents',
        chain: listener.chain,
        endpoint: listener.url,
        error: error instanceof Error ? error.message : String(error),
        routeLocalFailure: true,
      });
    }).finally(() => {
      this.backfills.delete(listener.chain);
    });
    this.backfills.set(listener.chain, work);
  }

  private async ensureStream(
    chain: GhostWalletChain,
    url: string,
    addresses: string[],
    httpProvider: providers.JsonRpcProvider,
    reconnectAttempt = 0,
  ): Promise<void> {
    const key = `${chain}:${url}`;
    if (this.stopping || this.listeners.has(key)) return;
    const socket = new WebSocket(url);
    const listener: ChainListener = {
      key,
      chain,
      url,
      addresses,
      socket,
      stopping: false,
      reconnectTimer: null,
      reconnectAttempt,
    };
    try {
      await timeout(waitForOpen(socket), INITIAL_HANDSHAKE_TIMEOUT_MS, `Ghost settlement websocket ${chain}`);
      const [rawChainId, httpNetwork] = await timeout(
        Promise.all([
          websocketRpc<string>(socket, 1, 'eth_chainId', []),
          httpProvider.getNetwork(),
        ]),
        INITIAL_HANDSHAKE_TIMEOUT_MS,
        `Ghost settlement websocket identity ${chain}`,
      );
      const websocketChainId = Number.parseInt(rawChainId, 16);
      if (!Number.isFinite(websocketChainId) || websocketChainId !== httpNetwork.chainId) {
        throw new Error('GHOST_WALLET_WEBSOCKET_CHAIN_IDENTITY_MISMATCH');
      }

      socket.on('message', data => {
        let payload: any;
        try {
          payload = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (payload?.method === 'eth_subscription') this.queueBackfill(listener, httpProvider);
      });

      // Subscribe one address at a time. This avoids ethers v5's single-address
      // filter normalization while preserving every monitored settlement contract.
      await Promise.all(addresses.map((address, index) => timeout(
        websocketRpc<string>(socket, 10 + index, 'eth_subscribe', [
          'logs',
          { address, topics: [GHOST_WALLET_SETTLEMENT_EVENT_TOPICS] },
        ]),
        INITIAL_HANDSHAKE_TIMEOUT_MS,
        `Ghost settlement subscription ${chain}:${index}`,
      )));

      listener.reconnectAttempt = 0;
      this.listeners.set(key, listener);
      const reconnect = (error?: unknown) => this.scheduleReconnect(listener, error);
      socket.once('close', (code, reason) => reconnect(new Error(
        `Ghost settlement websocket closed (${code}${reason.length ? `: ${reason.toString()}` : ''})`,
      )));
      socket.once('error', reconnect);
    } catch (error) {
      this.disposeTransport(listener);
      const delayMs = this.scheduleReconnect(listener, error);
      logger.warn('[GhostWalletUltra] Non-Alchemy settlement push stream unavailable', {
        component: 'GhostWalletChainEvents',
        chain,
        endpoint: url,
        error: error instanceof Error ? error.message : String(error),
        reconnectScheduled: delayMs !== null,
        reconnectDelayMs: delayMs,
        routeLocalFailure: true,
      });
    }
  }

  private scheduleReconnect(listener: ChainListener, error?: unknown): number | null {
    if (listener.stopping || this.stopping || listener.reconnectTimer) return null;
    const delayMs = reconnectDelayMs(listener.reconnectAttempt, error);
    const nextAttempt = listener.reconnectAttempt + 1;
    listener.reconnectTimer = setTimeout(() => {
      listener.reconnectTimer = null;
      this.listeners.delete(listener.key);
      this.closeListener(listener);
      void (async () => {
        if (this.stopping) return;
        const http = await ghostWalletProviderMesh.getProvider(listener.chain);
        if (!http) throw new Error(`GHOST_WALLET_RPC_UNAVAILABLE:${listener.chain}`);
        await this.ensureStream(listener.chain, listener.url, listener.addresses, http, nextAttempt);
        if (!this.listeners.has(listener.key)) return;
        try {
          await backfillSettlementLogs({
            chain: listener.chain,
            addresses: listener.addresses,
            provider: http,
            listenerConnected: true,
          });
        } catch (backfillError) {
          logger.warn('[GhostWalletUltra] Settlement reconnect backfill failed; live stream remains route-local', {
            component: 'GhostWalletChainEvents',
            chain: listener.chain,
            endpoint: listener.url,
            error: backfillError instanceof Error ? backfillError.message : String(backfillError),
            routeLocalFailure: true,
          });
        }
      })().catch(reconnectError => {
        if (this.stopping) return;
        listener.stopping = false;
        listener.reconnectAttempt = nextAttempt;
        const retryDelayMs = this.scheduleReconnect(listener, reconnectError);
        logger.warn('[GhostWalletUltra] Settlement stream reconnect attempt failed; retrying route locally', {
          component: 'GhostWalletChainEvents',
          chain: listener.chain,
          endpoint: listener.url,
          error: reconnectError instanceof Error ? reconnectError.message : String(reconnectError),
          reconnectScheduled: retryDelayMs !== null,
          reconnectDelayMs: retryDelayMs,
          routeLocalFailure: true,
        });
      });
    }, delayMs);
    listener.reconnectTimer.unref?.();
    return delayMs;
  }
}

export const ghostWalletChainEvents = new GhostWalletChainEvents();

export const GHOST_WALLET_SETTLEMENT_STREAM_POLICY = {
  alchemyAllowed: false,
  parallelPushRedundancy: STREAM_REDUNDANCY,
  initialHandshakeTimeoutMs: INITIAL_HANDSHAKE_TIMEOUT_MS,
  reconnectBackfill: true,
  reconnectBackoff: 'bounded_exponential_with_throttle_delay_and_jitter',
  periodicPolling: false,
  durableCursorBackfill: true,
  singleSettlementIngestionAuthority: true,
  routeLocalFailure: true,
} as const;
