import { ethers, providers } from 'ethers';
import logger from '../../../logger.js';
import { resolvePrimaryProfitPayoutAddress } from '../core/wallet-identity.js';
import { ghostWalletEngine } from './ghost-wallet-engine.js';
import { enqueueGhostWalletWork, upsertGhostWalletVenue } from './ghost-wallet-work-ledger.js';
import { ghostWalletWorkSignal } from './ghost-wallet-work-signal.js';
import { getGhostWalletReconciledBlock, recordGhostWalletRuntimeState } from './ghost-wallet-runtime-state.js';

const EVENT_INTERFACE = new ethers.utils.Interface([
  'event AtomicCreditSettled(address indexed source,address indexed asset,uint256 principal,uint256 sourceFee,uint256 realizedProfit,address indexed profitRecipient)',
  'event AtomicLiabilityCycleSettled(address indexed liabilityOracle,bytes32 indexed liabilityQueryHash,address indexed profitAsset,uint256 startingLiability,uint256 endingLiability,uint256 realizedProfit,address profitRecipient)',
  'event MatchedIntentPairSettled(address indexed ownerA,address indexed ownerB,address tokenA,address tokenB,uint256 feeA,uint256 feeB,address profitRecipient)',
  'event VaultCreditSettled(address indexed vault,address indexed asset,uint256 principal,uint256 sourceFee,uint256 realizedProfit,address indexed profitRecipient)',
  'event BrokeredAtomicCreditSettled(address indexed vault,address indexed borrower,address indexed asset,uint256 principal,uint256 sourceFee,uint256 borrowerFee,uint256 realizedSpread,address profitRecipient)',
]);

const ALL_EVENT_TOPICS = Object.values(EVENT_INTERFACE.events).map(event => EVENT_INTERFACE.getEventTopic(event));

interface ChainListener {
  chain: string;
  intermediary: string;
  provider: providers.WebSocketProvider;
  stopping: boolean;
  reconnectTimer: NodeJS.Timeout | null;
}

function normalized(value: string): string { return value.trim().toLowerCase(); }
function address(value: unknown): string { return ethers.utils.getAddress(String(value)); }
function amount(value: unknown): bigint { return BigInt(ethers.BigNumber.from(value as any).toString()); }

function alchemyPrefix(chain: string): string | null {
  if (chain === 'ethereum') return 'eth-mainnet';
  if (chain === 'polygon') return 'polygon-mainnet';
  if (chain === 'arbitrum') return 'arb-mainnet';
  if (chain === 'optimism') return 'opt-mainnet';
  return null;
}

function deriveWebSocketUrl(chain: string, httpProvider: providers.JsonRpcProvider): string | null {
  const existing = process.env[`${chain.toUpperCase()}_WS_URL`]?.trim();
  if (existing?.startsWith('wss://')) return existing;

  const connectionUrl = String((httpProvider as any)?.connection?.url || '');
  if (/^https:\/\/[^/]+\.g\.alchemy\.com\/v2\//i.test(connectionUrl)) {
    return connectionUrl.replace(/^https:/i, 'wss:');
  }

  const key = process.env.ALCHEMY_API_KEY?.trim();
  const prefix = alchemyPrefix(chain);
  return key && prefix ? `wss://${prefix}.g.alchemy.com/v2/${key}` : null;
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
    const feeA = amount(args.feeA);
    const feeB = amount(args.feeB);
    // feeA is paid in tokenB; feeB is paid in tokenA.
    await Promise.all([
      enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
        asset: tokenB, amount: feeA, sourceKind: 'matched_intent_fee_a' }),
      enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
        asset: tokenA, amount: feeB, sourceKind: 'matched_intent_fee_b' }),
    ]);
  } else if (parsed.name === 'VaultCreditSettled') {
    if (address(args.profitRecipient).toLowerCase() !== primary.toLowerCase()) return;
    await enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
      asset: address(args.asset), amount: amount(args.realizedProfit), sourceKind: 'vault_atomic_credit' });
    await upsertGhostWalletVenue({
      venueId: `ghost-vault:${chain}:${address(args.vault).toLowerCase()}`,
      chain, protocol: 'ghost_wallet_erc4626', role: 'lender', address: address(args.vault), asset: address(args.asset),
      adapter: 'ghost_wallet_capital_vault', discoveredFrom: 'verified_settlement_event', verified: true,
      capabilities: { sameTransactionSettlement: true, repaymentFailureReverts: true },
      metadata: { lastSettlementTx: log.transactionHash },
    });
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
  }

  await recordGhostWalletRuntimeState({
    chain,
    reconciledBlock: log.blockNumber,
    notification: true,
    workerActivity: true,
    metadata: { lastSettlementTransactionHash: log.transactionHash },
  });
  ghostWalletWorkSignal.emitWake('local_work_enqueued');
}

class GhostWalletChainEvents {
  private readonly listeners = new Map<string, ChainListener>();
  private stopping = false;

  async start(): Promise<void> {
    this.stopping = false;
    for (const chain of ghostWalletEngine.getStatus().configuredIntermediaryChains) {
      await this.ensureChain(chain);
    }
  }

  stop(): void {
    this.stopping = true;
    for (const listener of this.listeners.values()) {
      listener.stopping = true;
      if (listener.reconnectTimer) clearTimeout(listener.reconnectTimer);
      try { listener.provider.removeAllListeners(); } catch { /* best effort */ }
      try { (listener.provider as any)._websocket?.terminate?.(); } catch { /* best effort */ }
      try { (listener.provider as any)._websocket?.close?.(); } catch { /* best effort */ }
    }
    this.listeners.clear();
  }

  private async ensureChain(chainValue: string): Promise<void> {
    const chain = normalized(chainValue);
    if (this.stopping || this.listeners.has(chain)) return;
    const httpProvider = ghostWalletEngine.getProvider(chain);
    const intermediary = ghostWalletEngine.getConfiguredIntermediary(chain);
    if (!httpProvider || !intermediary) return;
    const url = deriveWebSocketUrl(chain, httpProvider);
    if (!url) {
      logger.warn('[GhostWalletUltra] Push settlement stream unavailable; startup/reconnect reconciliation remains enabled', {
        component: 'GhostWalletChainEvents', chain, periodicPollingEnabled: false,
      });
      return;
    }

    const ws = new providers.WebSocketProvider(url);
    const listener: ChainListener = { chain, intermediary, provider: ws, stopping: false, reconnectTimer: null };
    this.listeners.set(chain, listener);
    try {
      const [network, httpNetwork] = await Promise.all([ws.getNetwork(), httpProvider.getNetwork()]);
      if (network.chainId !== httpNetwork.chainId) throw new Error('Ghost Wallet websocket chain identity mismatch');
      const filter = { address: intermediary, topics: [ALL_EVENT_TOPICS] };
      ws.on(filter, log => { void processSettlementLog(chain, log as providers.Log).catch(error => logger.warn('[GhostWalletUltra] Settlement event ingestion failed', {
        component: 'GhostWalletChainEvents', chain, error: error instanceof Error ? error.message : String(error), periodicPollingEnabled: false,
      })); });

      // Subscribe first, then recover the durable cursor gap. Dedupe keys make the
      // overlap harmless and close the subscribe/backfill race.
      const latest = await httpProvider.getBlockNumber();
      const cursor = await getGhostWalletReconciledBlock(chain);
      const fromBlock = Math.max(0, cursor === null ? latest - 64 : cursor + 1);
      if (fromBlock <= latest) {
        const logs = await httpProvider.getLogs({ address: intermediary, topics: [ALL_EVENT_TOPICS], fromBlock, toBlock: latest });
        for (const log of logs) await processSettlementLog(chain, log);
      }
      await recordGhostWalletRuntimeState({ chain, reconciledBlock: latest, listenerConnected: true, metadata: { websocketPush: true } });

      const socket = (ws as any)._websocket;
      const reconnect = () => this.scheduleReconnect(chain);
      socket?.once?.('close', reconnect);
      socket?.once?.('error', reconnect);
      ws.on('error', reconnect);
    } catch (error) {
      this.listeners.delete(chain);
      try { ws.removeAllListeners(); } catch { /* ignore */ }
      logger.warn('[GhostWalletUltra] Settlement push stream failed; reconnect scheduled without work polling', {
        component: 'GhostWalletChainEvents', chain, error: error instanceof Error ? error.message : String(error), periodicPollingEnabled: false,
      });
      this.scheduleReconnect(chain);
    }
  }

  private scheduleReconnect(chain: string): void {
    const current = this.listeners.get(chain);
    if (current) {
      if (current.stopping || this.stopping || current.reconnectTimer) return;
      current.reconnectTimer = setTimeout(() => {
        this.listeners.delete(chain);
        try { current.provider.removeAllListeners(); } catch { /* ignore */ }
        void this.ensureChain(chain);
      }, 2_000);
      current.reconnectTimer.unref?.();
      return;
    }
    if (this.stopping) return;
    const timer = setTimeout(() => void this.ensureChain(chain), 2_000);
    timer.unref?.();
  }
}

export const ghostWalletChainEvents = new GhostWalletChainEvents();
