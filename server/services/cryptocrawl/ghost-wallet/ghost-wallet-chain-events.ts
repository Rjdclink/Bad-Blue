import { ethers, providers } from 'ethers';
import logger from '../../../logger.js';
import { resolvePrimaryProfitPayoutAddress } from '../core/wallet-identity.js';
import { getGhostWalletExternalBridgeDescriptor } from './ghost-wallet-external-bridge.js';
import { ghostWalletEngine } from './ghost-wallet-engine.js';
import { ghostWalletProviderMesh, ghostWalletWebSocketUrls, type GhostWalletChain } from './ghost-wallet-provider-mesh.js';
import { enqueueGhostWalletWork, upsertGhostWalletVenue } from './ghost-wallet-work-ledger.js';
import { ghostWalletWorkSignal } from './ghost-wallet-work-signal.js';
import { getGhostWalletReconciledBlock, recordGhostWalletRuntimeState } from './ghost-wallet-runtime-state.js';

const EVENT_INTERFACE = new ethers.utils.Interface([
  'event AtomicCreditSettled(address indexed source,address indexed asset,uint256 principal,uint256 sourceFee,uint256 realizedProfit,address indexed profitRecipient)',
  'event AtomicLiabilityCycleSettled(address indexed liabilityOracle,bytes32 indexed liabilityQueryHash,address indexed profitAsset,uint256 startingLiability,uint256 endingLiability,uint256 realizedProfit,address profitRecipient)',
  'event MatchedIntentPairSettled(address indexed ownerA,address indexed ownerB,address tokenA,address tokenB,uint256 feeA,uint256 feeB,address profitRecipient)',
  'event VaultCreditSettled(address indexed vault,address indexed asset,uint256 principal,uint256 sourceFee,uint256 realizedProfit,address indexed profitRecipient)',
  'event BrokeredAtomicCreditSettled(address indexed vault,address indexed borrower,address indexed asset,uint256 principal,uint256 sourceFee,uint256 borrowerFee,uint256 realizedSpread,address profitRecipient)',
  'event ExternalCreditBrokered(address indexed lender,address indexed borrower,address indexed token,uint256 principal,uint256 upstreamFee,uint256 borrowerFee,uint256 realizedSpread,address profitRecipient,address initiator,uint8 upstreamKind)',
]);
const ALL_EVENT_TOPICS = Object.values(EVENT_INTERFACE.events).map(event => EVENT_INTERFACE.getEventTopic(event));
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

function normalized(value: string): string { return value.trim().toLowerCase(); }
function address(value: unknown): string { return ethers.utils.getAddress(String(value)); }
function amount(value: unknown): bigint { return BigInt(ethers.BigNumber.from(value as any).toString()); }

function upstreamProtocol(kind: number): string {
  if (kind === 1) return 'erc3156';
  if (kind === 2) return 'aave_v3';
  if (kind === 3) return 'morpho_blue';
  if (kind === 4) return 'balancer_v2';
  return 'unknown_atomic_lender';
}

async function enqueueProfit(input: {
  chain: string;
  transactionHash: string;
  blockNumber: number;
  logIndex: number;
  asset: string;
  amount: bigint;
  sourceKind: string;
}): Promise<void> {
  if (input.amount <= 0n) return;
  await enqueueGhostWalletWork({
    dedupeKey: `ghost-profit:${input.transactionHash.toLowerCase()}:${input.logIndex}:${input.asset.toLowerCase()}:${input.amount}`,
    kind: 'profit_conversion',
    chain: input.chain,
    priority: 2_000,
    maxAttempts: 48,
    profitAsset: input.asset,
    profitAmountBaseUnits: input.amount,
    payload: {
      sourceTransactionHash: input.transactionHash,
      sourceBlockNumber: input.blockNumber,
      chain: input.chain,
      asset: input.asset,
      amountBaseUnits: input.amount.toString(),
      destinationMode: 'primary',
      sourceKind: input.sourceKind,
    },
  });
}

async function processSettlementLog(chain: string, log: providers.Log): Promise<void> {
  const primary = resolvePrimaryProfitPayoutAddress();
  if (!primary) return;
  let parsed: ethers.utils.LogDescription;
  try { parsed = EVENT_INTERFACE.parseLog(log); } catch { return; }
  const args = parsed.args;

  if (parsed.name === 'AtomicCreditSettled') {
    if (address(args.profitRecipient).toLowerCase() !== primary.toLowerCase()) return;
    await enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
      asset: address(args.asset), amount: amount(args.realizedProfit), sourceKind: 'atomic_credit' });
  } else if (parsed.name === 'AtomicLiabilityCycleSettled') {
    if (address(args.profitRecipient).toLowerCase() !== primary.toLowerCase()) return;
    await enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
      asset: address(args.profitAsset), amount: amount(args.realizedProfit), sourceKind: 'atomic_liability_cycle' });
  } else if (parsed.name === 'MatchedIntentPairSettled') {
    if (address(args.profitRecipient).toLowerCase() !== primary.toLowerCase()) return;
    const tokenA = address(args.tokenA);
    const tokenB = address(args.tokenB);
    await Promise.all([
      enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
        asset: tokenB, amount: amount(args.feeA), sourceKind: 'matched_intent_fee_a' }),
      enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
        asset: tokenA, amount: amount(args.feeB), sourceKind: 'matched_intent_fee_b' }),
    ]);
  } else if (parsed.name === 'VaultCreditSettled') {
    if (address(args.profitRecipient).toLowerCase() !== primary.toLowerCase()) return;
    await enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
      asset: address(args.asset), amount: amount(args.realizedProfit), sourceKind: 'vault_atomic_credit' });
  } else if (parsed.name === 'BrokeredAtomicCreditSettled') {
    if (address(args.profitRecipient).toLowerCase() !== primary.toLowerCase()) return;
    const borrower = address(args.borrower);
    const vault = address(args.vault);
    const asset = address(args.asset);
    await Promise.all([
      enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
        asset, amount: amount(args.realizedSpread), sourceKind: 'brokered_atomic_credit' }),
      upsertGhostWalletVenue({
        venueId: `erc3156-borrower:${chain}:${borrower.toLowerCase()}`,
        chain, protocol: 'erc3156', role: 'borrower', address: borrower, asset,
        adapter: 'erc3156_flash_borrower', discoveredFrom: 'successful_broker_settlement', verified: true,
        capabilities: { sameTransactionRepaymentObserved: true, atomicCallback: true },
        metadata: { lastSuccessfulSettlementTx: log.transactionHash },
      }),
      upsertGhostWalletVenue({
        venueId: `ghost-vault:${chain}:${vault.toLowerCase()}`,
        chain, protocol: 'ghost_wallet_erc4626', role: 'lender', address: vault, asset,
        adapter: 'ghost_wallet_capital_vault', discoveredFrom: 'successful_broker_settlement', verified: true,
        capabilities: { sameTransactionSettlement: true, repaymentFailureReverts: true },
        metadata: { lastSuccessfulSettlementTx: log.transactionHash },
      }),
    ]);
  } else if (parsed.name === 'ExternalCreditBrokered') {
    if (address(args.profitRecipient).toLowerCase() !== primary.toLowerCase()) return;
    const lender = address(args.lender);
    const borrower = address(args.borrower);
    const asset = address(args.token);
    const kind = Number(args.upstreamKind);
    const protocol = upstreamProtocol(kind);
    const spread = amount(args.realizedSpread);
    await Promise.all([
      enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
        asset, amount: spread, sourceKind: `external_credit:${protocol}` }),
      upsertGhostWalletVenue({
        venueId: `external-lender:${chain}:${protocol}:${lender.toLowerCase()}:${asset.toLowerCase()}`,
        chain, protocol, role: 'lender', address: lender, asset,
        adapter: `caller_funded_${protocol}`, discoveredFrom: 'successful_external_credit_settlement', verified: true,
        capabilities: {
          sameTransactionSettlement: true,
          repaymentObserved: true,
          operatorMonetaryInputRequired: false,
          upstreamFeeBaseUnits: String(args.upstreamFee),
        },
        metadata: { lastSuccessfulSettlementTx: log.transactionHash },
      }),
      upsertGhostWalletVenue({
        venueId: `external-borrower:${chain}:${borrower.toLowerCase()}:${asset.toLowerCase()}`,
        chain, protocol: 'erc3156_borrower', role: 'borrower', address: borrower, asset,
        adapter: 'erc3156_flash_borrower', discoveredFrom: 'successful_external_credit_settlement', verified: true,
        capabilities: { sameTransactionRepaymentObserved: true, atomicCallback: true },
        metadata: { lastSuccessfulSettlementTx: log.transactionHash },
      }),
    ]);
  }

  await recordGhostWalletRuntimeState({
    chain,
    reconciledBlock: log.blockNumber,
    notification: true,
    workerActivity: true,
    metadata: { lastSettlementTransactionHash: log.transactionHash, settlementEvent: parsed.name },
  });
  ghostWalletWorkSignal.emitWake('local_work_enqueued');
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
      component: 'GhostWalletChainEvents', chain,
      error: error instanceof Error ? error.message : String(error),
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
      topics: [ALL_EVENT_TOPICS],
      fromBlock,
      toBlock: latest,
    });
    for (const log of logs) await processSettlementLog(input.chain, log);
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
    await Promise.all(chains.map(chain => this.ensureChain(chain)));
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
    // Subscribe first where possible. Then one durable HTTP cursor reconciliation
    // closes the subscribe/backfill race. Multiple sockets are duplicate-safe.
    await Promise.allSettled(urls.map(url => this.ensureStream(chain, url, addresses, httpProvider)));
    await backfillSettlementLogs({
      chain, addresses, provider: httpProvider,
      listenerConnected: urls.some(url => this.listeners.has(`${chain}:${url}`)),
    });

    if (urls.length === 0) {
      logger.warn('[GhostWalletUltra] Push settlement stream unavailable; bounded startup reconciliation completed', {
        component: 'GhostWalletChainEvents', chain, periodicPollingEnabled: false, alchemyDependency: false,
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
    const listener: ChainListener = { key, chain, url, addresses, provider: ws, stopping: false, reconnectTimer: null };
    try {
      const [network, httpNetwork] = await Promise.all([ws.getNetwork(), httpProvider.getNetwork()]);
      if (network.chainId !== httpNetwork.chainId) throw new Error('Ghost Wallet websocket chain identity mismatch');
      this.listeners.set(key, listener);
      const filter = { address: addresses, topics: [ALL_EVENT_TOPICS] };
      ws.on(filter, log => {
        void processSettlementLog(chain, log as providers.Log).catch(error => logger.warn('[GhostWalletUltra] Settlement event ingestion failed', {
          component: 'GhostWalletChainEvents', chain, endpoint: url,
          error: error instanceof Error ? error.message : String(error), periodicPollingEnabled: false,
        }));
      });
      const socket = (ws as any)._websocket;
      const reconnect = () => this.scheduleReconnect(listener);
      socket?.once?.('close', reconnect);
      socket?.once?.('error', reconnect);
      ws.on('error', reconnect);
    } catch (error) {
      this.closeListener(listener);
      logger.warn('[GhostWalletUltra] Non-Alchemy settlement push stream unavailable', {
        component: 'GhostWalletChainEvents', chain, endpoint: url,
        error: error instanceof Error ? error.message : String(error), periodicPollingEnabled: false,
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
} as const;
