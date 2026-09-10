import os from 'node:os';
import pg from 'pg';
import logger from '../../../logger.js';
import { ensureCryptocrawlOverflowRuntimeSchema } from '../runtime/cryptocrawl-overflow-runtime-schema.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import { ghostWalletChainEvents } from './ghost-wallet-chain-events.js';
import { ghostWalletEngine } from './ghost-wallet-engine.js';
import { processGhostWalletProfitConversion, type GhostWalletProfitConversionPayload } from './ghost-wallet-payout.js';
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
    ? {
        rejectUnauthorized: false,
        ...(process.env.DATABASE_SSL_CERT ? { ca: process.env.DATABASE_SSL_CERT } : {}),
      }
    : false;
}

function parallelCapacity(): number {
  return Math.max(1, os.availableParallelism?.() || os.cpus().length || 1);
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function retryDelayMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(8, attempt - 1));
  return Math.min(30_000, 250 * (2 ** exponent));
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

/**
 * Legacy compatibility export. Ghost no longer originates arbitrary prepared
 * transactions from the server because that path depended on operator/provider
 * sponsorship. New lending execution is caller-funded through the public bridge.
 */
export async function enqueueGhostWalletPreparedAtomicExecution(): Promise<string> {
  throw new Error('GHOST_WALLET_CALLER_FUNDED_SUBMISSION_REQUIRED');
}

class GhostWalletUltraWorker {
  private running = false;
  private listener: InstanceType<typeof Client> | null = null;
  private listenerReconnectTimer: NodeJS.Timeout | null = null;
  private nextDueTimer: NodeJS.Timeout | null = null;
  private readonly retryTimers = new Map<string, NodeJS.Timeout>();
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
      this.requestDrain('startup_backlog');
      logger.info('[GhostWalletUltra] Dedicated event-driven Ultra Worker started', {
        component: 'GhostWalletUltraWorker',
        workerId: this.workerId,
        periodicWorkPolling: false,
        wakeSources: ['postgres_notify', 'local_enqueue', 'chain_settlement_websocket', 'startup_backlog', 'per_job_retry'],
        persistenceAuthority: 'overflow_private_cryptocrawler_ghost_wallet_work',
        parallelCapacity: parallelCapacity(),
        concurrencyPolicy: 'independent_lanes_parallel',
        coreBorrowerExecutionPayer: 'caller',
        serverBorrowTransactionSubmission: false,
        providerSponsoredExecution: false,
        alchemyDependency: false,
        profitLadderAuthority: false,
        arbitrageExecutionAuthority: false,
        arbitrageTreasuryAuthority: false,
      });
    } catch (error) {
      await this.stop().catch(() => undefined);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.unsubscribeLocalWake?.();
    this.unsubscribeLocalWake = null;
    ghostWalletChainEvents.stop();
    if (this.listenerReconnectTimer) clearTimeout(this.listenerReconnectTimer);
    this.listenerReconnectTimer = null;
    if (this.nextDueTimer) clearTimeout(this.nextDueTimer);
    this.nextDueTimer = null;
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
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
      this.requestDrain('postgres_notify');
    });
    await client.connect();
    await client.query(`LISTEN ${LISTEN_CHANNEL}`);
    this.listener = client;
    await recordGhostWalletRuntimeState({
      chain: 'global', listenerConnected: true, metadata: { eventDriven: true, alchemyDependency: false },
    });
    this.requestDrain('listener_reconnected');
  }

  private scheduleListenerReconnect(reason: unknown): void {
    if (!this.running || this.listenerReconnectTimer) return;
    logger.warn('[GhostWalletUltra] Overflow listener disconnected; durable backlog preserved', {
      component: 'GhostWalletUltraWorker',
      error: reason instanceof Error ? reason.message : String(reason),
      workPollingFallbackEnabled: false,
      reconnectDelayMs: 2_000,
    });
    this.listenerReconnectTimer = setTimeout(() => {
      this.listenerReconnectTimer = null;
      void this.connectListener().catch(error => this.scheduleListenerReconnect(error));
    }, 2_000);
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
    if (work.kind === 'profit_conversion') return `payout:${String(work.payload.chain || work.chain).toLowerCase()}`;
    if (work.kind === 'matched_intent_settlement' || work.kind === 'prepared_atomic_execution') return `reconcile:${work.chain}`;
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
      const deterministic = /INVALID|EXPIRED|NOT_POSITIVE|MISMATCH|REVERTED|UNSUPPORTED|TERMINAL_FAILURE|SETTLEMENT_EVENT_REQUIRED|CALLER_FUNDED_SUBMISSION_REQUIRED/.test(message);
      if (deterministic) {
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
    }
  }

  private async processMatchedIntent(work: GhostWalletWorkItem): Promise<void> {
    const pair = deserializeMatchedIntentPair(work.payload.pair);
    if (!(work.claimedFromStatus === 'SUBMITTED' && validHash(work.transactionHash))) {
      throw new Error('GHOST_WALLET_CALLER_FUNDED_SUBMISSION_REQUIRED');
    }
    const settlement = await ghostWalletEngine.reconcileSubmittedMatchedPair(pair, work.transactionHash);
    if (!settlement) {
      const deferred = await deferGhostWalletWork({
        workId: work.workId, owner: this.workerId, error: 'receipt_pending', retryAfterMs: 1_000, preserveSubmitted: true,
      });
      this.scheduleRetry(work.workId, deferred.notBefore);
      return;
    }
    const provider = ghostWalletEngine.getProvider(pair.chain);
    if (!provider) throw new Error('GHOST_WALLET_PROVIDER_UNAVAILABLE');
    const receipt = await provider.getTransactionReceipt(settlement.transactionHash);
    if (!receipt || receipt.status !== 1) throw new Error('GHOST_WALLET_SETTLEMENT_RECEIPT_UNAVAILABLE');
    const profits = await ingestGhostWalletSettlementReceipt(pair.chain, receipt);
    if (profits <= 0) throw new Error('GHOST_WALLET_SETTLEMENT_EVENT_REQUIRED');
    await markGhostWalletWorkSettled({
      workId: work.workId,
      owner: this.workerId,
      transactionHash: settlement.transactionHash,
      blockNumber: settlement.blockNumber,
      result: { phase: 'matched_intent_reconciled', profitJobsEnqueued: profits },
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
          workId: work.workId,
          owner: this.workerId,
          transactionHash,
          leaseMs: 60_000,
          result: submittedResult,
        });
        this.submittedThisAttempt.add(work.workId);
      },
    });

    if (result.state === 'submitted') {
      const deferred = await deferGhostWalletWork({
        workId: work.workId,
        owner: this.workerId,
        error: 'payout_settlement_pending',
        retryAfterMs: result.retryAfterMs,
        preserveSubmitted: true,
      });
      this.scheduleRetry(work.workId, deferred.notBefore);
      return;
    }

    if (result.followUp) {
      const followUp = await enqueueGhostWalletWork({
        dedupeKey: `${work.dedupeKey}:followup:${result.followUp.asset.toLowerCase()}:${result.followUp.amountBaseUnits}`,
        kind: 'profit_conversion',
        chain: result.followUp.chain,
        priority: work.priority + 1,
        maxAttempts: work.maxAttempts,
        payload: result.followUp as unknown as Record<string, unknown>,
        profitAsset: result.followUp.asset,
        profitAmountBaseUnits: result.followUp.amountBaseUnits,
      });
      await markGhostWalletWorkSettled({
        workId: work.workId,
        owner: this.workerId,
        transactionHash: result.transactionHash,
        blockNumber: result.blockNumber,
        result: { ...result.result, phase: 'intermediate_conversion_settled', followUpWorkId: followUp.workId },
      });
      ghostWalletWorkSignal.emitWake('local_work_enqueued');
      return;
    }

    await markGhostWalletWorkSettled({
      workId: work.workId,
      owner: this.workerId,
      transactionHash: result.transactionHash,
      blockNumber: result.blockNumber,
      payoutTransactionHash: result.payoutTransactionHash,
      payoutDestinationMode: result.payoutDestinationMode,
      profitAsset: work.profitAsset || payload.asset,
      profitAmountBaseUnits: work.profitAmountBaseUnits || payload.amountBaseUnits,
      result: {
        ...result.result,
        destination: result.destination,
        ethAmountWei: result.ethAmountWei.toString(),
        payoutTerminallyVerified: true,
      },
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
        kind: 'source_refresh',
        chain: result.candidate.chain,
        priority: 200,
        maxAttempts: 4,
        payload: { reason: 'verified_venue_candidate', venueId: result.candidate.venueId },
      });
      ghostWalletWorkSignal.emitWake('local_work_enqueued');
    }
  }

  private async processPreparedAtomic(work: GhostWalletWorkItem): Promise<void> {
    if (!(work.claimedFromStatus === 'SUBMITTED' && validHash(work.transactionHash))) {
      throw new Error('GHOST_WALLET_CALLER_FUNDED_SUBMISSION_REQUIRED');
    }
    const chain = String(work.payload.chain || work.chain).trim().toLowerCase();
    const provider = ghostWalletEngine.getProvider(chain);
    if (!provider) throw new Error('GHOST_WALLET_PREPARED_RUNTIME_UNAVAILABLE');
    const receipt = await provider.getTransactionReceipt(work.transactionHash);
    if (!receipt) {
      const deferred = await deferGhostWalletWork({
        workId: work.workId, owner: this.workerId, error: 'receipt_pending', retryAfterMs: 1_000, preserveSubmitted: true,
      });
      this.scheduleRetry(work.workId, deferred.notBefore);
      return;
    }
    if (receipt.status !== 1) throw new Error('GHOST_WALLET_PREPARED_SUBMITTED_REVERTED');
    const profitJobs = await ingestGhostWalletSettlementReceipt(chain, receipt);
    if (profitJobs <= 0) throw new Error('GHOST_WALLET_SETTLEMENT_EVENT_REQUIRED');
    await markGhostWalletWorkSettled({
      workId: work.workId,
      owner: this.workerId,
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      result: { phase: 'legacy_prepared_reconciled', profitJobs },
    });
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
      workId: work.workId,
      owner: this.workerId,
      transactionHash,
      blockNumber: receipt.blockNumber,
      result: { profitJobs },
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
