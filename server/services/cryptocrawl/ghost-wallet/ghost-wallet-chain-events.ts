import { ethers, providers } from 'ethers';
import WebSocket, { type RawData } from 'ws';
import logger from '../../../logger.js';
import { getGhostWalletExternalBridgeDescriptor } from './ghost-wallet-external-bridge.js';
import { ghostWalletEngine } from './ghost-wallet-engine.js';
import {
  GHOST_WALLET_MAX_LOG_BLOCK_SPAN,
  ghostWalletDeploymentStateFromCodes,
  ghostWalletLogWindowEnd,
  isGhostWalletArchiveUnavailableError,
  isGhostWalletLogRangeLimitError,
  isGhostWalletThrottleError,
} from './ghost-wallet-log-policy.js';
import { ghostWalletProviderMesh, ghostWalletWebSocketUrls, type GhostWalletChain } from './ghost-wallet-provider-mesh.js';
import { getGhostWalletReconciledBlock, recordGhostWalletRuntimeState } from './ghost-wallet-runtime-state.js';
import {
  GHOST_WALLET_SETTLEMENT_EVENT_TOPICS,
  ingestGhostWalletSettlementLog,
} from './ghost-wallet-settlement-ingest.js';

const STREAM_REDUNDANCY = 2;
const INITIAL_HANDSHAKE_TIMEOUT_MS = 8_000;
const BRIDGE_DESCRIPTOR_TIMEOUT_MS = 15_000;
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
  return isGhostWalletThrottleError(error);
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
    const bridge = await timeout(
      getGhostWalletExternalBridgeDescriptor(chain),
      BRIDGE_DESCRIPTOR_TIMEOUT_MS,
      `Ghost settlement bridge descriptor ${chain}`,
    );
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

function providerIdentity(provider: providers.JsonRpcProvider): string {
  const connection = (provider as any).connection;
  return String(connection?.url || connection?.connection?.url || 'unknown');
}

async function logProviders(chain: GhostWalletChain, preferred: providers.JsonRpcProvider): Promise<providers.JsonRpcProvider[]> {
  const available = await ghostWalletProviderMesh.getLogProviders(chain);
  const unique = new Map<string, providers.JsonRpcProvider>();
  const allowed = new Set(available.map(providerIdentity));
  for (const provider of [preferred, ...available]) {
    const identity = providerIdentity(provider);
    if (allowed.has(identity)) unique.set(identity, provider);
  }
  return [...unique.values()];
}

async function allProviders(chain: GhostWalletChain, preferred: providers.JsonRpcProvider): Promise<providers.JsonRpcProvider[]> {
  const available = await ghostWalletProviderMesh.getProviders(chain);
  const unique = new Map<string, providers.JsonRpcProvider>();
  for (const provider of [preferred, ...available]) unique.set(providerIdentity(provider), provider);
  return [...unique.values()];
}

async function deployedMonitoredAddresses(input: {
  chain: GhostWalletChain;
  preferred: providers.JsonRpcProvider;
  addresses: string[];
}): Promise<{ deployed: string[]; undeployed: string[] }> {
  const candidates = await allProviders(input.chain, input.preferred);
  const results = await Promise.all(input.addresses.map(async address => {
    const checks = await Promise.allSettled(candidates.map(provider => timeout(
      provider.getCode(address),
      8_000,
      `Ghost settlement getCode ${input.chain}`,
    )));
    const observedCodes = checks.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    const deploymentState = ghostWalletDeploymentStateFromCodes(observedCodes, candidates.length);
    if (deploymentState === 'deployed') return { address, deployed: true };
    if (deploymentState === 'undeployed') {
      return { address, deployed: false };
    }
    const failures = checks.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    const lastFailure = failures[failures.length - 1];
    throw lastFailure?.status === 'rejected' && lastFailure.reason instanceof Error
      ? lastFailure.reason
      : new Error(`GHOST_WALLET_DEPLOYMENT_STATE_UNVERIFIED:${input.chain}:${address}`);
  }));
  return {
    deployed: results.filter(result => result.deployed).map(result => result.address),
    undeployed: results.filter(result => !result.deployed).map(result => result.address),
  };
}

async function latestBlockWithFailover(chain: GhostWalletChain, preferred: providers.JsonRpcProvider): Promise<number> {
  let lastError: unknown;
  for (const provider of await logProviders(chain, preferred)) {
    try {
      return await timeout(provider.getBlockNumber(), 8_000, `Ghost settlement latest block ${chain}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`GHOST_WALLET_RPC_UNAVAILABLE:${chain}`);
}

async function querySettlementLogsWithFailover(input: {
  chain: GhostWalletChain;
  preferred: providers.JsonRpcProvider;
  address: string;
  fromBlock: number;
  toBlock: number;
}): Promise<providers.Log[]> {
  let lastError: unknown;
  let sawRangeLimit = false;
  let sawArchiveUnavailable = false;
  for (const provider of await logProviders(input.chain, input.preferred)) {
    try {
      return await timeout(provider.getLogs({
        address: input.address,
        topics: [GHOST_WALLET_SETTLEMENT_EVENT_TOPICS],
        fromBlock: input.fromBlock,
        toBlock: input.toBlock,
      }), 10_000, `Ghost settlement getLogs ${input.chain}`);
    } catch (error) {
      lastError = error;
      if (isGhostWalletLogRangeLimitError(error)) sawRangeLimit = true;
      if (isGhostWalletArchiveUnavailableError(error)) sawArchiveUnavailable = true;
    }
  }
  const failure = new Error(`Ghost settlement getLogs failed across all providers for ${input.chain}: ${lastError instanceof Error ? lastError.message : String(lastError || 'unknown error')}`) as Error & { rangeLimited?: boolean; archiveUnavailable?: boolean };
  failure.rangeLimited = sawRangeLimit;
  failure.archiveUnavailable = sawArchiveUnavailable;
  throw failure;
}

async function collectSettlementLogs(input: {
  chain: GhostWalletChain;
  preferred: providers.JsonRpcProvider;
  addresses: string[];
  fromBlock: number;
  toBlock: number;
}): Promise<providers.Log[]> {
  const pending: Array<[number, number]> = [[input.fromBlock, input.toBlock]];
  const uniqueLogs = new Map<string, providers.Log>();

  while (pending.length > 0) {
    const [fromBlock, toBlock] = pending.shift()!;
    try {
      const logGroups = await Promise.all(input.addresses.map(address => querySettlementLogsWithFailover({
        chain: input.chain,
        preferred: input.preferred,
        address,
        fromBlock,
        toBlock,
      })));
      for (const log of logGroups.flat()) uniqueLogs.set(`${log.transactionHash}:${log.logIndex}`, log);
    } catch (error) {
      const rangeLimited = Boolean((error as { rangeLimited?: boolean } | null)?.rangeLimited);
      if (!rangeLimited || fromBlock >= toBlock) throw error;
      const midpoint = Math.floor((fromBlock + toBlock) / 2);
      pending.unshift([fromBlock, midpoint], [midpoint + 1, toBlock]);
    }
  }

  return [...uniqueLogs.values()].sort((a, b) =>
    a.blockNumber - b.blockNumber
    || a.transactionIndex - b.transactionIndex
    || a.logIndex - b.logIndex,
  );
}

async function backfillSettlementLogs(input: {
  chain: GhostWalletChain;
  addresses: string[];
  provider: providers.JsonRpcProvider;
  listenerConnected: boolean;
}): Promise<void> {
  if (input.addresses.length === 0) return;
  const latest = await latestBlockWithFailover(input.chain, input.provider);
  const cursor = await getGhostWalletReconciledBlock(input.chain);
  const targetState = await deployedMonitoredAddresses({
    chain: input.chain,
    preferred: input.provider,
    addresses: input.addresses,
  });
  if (targetState.deployed.length === 0) {
    await recordGhostWalletRuntimeState({
      chain: input.chain,
      reconciledBlock: latest,
      listenerConnected: input.listenerConnected,
      workerActivity: true,
      metadata: {
        websocketPush: input.listenerConnected,
        reconciliationAuthority: 'durable_cursor_plus_http_log_backfill',
        logBackfillProviderFailover: true,
        logBackfillAdaptiveRangeSplit: true,
        logBackfillMaximumBlockSpan: GHOST_WALLET_MAX_LOG_BLOCK_SPAN,
        persistentProgressPerChunk: true,
        skippedUndeployedHistoricalScan: true,
        periodicPolling: false,
        alchemyDependency: false,
        monitoredAddresses: input.addresses,
        deployedMonitoredAddresses: targetState.deployed,
        undeployedMonitoredAddresses: targetState.undeployed,
      },
    });
    return;
  }

  let fromBlock = Math.max(0, cursor === null ? latest - 64 : cursor + 1);
  while (fromBlock <= latest) {
    const toBlock = ghostWalletLogWindowEnd(fromBlock, latest);
    const logs = await collectSettlementLogs({
      chain: input.chain,
      preferred: input.provider,
      addresses: targetState.deployed,
      fromBlock,
      toBlock,
    });
    for (const log of logs) await ingestGhostWalletSettlementLog(input.chain, log);
    await recordGhostWalletRuntimeState({
      chain: input.chain,
      reconciledBlock: toBlock,
      listenerConnected: input.listenerConnected,
      workerActivity: true,
      metadata: {
        websocketPush: input.listenerConnected,
        reconciliationAuthority: 'durable_cursor_plus_http_log_backfill',
        logBackfillProviderFailover: true,
        logBackfillAdaptiveRangeSplit: true,
        logBackfillMaximumBlockSpan: GHOST_WALLET_MAX_LOG_BLOCK_SPAN,
        persistentProgressPerChunk: true,
        skippedUndeployedHistoricalScan: false,
        lastBackfillFromBlock: fromBlock,
        lastBackfillToBlock: toBlock,
        periodicPolling: false,
        alchemyDependency: false,
        monitoredAddresses: input.addresses,
        deployedMonitoredAddresses: targetState.deployed,
        undeployedMonitoredAddresses: targetState.undeployed,
      },
    });
    fromBlock = toBlock + 1;
  }
}

class GhostWalletChainEvents {
  private readonly listeners = new Map<string, ChainListener>();
  private readonly backfills = new Map<GhostWalletChain, Promise<void>>();
  private readonly pendingBackfills = new Map<GhostWalletChain, {
    chain: GhostWalletChain;
    addresses: string[];
    provider: providers.JsonRpcProvider;
    listenerConnected: boolean;
    endpoint?: string;
  }>();
  private readonly backfillRetryTimers = new Map<GhostWalletChain, NodeJS.Timeout>();
  private readonly backfillRetryAttempts = new Map<GhostWalletChain, number>();
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
    for (const timer of this.backfillRetryTimers.values()) clearTimeout(timer);
    this.listeners.clear();
    this.backfills.clear();
    this.pendingBackfills.clear();
    this.backfillRetryTimers.clear();
    this.backfillRetryAttempts.clear();
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
    this.queueBackfill({
      chain,
      addresses,
      provider: httpProvider,
      listenerConnected: urls.some(url => this.listeners.has(`${chain}:${url}`)),
    });

    if (urls.length === 0) {
      logger.warn('[GhostWalletUltra] Push settlement stream unavailable; startup reconciliation queued', {
        component: 'GhostWalletChainEvents',
        chain,
        periodicPollingEnabled: false,
        alchemyDependency: false,
      });
    }
  }

  private queueBackfill(input: {
    chain: GhostWalletChain;
    addresses: string[];
    provider: providers.JsonRpcProvider;
    listenerConnected: boolean;
    endpoint?: string;
  }): void {
    if (this.stopping) return;
    if (this.backfills.has(input.chain)) {
      this.pendingBackfills.set(input.chain, input);
      return;
    }
    const scheduledRetry = this.backfillRetryTimers.get(input.chain);
    if (scheduledRetry) clearTimeout(scheduledRetry);
    this.backfillRetryTimers.delete(input.chain);
    const work = backfillSettlementLogs({
      chain: input.chain,
      addresses: input.addresses,
      provider: input.provider,
      listenerConnected: input.listenerConnected,
    }).then(() => {
      this.backfillRetryAttempts.delete(input.chain);
    }).catch(error => {
      logger.warn('[GhostWalletUltra] Settlement backfill failed; retry remains route-local', {
        component: 'GhostWalletChainEvents',
        chain: input.chain,
        ...(input.endpoint ? { endpoint: input.endpoint } : {}),
        error: error instanceof Error ? error.message : String(error),
        routeLocalFailure: true,
      });
      this.scheduleBackfillRetry(input, error);
    }).finally(() => {
      this.backfills.delete(input.chain);
      const pending = this.pendingBackfills.get(input.chain);
      this.pendingBackfills.delete(input.chain);
      if (pending && !this.stopping) this.queueBackfill(pending);
    });
    this.backfills.set(input.chain, work);
  }

  private scheduleBackfillRetry(input: {
    chain: GhostWalletChain;
    addresses: string[];
    provider: providers.JsonRpcProvider;
    listenerConnected: boolean;
    endpoint?: string;
  }, error: unknown): void {
    if (this.stopping || this.backfillRetryTimers.has(input.chain)) return;
    const attempt = (this.backfillRetryAttempts.get(input.chain) || 0) + 1;
    this.backfillRetryAttempts.set(input.chain, attempt);
    const delayMs = reconnectDelayMs(attempt, error);
    const timer = setTimeout(() => {
      this.backfillRetryTimers.delete(input.chain);
      this.queueBackfill(input);
    }, delayMs);
    timer.unref?.();
    this.backfillRetryTimers.set(input.chain, timer);
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
        if (payload?.method === 'eth_subscription') this.queueBackfill({
          chain: listener.chain,
          addresses: listener.addresses,
          provider: httpProvider,
          listenerConnected: true,
          endpoint: listener.url,
        });
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
        this.queueBackfill({
          chain: listener.chain,
          addresses: listener.addresses,
          provider: http,
          listenerConnected: true,
          endpoint: listener.url,
        });
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
  bridgeDescriptorTimeoutMs: BRIDGE_DESCRIPTOR_TIMEOUT_MS,
  reconnectBackfill: true,
  startupBackfillNonBlocking: true,
  retryBackfillWithoutPeriodicPolling: true,
  reconnectBackoff: 'bounded_exponential_with_throttle_delay_and_jitter',
  periodicPolling: false,
  durableCursorBackfill: true,
  maximumLogBlockSpan: GHOST_WALLET_MAX_LOG_BLOCK_SPAN,
  persistentProgressPerChunk: true,
  undeployedTargetHistorySkipped: true,
  coalescedPushBackfillReplay: true,
  singleSettlementIngestionAuthority: true,
  routeLocalFailure: true,
} as const;
