import { pool } from '../../../db.js';
import logger from '../../../logger.js';
import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
import type { DurableTerminalOutcome } from './canonical-intelligence-repository.js';

const OUTBOX_SCHEMA_VERSION = 'cryptara-outbox-v1';
const TERMINAL_JOB_KIND = 'persist_terminal_outcome';

export type IntelligenceOutboxStatus = 'pending' | 'processing' | 'retry' | 'completed' | 'failed';

interface TerminalOutcomeOutboxPayload {
  version: 1;
  outcome: DurableTerminalOutcome;
  feedback: CryptaraExecutionFeedback;
}

interface ClaimedOutboxRow {
  outboxId: string;
  sourceEventId: string;
  jobKind: string;
  schemaVersion: string;
  attemptCount: number;
  payload: unknown;
}

export interface IntelligenceOutboxMetrics {
  running: boolean;
  pending: number;
  processing: number;
  retry: number;
  completed: number;
  failed: number;
  ready: number;
  oldestReadyAgeMs: number | null;
  lastClaimAt: number | null;
  lastCompletedAt: number | null;
  lastMetricsAt: number | null;
  lastError: string | null;
  authority: 'background_persistence_only';
  executionDependency: false;
}

function deterministicOutboxId(sourceEventId: string): string {
  return `terminal:${sourceEventId}:${OUTBOX_SCHEMA_VERSION}`;
}

function terminalPayload(value: unknown): value is TerminalOutcomeOutboxPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<TerminalOutcomeOutboxPayload>;
  if (payload.version !== 1 || !payload.outcome || !payload.feedback) return false;
  const outcome = payload.outcome as Partial<DurableTerminalOutcome>;
  const feedback = payload.feedback as Partial<CryptaraExecutionFeedback>;
  return typeof outcome.eventId === 'string'
    && outcome.eventId.length > 0
    && outcome.terminal === true
    && Array.isArray(outcome.sourceEventIds)
    && outcome.sourceEventIds.includes(outcome.eventId)
    && typeof outcome.opportunityId === 'string'
    && typeof outcome.symbol === 'string'
    && typeof outcome.chain === 'string'
    && typeof outcome.strategy === 'string'
    && feedback.settlement?.terminal === true;
}

class CanonicalIntelligenceOutbox {
  private timer: NodeJS.Timeout | null = null;
  private cycleInFlight: Promise<void> | null = null;
  private consecutiveCycleFailures = 0;
  private degradedUntil = 0;
  private metrics: IntelligenceOutboxMetrics = {
    running: false,
    pending: 0,
    processing: 0,
    retry: 0,
    completed: 0,
    failed: 0,
    ready: 0,
    oldestReadyAgeMs: null,
    lastClaimAt: null,
    lastCompletedAt: null,
    lastMetricsAt: null,
    lastError: null,
    authority: 'background_persistence_only',
    executionDependency: false,
  };

  start(): void {
    if (this.timer) return;
    const intervalMs = Math.max(500, Number(process.env.CRYPTARA_OUTBOX_POLL_MS || 2_000));
    this.metrics.running = true;
    void this.runCycle();
    this.timer = setInterval(() => void this.runCycle(), intervalMs);
    this.timer.unref?.();
    logger.info('[IntelligenceOutbox] Restart-safe background worker started', {
      component: 'CanonicalIntelligenceOutbox',
      intervalMs,
      authority: this.metrics.authority,
      executionDependency: false,
      durableDedupe: true,
      staleLeaseRecovery: true,
      databaseFailureBackoff: 'bounded_exponential',
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.metrics.running = false;
  }

  async enqueueTerminalOutcome(
    outcome: DurableTerminalOutcome,
    feedback: CryptaraExecutionFeedback,
  ): Promise<boolean> {
    if (!outcome.eventId.trim()) throw new Error('Durable outbox requires a deterministic source event id');
    if (outcome.terminal !== true || feedback.settlement?.terminal !== true) {
      throw new Error('Durable outbox accepts terminal execution evidence only');
    }
    if (!outcome.sourceEventIds.includes(outcome.eventId)) {
      throw new Error('Durable outbox terminal outcome must retain its source event identity');
    }

    const outboxId = deterministicOutboxId(outcome.eventId);
    const payload: TerminalOutcomeOutboxPayload = {
      version: 1,
      outcome: {
        ...outcome,
        provenance: [...outcome.provenance],
        sourceEventIds: [...outcome.sourceEventIds],
      },
      feedback: structuredClone(feedback),
    };
    const result = await pool.query(
      `insert into private.cryptara_outbox (
         outbox_id, source_event_id, job_kind, schema_version, dedupe_key, status,
         attempt_count, visible_at, payload
       ) values ($1, $2, $3, $4, $5, 'pending', 0, now(), $6::jsonb)
       on conflict (dedupe_key) do nothing
       returning outbox_id`,
      [
        outboxId,
        outcome.eventId,
        TERMINAL_JOB_KIND,
        OUTBOX_SCHEMA_VERSION,
        outboxId,
        JSON.stringify(payload),
      ],
    );
    if ((result.rowCount || 0) > 0) return true;

    // A duplicate enqueue is also durable success when the exact immutable event
    // is already present. Do not mistake idempotency for a failed handoff.
    const existing = await pool.query(
      `select 1
         from private.cryptara_outbox
        where dedupe_key = $1
          and source_event_id = $2
          and job_kind = $3
          and schema_version = $4
        limit 1`,
      [outboxId, outcome.eventId, TERMINAL_JOB_KIND, OUTBOX_SCHEMA_VERSION],
    );
    return (existing.rowCount || 0) > 0;
  }

  getMetrics(): IntelligenceOutboxMetrics {
    return { ...this.metrics };
  }

  async refreshMetrics(): Promise<IntelligenceOutboxMetrics> {
    try {
      const result = await pool.query(
        `select
           count(*) filter (where status = 'pending')::int as pending,
           count(*) filter (where status = 'processing')::int as processing,
           count(*) filter (where status = 'retry')::int as retry,
           count(*) filter (where status = 'completed')::int as completed,
           count(*) filter (where status = 'failed')::int as failed,
           count(*) filter (where status in ('pending','retry') and visible_at <= now())::int as ready,
           extract(epoch from (now() - min(created_at) filter (
             where status in ('pending','retry') and visible_at <= now()
           ))) * 1000 as oldest_ready_age_ms
         from private.cryptara_outbox`,
      );
      const row = result.rows[0] || {};
      this.metrics = {
        ...this.metrics,
        pending: Number(row.pending || 0),
        processing: Number(row.processing || 0),
        retry: Number(row.retry || 0),
        completed: Number(row.completed || 0),
        failed: Number(row.failed || 0),
        ready: Number(row.ready || 0),
        oldestReadyAgeMs: row.oldest_ready_age_ms === null || row.oldest_ready_age_ms === undefined
          ? null
          : Number(row.oldest_ready_age_ms),
        lastMetricsAt: Date.now(),
        lastError: null,
      };
    } catch (error) {
      this.metrics.lastError = error instanceof Error ? error.message : String(error);
      this.metrics.lastMetricsAt = Date.now();
    }
    return this.getMetrics();
  }

  private databaseBackoffMs(): number {
    const baseMs = Math.max(1_000, Number(process.env.CRYPTARA_OUTBOX_DB_BACKOFF_BASE_MS || 2_000));
    const maxMs = Math.max(baseMs, Number(process.env.CRYPTARA_OUTBOX_DB_BACKOFF_MAX_MS || 60_000));
    return Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, this.consecutiveCycleFailures - 1)));
  }

  private runCycle(): Promise<void> {
    if (Date.now() < this.degradedUntil) return Promise.resolve();
    if (this.cycleInFlight) return this.cycleInFlight;
    this.cycleInFlight = this.drainCycle().finally(() => {
      this.cycleInFlight = null;
    });
    return this.cycleInFlight;
  }

  private async drainCycle(): Promise<void> {
    const batchSize = Math.max(1, Math.min(32, Number(process.env.CRYPTARA_OUTBOX_BATCH_SIZE || 8)));
    try {
      for (let index = 0; index < batchSize; index++) {
        const row = await this.claimOne();
        if (!row) break;
        await this.process(row);
      }
      const metrics = await this.refreshMetrics();
      if (metrics.lastError) throw new Error(metrics.lastError);
      this.consecutiveCycleFailures = 0;
      this.degradedUntil = 0;
    } catch (error) {
      this.metrics.lastError = error instanceof Error ? error.message : String(error);
      this.consecutiveCycleFailures += 1;
      const backoffMs = this.databaseBackoffMs();
      this.degradedUntil = Date.now() + backoffMs;
      logger.warn('[IntelligenceOutbox] Background queue cycle degraded; canonical execution remains independent', {
        component: 'CanonicalIntelligenceOutbox',
        error: this.metrics.lastError,
        executionBlocked: false,
        consecutiveCycleFailures: this.consecutiveCycleFailures,
        databaseRetryInMs: backoffMs,
      });
    }
  }

  private async claimOne(): Promise<ClaimedOutboxRow | null> {
    const leaseMs = Math.max(5_000, Number(process.env.CRYPTARA_OUTBOX_LEASE_MS || 30_000));
    const result = await pool.query(
      `with candidate as (
         select outbox_id
           from private.cryptara_outbox
          where (
            status in ('pending','retry') and visible_at <= now()
          ) or (
            status = 'processing'
            and locked_at is not null
            and locked_at <= now() - ($1::double precision * interval '1 millisecond')
          )
          order by created_at asc
          for update skip locked
          limit 1
       )
       update private.cryptara_outbox as outbox
          set status = 'processing',
              locked_at = now(),
              attempt_count = outbox.attempt_count + 1,
              last_error = null
         from candidate
        where outbox.outbox_id = candidate.outbox_id
       returning outbox.outbox_id, outbox.source_event_id, outbox.job_kind,
                 outbox.schema_version, outbox.attempt_count, outbox.payload`,
      [leaseMs],
    );
    if ((result.rowCount || 0) === 0) return null;
    const row = result.rows[0];
    this.metrics.lastClaimAt = Date.now();
    return {
      outboxId: String(row.outbox_id),
      sourceEventId: String(row.source_event_id),
      jobKind: String(row.job_kind),
      schemaVersion: String(row.schema_version),
      attemptCount: Number(row.attempt_count),
      payload: row.payload,
    };
  }

  private async process(row: ClaimedOutboxRow): Promise<void> {
    try {
      if (row.schemaVersion !== OUTBOX_SCHEMA_VERSION) {
        throw new Error(`Unsupported durable outbox schema version: ${row.schemaVersion}`);
      }
      if (row.jobKind !== TERMINAL_JOB_KIND) {
        throw new Error(`Unsupported durable outbox job kind: ${row.jobKind}`);
      }
      if (!terminalPayload(row.payload)) {
        throw new Error('Durable terminal-outcome payload failed truth validation');
      }
      if (row.payload.outcome.eventId !== row.sourceEventId) {
        throw new Error('Durable outbox source event does not match terminal outcome identity');
      }

      await this.persistTerminalOutcome(row.payload);
      await pool.query(
        `update private.cryptara_outbox
            set status = 'completed', completed_at = now(), locked_at = null, last_error = null
          where outbox_id = $1 and status = 'processing'`,
        [row.outboxId],
      );
      this.metrics.lastCompletedAt = Date.now();
      this.metrics.lastError = null;
    } catch (error) {
      await this.failOrRetry(row, error);
    }
  }

  private async persistTerminalOutcome(payload: TerminalOutcomeOutboxPayload): Promise<void> {
    const { outcome, feedback } = payload;
    await pool.query(
      `insert into private.cryptara_trade_outcomes (
         event_id, opportunity_id, observed_at, settled_at, topology, symbol, chain, strategy,
         success, terminal, settlement_confirmed, realized_profit_usd, realized_fee_usd,
         realized_slippage_bps, latency_ms, model_version, config_version, provenance,
         source_event_ids, payload
       ) values (
         $1, $2, to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0), $5, $6, $7, $8,
         $9, true, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb
       ) on conflict (event_id) do nothing`,
      [
        outcome.eventId,
        outcome.opportunityId,
        outcome.observedAt,
        outcome.settledAt,
        outcome.topology,
        outcome.symbol,
        outcome.chain,
        outcome.strategy,
        outcome.success,
        outcome.settlementConfirmed,
        outcome.realizedProfitUsd,
        outcome.realizedFeeUsd,
        outcome.realizedSlippageBps,
        outcome.latencyMs,
        outcome.modelVersion,
        outcome.configVersion,
        outcome.provenance,
        outcome.sourceEventIds,
        JSON.stringify({ feedback, terminalEventId: outcome.eventId, outboxSchemaVersion: OUTBOX_SCHEMA_VERSION }),
      ],
    );
  }

  private async failOrRetry(row: ClaimedOutboxRow, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const maxAttempts = Math.max(1, Math.min(32, Number(process.env.CRYPTARA_OUTBOX_MAX_ATTEMPTS || 8)));
    const baseBackoffMs = Math.max(250, Number(process.env.CRYPTARA_OUTBOX_RETRY_BASE_MS || 1_000));
    const maxBackoffMs = Math.max(baseBackoffMs, Number(process.env.CRYPTARA_OUTBOX_RETRY_MAX_MS || 60_000));
    const exhausted = row.attemptCount >= maxAttempts;
    const backoffMs = Math.min(maxBackoffMs, baseBackoffMs * Math.pow(2, Math.max(0, row.attemptCount - 1)));

    await pool.query(
      `update private.cryptara_outbox
          set status = $2,
              visible_at = case when $2 = 'retry'
                then now() + ($3::double precision * interval '1 millisecond')
                else visible_at
              end,
              locked_at = null,
              last_error = $4,
              completed_at = case when $2 = 'failed' then now() else completed_at end
        where outbox_id = $1 and status = 'processing'`,
      [row.outboxId, exhausted ? 'failed' : 'retry', backoffMs, message.slice(0, 2_000)],
    );
    this.metrics.lastError = message;
    logger.warn('[IntelligenceOutbox] Background job did not complete', {
      component: 'CanonicalIntelligenceOutbox',
      outboxId: row.outboxId,
      sourceEventId: row.sourceEventId,
      jobKind: row.jobKind,
      attemptCount: row.attemptCount,
      maxAttempts,
      status: exhausted ? 'failed' : 'retry',
      retryInMs: exhausted ? null : backoffMs,
      error: message,
      executionBlocked: false,
    });
  }
}

export const canonicalIntelligenceOutbox = new CanonicalIntelligenceOutbox();

export function ensureCanonicalIntelligenceOutbox(): CanonicalIntelligenceOutbox {
  canonicalIntelligenceOutbox.start();
  return canonicalIntelligenceOutbox;
}
