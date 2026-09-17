import os from 'node:os';
import pg from 'pg';
import { Contract, ethers, type providers } from 'ethers';
import logger from '../../../logger.js';
import { ensureCryptocrawlOverflowRuntimeSchema } from '../runtime/cryptocrawl-overflow-runtime-schema.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import { ghostWalletAutonomousController } from './ghost-wallet-autonomous-controller.js';
import { ghostWalletChainEvents } from './ghost-wallet-chain-events.js';
import {
  evaluateGhostWalletControllerEconomics,
  evaluateGhostWalletMultiAssetControllerEconomics,
} from './ghost-wallet-controller-economics.js';
import { ghostWalletEngine } from './ghost-wallet-engine.js';
import { assertGhostWalletMandateStillExecutable } from './ghost-wallet-mandate-runtime-guard.js';
import {
  ensureGhostWalletPimlicoSubmission,
  getGhostWalletPimlicoReceipt,
  prepareGhostWalletPimlicoSponsoredTransaction,
  submitGhostWalletPimlicoSponsoredTransaction,
  type GhostWalletPimlicoRpcUserOperation,
} from './ghost-wallet-pimlico-sponsor.js';
import { processGhostWalletProfitConversion, type GhostWalletProfitConversionPayload } from './ghost-wallet-payout.js';
import { recordGhostWalletPerformance } from './ghost-wallet-performance-intelligence.js';
import { ghostWalletProviderMesh, type GhostWalletChain } from './ghost-wallet-provider-mesh.js';
import { deserializeMatchedIntentPair } from './ghost-wallet-work-codec.js';
import {
  claimGhostWalletWork,
  deferGhostWalletWork,
  enqueueGhostWalletWork,
  markGhostWalletWorkProcessing,
  markGhostWalletWorkSettled,
  markGhostWalletWorkSubmitted,
  type GhostWalletWorkItem,
} from './ghost-wallet-work-ledger.js';
import { ghostWalletWorkSignal, type GhostWalletWakeReason } from './ghost-wallet-work-signal.js';
import { ingestGhostWalletSettlementReceipt } from './ghost-wallet-settlement-ingest.js';
import { recordGhostWalletRuntimeState } from './ghost-wallet-runtime-state.js';
import { probeGhostWalletVenueCandidate, syncMeasuredGhostWalletVenues } from './ghost-wallet-venue-universe.js';

const { Client } = pg;
const LISTEN_CHANNEL = 'cryptocrawler_ghost_wallet_work';
const BRIDGE_ABI = ['function minimumBrokerSpreadBps() view returns (uint16)'];
const LISTENER_RECONNECT_BASE_MS = 500;
const LISTENER_RECONNECT_MAX_MS = 30_000;
const SUBMISSION_PRESENCE_VERIFY_EVERY = 4;

function normalizedUrl(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

function listenerConnectionUrl(): string {
  const raw = normalizedUrl(process.env.SUPABASE_DATABASE_URL_OVERFLOW || process.env.GHOST_WALLET_OVERFLOW_DATABASE_URL);
  if (!raw) throw new Error('GHOST_WALLET_OVERFLOW_DATABASE_URL_UNAVAILABLE');
  const parsed = new URL(raw);
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('GHOST_WALLET_OVERFLOW_DATABASE_URL_INVALID');
  }
  if (/(^|\.)pooler\.supabase\.com$/i.test(parsed.hostname) && parsed.port === '6543') parsed.port = '5432';
  return parsed.toString();
}

function listenerSsl() {
  return process.env.PGSSLMODE !== 'disable'
    ? { rejectUnauthorized: false, ...(process.env.DATABASE_SSL_CERT ? { ca: process.env.DATABASE_SSL_CERT } : {}) }
    : false;
}

function parallelCapacity(): number {
  return Math.max(1, os.availableParallelism?.() || os.cpus().length || 1);
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function validRawTransaction(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]+$/.test(value) && value.length > 130;
}

function validPimlicoUserOperation(value: unknown): value is GhostWalletPimlicoRpcUserOperation {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.sender === 'string'
    && typeof row.nonce === 'string'
    && typeof row.callData === 'string'
    && typeof row.signature === 'string';
}

function isPimlicoSubmission(work: GhostWalletWorkItem): boolean {
  return work.result?.submissionKind === 'pimlico_user_operation'
    && validHash(work.transactionHash)
    && validPimlicoUserOperation(work.result?.pimlicoUserOperation);
}

function fullJitterDelay(baseMs: number, maxMs: number, attempt: number): number {
  const exponent = Math.max(0, Math.min(10, attempt));
  const cap = Math.min(maxMs, baseMs * (2 ** exponent));
  return Math.max(Math.min(baseMs, cap), Math.floor(Math.random() * Math.max(1, cap + 1)));
}

function retryDelayMs(attempt: number): number {
  return fullJitterDelay(250, 30_000, Math.max(0, attempt - 1));
}

function receiptRetryDelayMs(pollCount: number): number {
  const base = pollCount <= 1 ? 400 : 500;
  return fullJitterDelay(base, 5_000, Math.max(0, pollCount - 1));
}

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = String(payload[key] ?? '').trim();
  if (!value) throw new Error(`GHOST_WALLET_PREPARED_${key.toUpperCase()}_INVALID`);
  return value;
}

function payloadChain(work: GhostWalletWorkItem): GhostWalletChain {
  return payloadString({ chain: work.payload.chain || work.chain }, 'chain') as GhostWalletChain;
}

function billedGasCostWei(actualGasCostWei: bigint | null, surchargeBpsValue: unknown): bigint | null {
  if (actualGasCostWei === null || actualGasCostWei < 0n) return null;
  const parsed = Number(surchargeBpsValue);
  const bps = Number.isInteger(parsed) && parsed >= 0 && parsed <= 5_000 ? parsed : 0;
  return (actualGasCostWei * BigInt(10_000 + bps) + 9_999n) / 10_000n;
}

async function markDead(work: GhostWalletWorkItem, owner: string, error: unknown): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
  await pool.query(
    `UPDATE private.cryptocrawler_ghost_wallet_work
     SET status='DEAD', lease_owner=NULL, lease_until=NULL, last_error=$3, updated_at=now()
     WHERE work_id=$1 AND lease_owner=$2`,
    [work.workId, owner, message],
  );
}

export async function enqueueGhostWalletPreparedAtomicExecution(input: {
  dedupeKey: string;
  chain: GhostWalletChain;
  payload: Record<string, unknown>;
  priority?: number;
}): Promise<string> {
  const work = await enqueueGhostWalletWork({
    dedupeKey: input.dedupeKey,
    kind: 'prepared_atomic_execution',
    chain: input.chain,
    priority: input.priority ?? 900,
    maxAttempts: 20,
    payload: input.payload,
  });
  ghostWalletWorkSignal.emitWake('local_work_enqueued');
  return work.workId;
}

class GhostWalletUltraWorker {
  private running = false;
  private listener: InstanceType<typeof Client> | null = null;
  private listenerReconnectTimer: NodeJS.Timeout | null = null;
  private listenerReconnectAttempt = 0;
  private nextDueTimer: NodeJS.Timeout | null = null;
  private readonly retryTimers = new Map<string, NodeJS.Timeout>();
  private readonly submittedPollCounts = new Map<string, number>();
  private readonly submittedThisAttempt = new Set<string>();
  private unsubscribeLocalWake: (() => void) | null = null;
  private draining = false;
  private wakePending = false;
  private readonly laneTails = new Map<string, Promise<void>>();
  private readonly workerId = `ghost-ultra:${process.pid}:${Math.random().toString(36).slice(2)}`;

  async start(): Promise<void> {
    if (this.running) return;
    await ensureCryptocrawlOverflowRuntimeSchema();
    await ghostWalletEngine.start();
    this.running = true;
    try {
      this.unsubscribeLocalWake = ghostWalletWorkSignal.onWake(reason => this.requestDrain(reason));
      await this.connectListener();
      await ghostWalletChainEvents.start();
      await syncMeasuredGhostWalletVenues(ghostWalletEngine.getMeasuredCapitalQuotes());
      await ghostWalletAutonomousController.start();
      this.requestDrain('startup_backlog');
      logger.info('[GhostWalletUltra] Dedicated event-driven Ultra Worker started', {
        component: 'GhostWalletUltraWorker',
        workerId: this.workerId,
        periodicWorkPolling: false,
        wakeSources: ['postgres_notify', 'local_enqueue', 'chain_settlement_websocket', 'startup_backlog', 'per_job_retry'],
        persistenceAuthority: 'overflow_private_cryptocrawler_ghost_wallet_work',
        parallelCapacity: parallelCapacity(),
        concurrencyPolicy: 'read_lanes_parallel_transaction_lanes_serialized_per_chain',
        intermediarySubmitsTransactions: false,
        autonomousControllerSubmission: true,
        sponsoredUserOperationEconomicsAuthority: true,
        pimlicoExclusiveExecutionGasAuthority: true,
        nativeControllerGasFallback: false,
        providerSponsoredExecution: true,
        signedUserOperationPersistedBeforeSubmission: true,
        providerCircuitBreaking: true,
        adaptiveReceiptPolling: true,
        periodicSubmissionPresenceVerification: true,
        controllerGasAuthority: 'pimlico_eip7702_erc4337_sponsored_user_operation',
        alchemyDependency: false,
        profitLadderAuthority: false,
        zeroCapitalExecutionAuthority: false,
      });
    } catch (error) {
      await this.stop().catch(() => undefined);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    ghostWalletAutonomousController.stop();
    this.unsubscribeLocalWake?.();
    this.unsubscribeLocalWake = null;
    ghostWalletChainEvents.stop();
    if (this.listenerReconnectTimer) clearTimeout(this.listenerReconnectTimer);
    this.listenerReconnectTimer = null;
    this.listenerReconnectAttempt = 0;
    if (this.nextDueTimer) clearTimeout(this.nextDueTimer);
    this.nextDueTimer = null;
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    this.submittedPollCounts.clear();
    this.submittedThisAttempt.clear();
    const client = this.listener;
    this.listener = null;
    if (client) {
      try { await client.query(`UNLISTEN ${LISTEN_CHANNEL}`); } catch { /* connection may already be gone */ }
      try { await client.end(); } catch { /* best effort */ }
    }
    ghostWalletEngine.stop();
  }

  private async connectListener(): Promise<void> {
    if (!this.running || this.listener) return;
    const client = new Client({
      connectionString: listenerConnectionUrl(),
      ssl: listenerSsl(),
      application_name: 'cryptocrawl-ghost-wallet-ultra-listener',
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      connectionTimeoutMillis: 15_000,
    });
    let reconnectScheduled = false;
    const reconnect = (reason: unknown) => {
      if (reconnectScheduled || !this.running) return;
      reconnectScheduled = true;
      if (this.listener === client) this.listener = null;
      this.scheduleListenerReconnect(reason);
    };
    client.on('error', reconnect);
    client.on('end', () => reconnect('listener_end'));
    client.on('notification', message => {
      if (message.channel !== LISTEN_CHANNEL) return;
      void recordGhostWalletRuntimeState({
        chain: 'global', notification: true, metadata: { workId: message.payload || null },
      }).catch(() => undefined);
      ghostWalletAutonomousController.requestEvaluation('explicit_refresh');
      this.requestDrain('postgres_notify');
    });
    await client.connect();
    await client.query(`LISTEN ${LISTEN_CHANNEL}`);
    this.listener = client;
    this.listenerReconnectAttempt = 0;
    await recordGhostWalletRuntimeState({
      chain: 'global', listenerConnected: true,
      metadata: { eventDriven: true, alchemyDependency: false, pimlicoExclusiveExecutionGasAuthority: true },
    });
    // PostgreSQL LISTEN becomes authoritative only after commit; the durable backlog scan
    // immediately after registration closes the startup race before notifications are trusted.
    this.requestDrain('listener_reconnected');
  }

  private scheduleListenerReconnect(reason: unknown): void {
    if (!this.running || this.listenerReconnectTimer) return;
    const attempt = this.listenerReconnectAttempt;
    this.listenerReconnectAttempt = Math.min(20, attempt + 1);
    const delayMs = fullJitterDelay(LISTENER_RECONNECT_BASE_MS, LISTENER_RECONNECT_MAX_MS, attempt);
    logger.warn('[GhostWalletUltra] Overflow listener disconnected; durable backlog preserved', {
      component: 'GhostWalletUltraWorker',
      error: reason instanceof Error ? reason.message : String(reason),
      workPollingFallbackEnabled: false,
      reconnectAttempt: attempt + 1,
      reconnectDelayMs: delayMs,
      reconnectBackoff: 'bounded_exponential_full_jitter',
    });
    this.listenerReconnectTimer = setTimeout(() => {
      this.listenerReconnectTimer = null;
      void this.connectListener().catch(error => this.scheduleListenerReconnect(error));
    }, delayMs);
    this.listenerReconnectTimer.unref?.();
  }

  private requestDrain(_reason: GhostWalletWakeReason): void {
    if (!this.running) return;
    this.wakePending = true;
    if (this.draining) return;
    queueMicrotask(() => { void this.drain(); });
  }

  private async drain(): Promise<void> {
    if (!this.running || this.draining) return;
    this.draining = true;
    try {
      const limit = parallelCapacity();
      do {
        this.wakePending = false;
        const batch = await claimGhostWalletWork({ owner: this.workerId, limit, leaseMs: 60_000 });
        if (batch.length === 0) break;
        await Promise.allSettled(batch.map(work => this.runInLane(this.laneFor(work), () => this.process(work))));
        if (batch.length === limit) this.wakePending = true;
      } while (this.running && this.wakePending);
    } catch (error) {
      logger.warn('[GhostWalletUltra] Event-driven drain degraded; work remains durable', {
        component: 'GhostWalletUltraWorker',
        error: error instanceof Error ? error.message : String(error),
        periodicPollingEnabled: false,
      });
    } finally {
      this.draining = false;
      await this.scheduleNextDurableDue().catch(() => undefined);
      if (this.wakePending) this.requestDrain('explicit_refresh');
    }
  }

  private laneFor(work: GhostWalletWorkItem): string {
    if (work.kind === 'profit_conversion' || work.kind === 'matched_intent_settlement' || work.kind === 'prepared_atomic_execution') {
      return `transaction:${String(work.payload.chain || work.chain).toLowerCase()}`;
    }
    return `read:${work.workId}`;
  }

  private runInLane(lane: string, task: () => Promise<void>): Promise<void> {
    const previous = this.laneTails.get(lane) || Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    const terminal = next.finally(() => {
      if (this.laneTails.get(lane) === terminal) this.laneTails.delete(lane);
    });
    this.laneTails.set(lane, terminal);
    return terminal;
  }

  private async process(work: GhostWalletWorkItem): Promise<void> {
    this.submittedThisAttempt.delete(work.workId);
    try {
      await recordGhostWalletRuntimeState({
        chain: work.chain, workerActivity: true, metadata: { kind: work.kind, workId: work.workId },
      });
      await markGhostWalletWorkProcessing(work.workId, this.workerId);
      if (work.kind === 'matched_intent_settlement') await this.processMatchedIntent(work);
      else if (work.kind === 'profit_conversion') await this.processProfitConversion(work);
      else if (work.kind === 'source_refresh') await this.processSourceRefresh(work);
      else if (work.kind === 'venue_probe') await this.processVenueProbe(work);
      else if (work.kind === 'prepared_atomic_execution') await this.processPreparedAtomic(work);
      else if (work.kind === 'settlement_reconcile') await this.processSettlementReconcile(work);
      else throw new Error(`GHOST_WALLET_UNSUPPORTED_WORK_KIND:${work.kind}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const deterministic = /INVALID|EXPIRED|NOT_POSITIVE|MISMATCH|REVERTED|UNSUPPORTED|TERMINAL_FAILURE|SETTLEMENT_EVENT_REQUIRED|FINAL_CANCELLED|FINAL_NOT_FOUND/.test(message);
      if (deterministic) {
        this.submittedPollCounts.delete(work.workId);
        await markDead(work, this.workerId, error).catch(() => undefined);
        return;
      }
      const deferred = await deferGhostWalletWork({
        workId: work.workId,
        owner: this.workerId,
        error,
        retryAfterMs: retryDelayMs(work.attemptCount + 1),
        preserveSubmitted: validHash(work.transactionHash) || this.submittedThisAttempt.has(work.workId),
      }).catch(() => null);
      if (deferred && !deferred.terminal) this.scheduleRetry(work.workId, deferred.notBefore);
    } finally {
      this.submittedThisAttempt.delete(work.workId);
      ghostWalletAutonomousController.requestEvaluation('work_completed');
    }
  }

  private async pimlicoNetworkReceipt(work: GhostWalletWorkItem, chain: GhostWalletChain): Promise<providers.TransactionReceipt | null> {
    if (!isPimlicoSubmission(work) || !work.transactionHash) return null;
    const pimlicoReceipt = await getGhostWalletPimlicoReceipt(chain, work.transactionHash);
    if (!pimlicoReceipt) return null;
    if (!pimlicoReceipt.success) throw new Error('GHOST_WALLET_PIMLICO_USER_OPERATION_REVERTED');
    const provider = ghostWalletEngine.getProvider(chain) || await ghostWalletProviderMesh.getProvider(chain);
    if (!provider) throw new Error('GHOST_WALLET_PIMLICO_RECEIPT_PROVIDER_UNAVAILABLE');
    const receipt = await provider.getTransactionReceipt(pimlicoReceipt.transactionHash);
    if (!receipt) return null;
    if (receipt.status !== 1) throw new Error('GHOST_WALLET_PIMLICO_TRANSACTION_REVERTED');

    const actualBilledGasCostWei = billedGasCostWei(pimlicoReceipt.actualGasCostWei, work.result?.pimlicoSurchargeBps);
    await markGhostWalletWorkSubmitted({
      workId: work.workId,
      owner: this.workerId,
      transactionHash: work.transactionHash,
      leaseMs: 60_000,
      result: {
        pimlicoReceiptTransactionHash: pimlicoReceipt.transactionHash,
        pimlicoActualGasCostWei: pimlicoReceipt.actualGasCostWei?.toString() || null,
        pimlicoActualGasUsed: pimlicoReceipt.actualGasUsed?.toString() || null,
        pimlicoActualBilledGasCostWei: actualBilledGasCostWei?.toString() || null,
        pimlicoRealizedCostAuthority: 'erc4337_receipt_actual_gas_cost_plus_configured_pimlico_surcharge',
      },
    });
    this.submittedPollCounts.delete(work.workId);
    return receipt;
  }

  private nextSubmittedPoll(workId: string): number {
    const next = (this.submittedPollCounts.get(workId) || 0) + 1;
    this.submittedPollCounts.set(workId, next);
    return next;
  }

  private async deferSubmittedReceipt(work: GhostWalletWorkItem, minimumDelayMs = 400): Promise<void> {
    const pollCount = this.nextSubmittedPoll(work.workId);
    const phase = String(work.result?.phase || '');
    const verifyPresence = phase !== 'pimlico_user_operation_broadcast_confirmed'
      || pollCount === 1
      || pollCount % SUBMISSION_PRESENCE_VERIFY_EVERY === 0;
    await this.rebroadcastOrDefer(
      work,
      Math.max(minimumDelayMs, receiptRetryDelayMs(pollCount)),
      verifyPresence,
    );
  }

  private async processMatchedIntent(work: GhostWalletWorkItem): Promise<void> {
    const pair = deserializeMatchedIntentPair(work.payload.pair);
    if (work.claimedFromStatus === 'SUBMITTED' && validHash(work.transactionHash)) {
      if (isPimlicoSubmission(work)) {
        const receipt = await this.pimlicoNetworkReceipt(work, pair.chain as GhostWalletChain);
        if (!receipt) {
          await this.deferSubmittedReceipt(work, 400);
          return;
        }
        const profits = await ingestGhostWalletSettlementReceipt(pair.chain, receipt);
        if (profits <= 0) throw new Error('GHOST_WALLET_SETTLEMENT_EVENT_REQUIRED');
        await markGhostWalletWorkSettled({
          workId: work.workId, owner: this.workerId, transactionHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber, result: { phase: 'matched_intent_pimlico_reconciled', userOperationHash: work.transactionHash, profitJobsEnqueued: profits },
        });
        return;
      }
      // Preserve reconciliation for durable legacy submissions created before Pimlico became mandatory.
      const settlement = await ghostWalletEngine.reconcileSubmittedMatchedPair(pair, work.transactionHash);
      if (!settlement) {
        await this.deferSubmittedReceipt(work, 750);
        return;
      }
      this.submittedPollCounts.delete(work.workId);
      const provider = ghostWalletEngine.getProvider(pair.chain);
      if (!provider) throw new Error('GHOST_WALLET_PROVIDER_UNAVAILABLE');
      const receipt = await provider.getTransactionReceipt(settlement.transactionHash);
      if (!receipt || receipt.status !== 1) throw new Error('GHOST_WALLET_SETTLEMENT_RECEIPT_UNAVAILABLE');
      const profits = await ingestGhostWalletSettlementReceipt(pair.chain, receipt);
      if (profits <= 0) throw new Error('GHOST_WALLET_SETTLEMENT_EVENT_REQUIRED');
      await markGhostWalletWorkSettled({
        workId: work.workId, owner: this.workerId, transactionHash: settlement.transactionHash,
        blockNumber: settlement.blockNumber, result: { phase: 'matched_intent_legacy_reconciled', profitJobsEnqueued: profits },
      });
      return;
    }
    if (!ghostWalletEngine.isLiveExecutionEnabled()) throw new Error('GHOST_WALLET_LIVE_EXECUTION_DISABLED');
    const transaction = ghostWalletEngine.buildCallerFundedMatchedPair(pair);
    await this.submitPreparedTransaction(work, pair.chain as GhostWalletChain, transaction, {
      mode: 'matched_intent',
      matchedIntentProfits: [
        ...(pair.feeAmountA > 0n ? [{ asset: pair.intentA.buyToken, amountBaseUnits: pair.feeAmountA.toString() }] : []),
        ...(pair.feeAmountB > 0n ? [{ asset: pair.intentB.buyToken, amountBaseUnits: pair.feeAmountB.toString() }] : []),
      ],
    });
  }

  private async processProfitConversion(work: GhostWalletWorkItem): Promise<void> {
    const payload = work.payload as unknown as GhostWalletProfitConversionPayload;
    const result = await processGhostWalletProfitConversion({
      payload,
      submittedTransactionHash: work.claimedFromStatus === 'SUBMITTED' && validHash(work.transactionHash) ? work.transactionHash : null,
      priorResult: work.result,
      onSubmitted: async (transactionHash, submittedResult) => {
        await markGhostWalletWorkSubmitted({
          workId: work.workId, owner: this.workerId, transactionHash, leaseMs: 60_000, result: submittedResult,
        });
        this.submittedThisAttempt.add(work.workId);
      },
    });
    if (result.state === 'submitted') {
      const deferred = await deferGhostWalletWork({
        workId: work.workId, owner: this.workerId, error: 'payout_settlement_pending',
        retryAfterMs: result.retryAfterMs, preserveSubmitted: true,
      });
      this.scheduleRetry(work.workId, deferred.notBefore);
      return;
    }
    if (result.followUp) {
      const followUp = await enqueueGhostWalletWork({
        dedupeKey: `${work.dedupeKey}:followup:${result.followUp.asset.toLowerCase()}:${result.followUp.amountBaseUnits}`,
        kind: 'profit_conversion', chain: result.followUp.chain, priority: work.priority + 1,
        maxAttempts: work.maxAttempts, payload: result.followUp as unknown as Record<string, unknown>,
        profitAsset: result.followUp.asset, profitAmountBaseUnits: result.followUp.amountBaseUnits,
      });
      await markGhostWalletWorkSettled({
        workId: work.workId, owner: this.workerId, transactionHash: result.transactionHash,
        blockNumber: result.blockNumber, result: { ...result.result, phase: 'intermediate_conversion_settled', followUpWorkId: followUp.workId },
      });
      ghostWalletWorkSignal.emitWake('local_work_enqueued');
      return;
    }
    await markGhostWalletWorkSettled({
      workId: work.workId, owner: this.workerId, transactionHash: result.transactionHash,
      blockNumber: result.blockNumber, payoutTransactionHash: result.payoutTransactionHash,
      payoutDestinationMode: result.payoutDestinationMode, profitAsset: work.profitAsset || payload.asset,
      profitAmountBaseUnits: work.profitAmountBaseUnits || payload.amountBaseUnits,
      result: { ...result.result, destination: result.destination, ethAmountWei: result.ethAmountWei.toString(), payoutTerminallyVerified: true },
    });
  }

  private async processSourceRefresh(work: GhostWalletWorkItem): Promise<void> {
    await ghostWalletEngine.refresh();
    const quotes = ghostWalletEngine.getMeasuredCapitalQuotes();
    const venues = await syncMeasuredGhostWalletVenues(quotes);
    await markGhostWalletWorkSettled({ workId: work.workId, owner: this.workerId, result: { quotes: quotes.length, venues } });
  }

  private async processVenueProbe(work: GhostWalletWorkItem): Promise<void> {
    const result = await probeGhostWalletVenueCandidate(work.payload);
    await markGhostWalletWorkSettled({ workId: work.workId, owner: this.workerId, result });
    if (result.verified) {
      await enqueueGhostWalletWork({
        dedupeKey: `source-refresh:${result.candidate.chain}:${result.candidate.venueId}:${Date.now()}`,
        kind: 'source_refresh', chain: result.candidate.chain, priority: 200, maxAttempts: 4,
        payload: { reason: 'verified_venue_candidate', venueId: result.candidate.venueId },
      });
      ghostWalletWorkSignal.emitWake('local_work_enqueued');
    }
  }

  private async processPreparedAtomic(work: GhostWalletWorkItem): Promise<void> {
    const mode = String(work.payload.mode || 'broker_execution');
    const chain = payloadChain(work);
    const provider = ghostWalletEngine.getProvider(chain) || await ghostWalletProviderMesh.getProvider(chain);
    if (!provider) throw new Error('GHOST_WALLET_PREPARED_RUNTIME_UNAVAILABLE');

    if (work.claimedFromStatus === 'SUBMITTED' && validHash(work.transactionHash)) {
      const receipt = isPimlicoSubmission(work)
        ? await this.pimlicoNetworkReceipt(work, chain)
        : await provider.getTransactionReceipt(work.transactionHash);
      if (!receipt) {
        await this.deferSubmittedReceipt(work, 400);
        return;
      }
      this.submittedPollCounts.delete(work.workId);
      if (receipt.status !== 1) throw new Error('GHOST_WALLET_PREPARED_SUBMITTED_REVERTED');

      if (mode === 'bridge_bootstrap') {
        const verifyCodeAt = payloadString(work.payload, 'verifyCodeAt');
        if (await provider.getCode(verifyCodeAt) === '0x') throw new Error('GHOST_WALLET_BRIDGE_BOOTSTRAP_CODE_MISMATCH');
        await markGhostWalletWorkSettled({
          workId: work.workId, owner: this.workerId, transactionHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber, result: { phase: 'bridge_bootstrap_verified', userOperationHash: isPimlicoSubmission(work) ? work.transactionHash : null },
        });
        return;
      }

      if (mode === 'bridge_spread_config') {
        const bridge = new Contract(payloadString(work.payload, 'to'), BRIDGE_ABI, provider);
        const actual = Number(await bridge.minimumBrokerSpreadBps());
        const expected = Number(work.payload.verifySpreadBps);
        if (!Number.isFinite(expected) || actual < expected) throw new Error('GHOST_WALLET_BRIDGE_SPREAD_CONFIG_MISMATCH');
        await markGhostWalletWorkSettled({
          workId: work.workId, owner: this.workerId, transactionHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber, result: { phase: 'bridge_spread_config_verified', minimumBrokerSpreadBps: actual, userOperationHash: isPimlicoSubmission(work) ? work.transactionHash : null },
        });
        return;
      }

      const profitJobs = await ingestGhostWalletSettlementReceipt(chain, receipt);
      if (profitJobs <= 0) throw new Error('GHOST_WALLET_SETTLEMENT_EVENT_REQUIRED');
      await markGhostWalletWorkSettled({
        workId: work.workId, owner: this.workerId, transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber, result: { phase: 'autonomous_broker_execution_settled', userOperationHash: isPimlicoSubmission(work) ? work.transactionHash : null, profitJobs },
      });
      return;
    }

    if (!ghostWalletEngine.isLiveExecutionEnabled()) throw new Error('GHOST_WALLET_LIVE_EXECUTION_DISABLED');
    const transaction = {
      to: payloadString(work.payload, 'to'),
      data: payloadString(work.payload, 'data'),
      value: String(work.payload.value || '0'),
    };
    await this.submitPreparedTransaction(work, chain, transaction, { mode });
  }

  private async submitPreparedTransaction(
    work: GhostWalletWorkItem,
    chain: GhostWalletChain,
    transaction: { to: string; data: string; value: string },
    extra: Record<string, unknown>,
  ): Promise<void> {
    const wallet = ghostWalletEngine.getExecutionWallet(chain);
    if (!wallet) throw new Error('GHOST_WALLET_CONTROLLER_WALLET_UNAVAILABLE');
    const provider = await ghostWalletProviderMesh.getProvider(chain) || ghostWalletEngine.getProvider(chain);
    if (!provider) throw new Error('GHOST_WALLET_PIMLICO_EXECUTION_PROVIDER_UNAVAILABLE');

    const finalGateStartedAt = Date.now();
    const prepared = await prepareGhostWalletPimlicoSponsoredTransaction({ chain, provider, wallet, transaction });
    const executionMode = String(extra.mode || work.payload.mode || '');

    if (executionMode === 'broker_execution') {
      const economics = await evaluateGhostWalletControllerEconomics({
        chain,
        provider,
        asset: payloadString(work.payload, 'asset'),
        gasUnits: prepared.billableGasUnitsWithSurcharge,
        feePerGasWei: prepared.billingFeePerGasWei,
        expectedSpreadBaseUnits: BigInt(payloadString(work.payload, 'expectedSpreadBaseUnits')),
      });
      if (!economics.approved) throw new Error('GHOST_WALLET_CONTROLLER_NET_NOT_POSITIVE_AFTER_PIMLICO');
      extra = {
        ...extra,
        finalGasCostAssetBaseUnits: economics.gasCostAssetBaseUnits.toString(),
        finalExpectedNetProfitBaseUnits: economics.expectedNetProfitBaseUnits.toString(),
        finalAssetPriceUsd: economics.assetPriceUsd,
        finalNativePriceUsd: economics.nativePriceUsd,
      };
      recordGhostWalletPerformance({
        stage: 'route_preflight', chain,
        routeKey: `${String(work.payload.sourceKind || 'broker')}:${String(work.payload.lender || '').toLowerCase()}:${String(work.payload.amountBaseUnits || '')}`,
        sourceKind: String(work.payload.sourceKind || 'broker'),
        latencyMs: Date.now() - finalGateStartedAt,
        success: true,
        expectedNetProfitBaseUnits: economics.expectedNetProfitBaseUnits,
      });
      // Last durable authorization check after UserOperation preparation and before persistence/submission.
      await assertGhostWalletMandateStillExecutable(work.payload);
    } else if (executionMode === 'matched_intent') {
      const rawProfits = Array.isArray(extra.matchedIntentProfits) ? extra.matchedIntentProfits : [];
      const profits = rawProfits.flatMap((entry: any) => {
        const asset = String(entry?.asset || '').trim();
        const amount = String(entry?.amountBaseUnits || '').trim();
        if (!ethers.utils.isAddress(asset) || !/^\d+$/.test(amount) || BigInt(amount) <= 0n) return [];
        return [{ asset: ethers.utils.getAddress(asset), amount: BigInt(amount) }];
      });
      if (profits.length === 0) throw new Error('GHOST_WALLET_MATCHED_INTENT_PROFIT_INVALID');
      const economics = await evaluateGhostWalletMultiAssetControllerEconomics({
        chain,
        provider,
        gasUnits: prepared.billableGasUnitsWithSurcharge,
        feePerGasWei: prepared.billingFeePerGasWei,
        profits,
      });
      if (!economics.approved) throw new Error('GHOST_WALLET_CONTROLLER_NET_NOT_POSITIVE_AFTER_PIMLICO');
      extra = {
        ...extra,
        matchedIntentGasCostUsdScaled: economics.gasCostUsdScaled.toString(),
        matchedIntentExpectedProfitUsdScaled: economics.expectedProfitUsdScaled.toString(),
        matchedIntentExpectedNetProfitUsdScaled: economics.expectedNetProfitUsdScaled.toString(),
        matchedIntentProfitAssets: economics.profitAssets.map(item => ({
          asset: item.asset,
          symbol: item.symbol,
          decimals: item.decimals,
          amountBaseUnits: item.amount.toString(),
          valueUsdScaled: item.valueUsdScaled.toString(),
        })),
      };
    }

    const userOperationHash = prepared.userOperationHash;
    await markGhostWalletWorkSubmitted({
      workId: work.workId, owner: this.workerId, transactionHash: userOperationHash, leaseMs: 60_000,
      result: {
        ...extra,
        phase: 'controller_signed_user_operation_before_submission',
        submissionKind: 'pimlico_user_operation',
        pimlicoSubmissionMode: prepared.submissionMode,
        pimlicoUserOperation: prepared.userOperation,
        userOperationHash,
        signer: wallet.address,
        entryPoint: prepared.entryPoint,
        eip7702Implementation: prepared.implementation,
        authorizationIncluded: prepared.authorizationIncluded,
        estimatedUserOperationGasUnits: prepared.estimatedGasUnits.toString(),
        billableGasUnitsWithSurcharge: prepared.billableGasUnitsWithSurcharge.toString(),
        billingFeePerGasWei: prepared.billingFeePerGasWei.toString(),
        userOperationMaxFeePerGasWei: prepared.maxFeePerGasWei.toString(),
        userOperationMaxPriorityFeePerGasWei: prepared.maxPriorityFeePerGasWei.toString(),
        pimlicoSurchargeBps: prepared.surchargeBps,
        pimlicoGasTier: prepared.gasTier,
        chainId: prepared.chainId,
        nativeWalletGasRequired: false,
      },
    });
    this.submittedThisAttempt.add(work.workId);
    this.submittedPollCounts.set(work.workId, 0);

    const broadcastStartedAt = Date.now();
    try {
      const observedHash = await submitGhostWalletPimlicoSponsoredTransaction(prepared);
      if (observedHash.toLowerCase() !== userOperationHash.toLowerCase()) {
        throw new Error('GHOST_WALLET_PIMLICO_USER_OPERATION_HASH_MISMATCH');
      }
      await markGhostWalletWorkSubmitted({
        workId: work.workId,
        owner: this.workerId,
        transactionHash: userOperationHash,
        leaseMs: 60_000,
        result: {
          phase: 'pimlico_user_operation_broadcast_confirmed',
          pimlicoBroadcastConfirmedAt: Date.now(),
        },
      });
      recordGhostWalletPerformance({
        stage: 'transaction_broadcast', chain,
        routeKey: userOperationHash,
        sourceKind: `pimlico:${prepared.submissionMode}:${String(work.payload.sourceKind || executionMode || 'prepared')}`,
        latencyMs: Date.now() - broadcastStartedAt,
        success: true,
        expectedNetProfitBaseUnits: executionMode === 'broker_execution'
          ? String((extra as any).finalExpectedNetProfitBaseUnits || '')
          : null,
      });
    } catch (error) {
      recordGhostWalletPerformance({
        stage: 'transaction_broadcast', chain, routeKey: userOperationHash,
        latencyMs: Date.now() - broadcastStartedAt, success: false,
        errorType: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const deferred = await deferGhostWalletWork({
      workId: work.workId, owner: this.workerId, error: 'pimlico_user_operation_submitted',
      retryAfterMs: receiptRetryDelayMs(1), preserveSubmitted: true,
    });
    this.scheduleRetry(work.workId, deferred.notBefore);
  }

  private async rebroadcastOrDefer(work: GhostWalletWorkItem, retryAfterMs: number, verifyPresence = true): Promise<void> {
    const chain = payloadChain(work);
    if (verifyPresence && isPimlicoSubmission(work) && work.transactionHash) {
      await ensureGhostWalletPimlicoSubmission({
        chain,
        userOperationHash: work.transactionHash,
        userOperation: work.result!.pimlicoUserOperation as GhostWalletPimlicoRpcUserOperation,
      });
    } else if (verifyPresence && !isPimlicoSubmission(work)) {
      // Durable compatibility only for submissions created before Pimlico became mandatory.
      const provider = ghostWalletEngine.getProvider(chain);
      if (!provider) throw new Error('GHOST_WALLET_REBROADCAST_PROVIDER_UNAVAILABLE');
      const raw = work.result?.rawTransaction;
      if (validRawTransaction(raw)) {
        const observed = await provider.getTransaction(work.transactionHash || '').catch(() => null);
        if (!observed) await ghostWalletProviderMesh.broadcastRawTransaction(chain, raw);
      }
    }
    const deferred = await deferGhostWalletWork({
      workId: work.workId, owner: this.workerId, error: 'receipt_pending', retryAfterMs, preserveSubmitted: true,
    });
    this.scheduleRetry(work.workId, deferred.notBefore);
  }

  private async processSettlementReconcile(work: GhostWalletWorkItem): Promise<void> {
    const transactionHash = String(work.payload.transactionHash || work.transactionHash || '');
    const chain = String(work.payload.chain || work.chain).trim().toLowerCase();
    if (!validHash(transactionHash)) throw new Error('GHOST_WALLET_RECONCILE_TRANSACTION_INVALID');
    const provider = ghostWalletEngine.getProvider(chain);
    if (!provider) throw new Error('GHOST_WALLET_RECONCILE_PROVIDER_UNAVAILABLE');
    const receipt = await provider.getTransactionReceipt(transactionHash);
    if (!receipt) {
      const deferred = await deferGhostWalletWork({
        workId: work.workId, owner: this.workerId, error: 'receipt_pending', retryAfterMs: 1_000, preserveSubmitted: false,
      });
      this.scheduleRetry(work.workId, deferred.notBefore);
      return;
    }
    if (receipt.status !== 1) throw new Error('GHOST_WALLET_RECONCILE_TRANSACTION_REVERTED');
    const profitJobs = await ingestGhostWalletSettlementReceipt(chain, receipt);
    if (profitJobs <= 0) throw new Error('GHOST_WALLET_SETTLEMENT_EVENT_REQUIRED');
    await markGhostWalletWorkSettled({
      workId: work.workId, owner: this.workerId, transactionHash,
      blockNumber: receipt.blockNumber, result: { profitJobs },
    });
  }

  private scheduleRetry(workId: string, notBefore: number): void {
    const existing = this.retryTimers.get(workId);
    if (existing) clearTimeout(existing);
    const delay = Math.max(25, notBefore - Date.now());
    const timer = setTimeout(() => {
      this.retryTimers.delete(workId);
      this.requestDrain('retry_due');
    }, delay);
    timer.unref?.();
    this.retryTimers.set(workId, timer);
  }

  private async scheduleNextDurableDue(): Promise<void> {
    if (!this.running) return;
    const result = await pool.query(
      `SELECT min(GREATEST(not_before,COALESCE(lease_until,not_before))) AS next_due
       FROM private.cryptocrawler_ghost_wallet_work
       WHERE status IN ('QUEUED','RETRYABLE','SUBMITTED')`,
    );
    const raw = result.rows[0]?.next_due;
    if (!raw) return;
    const due = new Date(String(raw)).getTime();
    if (!Number.isFinite(due)) return;
    if (this.nextDueTimer) clearTimeout(this.nextDueTimer);
    const delay = Math.max(25, due - Date.now());
    this.nextDueTimer = setTimeout(() => {
      this.nextDueTimer = null;
      this.requestDrain('retry_due');
    }, delay);
    this.nextDueTimer.unref?.();
  }
}

export const ghostWalletUltraWorker = new GhostWalletUltraWorker();
