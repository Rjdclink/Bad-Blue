import { pool } from '../../../db.js';
import logger from '../../../logger.js';
import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { withCryptaraSupabasePriority } from '../integration/cryptara-supabase-admission-worker.js';
import {
  getCryptaraSupabaseCompSwitchSnapshot,
  refreshCryptaraSupabaseCompSwitch,
} from '../integration/cryptara-supabase-comp-switch.js';
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
  dataPath: 'normal' | 'comp';
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

function boundedMs(raw: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(raw);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function jitterMs(baseMs: number): number {
  const floor = Math.max(50, Math.floor(baseMs * 0.50));
  return floor + Math.floor(Math.random() * Math.max(1, baseMs - floor + 1));
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
  private cycleInFlight: Promise<number> | null = null;
  private kickPending = false;
  private consecutiveCycleFailures = 0;
  private degradedUntil = 0;
  private idleDelayMs = 0;
  private lastMetricsRefreshAt = 0;
  private metrics: IntelligenceOutboxMetrics = {
    running: false,
    dataPath: 'normal',
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

  private batchSize(): number {
    return Math.max(1, Math.min(32, Number(process.env.CRYPTARA_OUTBOX_BATCH_SIZE || 8)));
  }

  private activePollMs(): number {
    const baseMs = boundedMs(process.env.CRYPTARA_OUTBOX_POLL_MS, 2_000, 250, 30_000);
    const policy = getCryptaraSupabaseCompSwitchSnapshot().policy;
    return Math.min(30_000, Math.max(baseMs, Math.floor(baseMs * policy.backgroundPollMultiplier)));
  }

  private maxIdlePollMs(): number {
    const baseMs = boundedMs(process.env.CRYPTARA_OUTBOX_IDLE_POLL_MAX_MS, 30_000, this.activePollMs(), 300_000);
    const policy = getCryptaraSupabaseCompSwitchSnapshot().policy;
    return Math.min(300_000, Math.max(baseMs, Math.floor(baseMs * policy.backgroundPollMultiplier)));
  }

  private metricsIntervalMs(): number {
    const baseMs = boundedMs(process.env.CRYPTARA_OUTBOX_METRICS_INTERVAL_MS, 30_000, 5_000, 300_000);
    const policy = getCryptaraSupabaseCompSwitchSnapshot().policy;
    return Math.min(300_000, Math.max(baseMs, Math.floor(baseMs * policy.observabilityMultiplier)));
  }

  start(): void {
    if (this.metrics.running) return;
    this.metrics.running = true;
    this.metrics.dataPath = getCryptaraSupabaseCompSwitchSnapshot().path;
    this.idleDelayMs = this.activePollMs();
    this.kickPending = false;
    this.schedule(0);
    logger.info('[IntelligenceOutbox] Restart-safe adaptive background worker started', {
      component: 'CanonicalIntelligenceOutbox',
      activePollMs: this.activePollMs(),
      maxIdlePollMs: this.maxIdlePollMs(),
      metricsIntervalMs: this.metricsIntervalMs(),
      dataPath: this.metrics.dataPath,
      authority: this.metrics.authority,
      executionDependency: false,
      durableDedupe: true,
      staleLeaseRecovery: true,
      batchedClaims: true,
      atomicPersistAndComplete: true,
      idlePolling: 'adaptive_one_shot',
      databaseFailureBackoff: 'bounded_exponential_jitter',
    });
  }

  stop(): void {
    this.metrics.running = false;
    this.kickPending = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number): void {
    if (!this.metrics.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runScheduledCycle();
    }, Math.max(0, delayMs));
    this.timer.unref?.();
  }

  private kick(): void {
    if (!this.metrics.running) return;
    // New terminal truth is never deferred by comp mode. Wake immediately; the
    // DB admission governor still controls how many scarce DB permits it receives.
    this.idleDelayMs = this.activePollMs();
    this.kickPending = true;
    if (this.cycleInFlight) return;
    this.kickPending = false;
    this.schedule(0);
  }

  private async runScheduledCycle(): Promise<void> {
    // Refresh only from already-measured admission telemetry. This call performs no
    // database query; it selects normal vs comp policy for the upcoming cycle.
    try {
      const switchSnapshot = await refreshCryptaraSupabaseCompSwitch();
      this.metrics.dataPath = switchSnapshot.path;
    } catch {
      this.metrics.dataPath = getCryptaraSupabaseCompSwitchSnapshot().path;
    }

    // Any wake that scheduled this cycle is now being consumed. If another event
    // arrives while the drain is active, kick() sets this flag again and the
    // post-drain check below immediately schedules another pass.
    this.kickPending = false;
    const now = Date.now();
    if (now < this.degradedUntil) {
      this.schedule(Math.max(1, this.degradedUntil - now));
      return;
    }

    const processed = await this.runCycle();
    if (!this.metrics.running) return;

    if (this.kickPending) {
      this.kickPending = false;
      this.idleDelayMs = this.activePollMs();
      this.schedule(0);
      return;
    }

    if (this.degradedUntil > Date.now()) {
      this.schedule(Math.max(1, this.degradedUntil - Date.now()));
      return;
    }

    if (processed > 0) {
      // Work was present: reset to the fast lane. If a complete batch was drained,
      // run again immediately so throughput is not reduced while backlog exists.
      this.idleDelayMs = this.activePollMs();
      const batchSize = this.batchSize();
      this.schedule(processed >= batchSize ? 0 : this.activePollMs());
      return;
    }

    // No ready durable work: exponentially reduce empty SELECT traffic until the
    // bounded idle ceiling. New terminal evidence calls kick(), so active work is
    // never forced to wait for the idle backoff to expire.
    this.idleDelayMs = Math.min(
      this.maxIdlePollMs(),
      Math.max(this.activePollMs(), this.idleDelayMs > 0 ? this.idleDelayMs * 2 : this.activePollMs()),
    );
    this.schedule(jitterMs(this.idleDelayMs));
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
    const result = await withCryptaraSupabasePriority('high', () => pool.query(
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
    ));
    if ((result.rowCount || 0) > 0) {
      this.kick();
      return true;
    }

    // A collision on this private deterministic key can only represent the same
    // source event + schema version generated above. Idempotency is durable success;
    // avoid paying a second SELECT merely to rediscover the unique-row guarantee.
    this.kick();
    return true;
  }

  getMetrics(): IntelligenceOutboxMetrics {
    return { ...this.metrics };
  }

  async refreshMetrics(): Promise<IntelligenceOutboxMetrics> {
    try {
      const result = await withCryptaraSupabasePriority('low', () => pool.query(
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
      ));
      const row = result.rows[0] || {};
      this.metrics = {
        ...this.metrics,
        dataPath: getCryptaraSupabaseCompSwitchSnapshot().path,
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
      this.lastMetricsRefreshAt = Date.now();
    } catch (error) {
      this.metrics.lastError = error instanceof Error ? error.message : String(error);
      this.metrics.lastMetricsAt = Date.now();
      this.lastMetricsRefreshAt = Date.now();
    }
    return this.getMetrics();
  }

  private databaseBackoffMs(): number {
    const baseMs = Math.max(1_000, Number(process.env.CRYPTARA_OUTBOX_DB_BACKOFF_BASE_MS || 2_000));
    const maxMs = Math.max(baseMs, Number(process.env.CRYPTARA_OUTBOX_DB_BACKOFF_MAX_MS || 60_000));
    const cap = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, this.consecutiveCycleFailures - 1)));
    return jitterMs(cap);
  }

  private runCycle(): Promise<number> {
    if (Date.now() < this.degradedUntil) return Promise.resolve(0);
    if (this.cycleInFlight) return this.cycleInFlight;
    this.cycleInFlight = this.drainCycle().finally(() => {
      this.cycleInFlight = null;
    });
    return this.cycleInFlight;
  }

  private async drainCycle(): Promise<number> {
    const batchSize = this.batchSize();
    let processed = 0;
    try {
      // Claim the whole bounded batch with one PostgreSQL statement instead of one
      // round trip per row. SKIP LOCKED preserves multi-worker safety.
      const rows = await this.claimBatch(batchSize);
      for (const row of rows) {
        processed += 1;
        await this.process(row);
      }

      // Metrics are observability, not queue authority. Refresh at a bounded low
      // frequency instead of adding one aggregate query to every empty poll.
      if (Date.now() - this.lastMetricsRefreshAt >= this.metricsIntervalMs()) {
        const metrics = await this.refreshMetrics();
        if (metrics.lastError) throw new Error(metrics.lastError);
      }
      this.consecutiveCycleFailures = 0;
      this.degradedUntil = 0;
      return processed;
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
        dataPath: this.metrics.dataPath,
      });
      return processed;
    }
  }

  private async claimBatch(limit: number): Promise<ClaimedOutboxRow[]> {
    const leaseMs = Math.max(5_000, Number(process.env.CRYPTARA_OUTBOX_LEASE_MS || 30_000));
    const result = await withCryptaraSupabasePriority('low', () => pool.query(
      `with candidates as (
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
          limit $2
       )
       update private.cryptara_outbox as outbox
          set status = 'processing',
              locked_at = now(),
              attempt_count = outbox.attempt_count + 1,
              last_error = null
         from candidates
        where outbox.outbox_id = candidates.outbox_id
       returning outbox.outbox_id, outbox.source_event_id, outbox.job_kind,
                 outbox.schema_version, outbox.attempt_count, outbox.payload`,
      [leaseMs, Math.max(1, Math.min(32, Math.floor(limit)))],
    ));
    if ((result.rowCount || 0) === 0) return [];
    this.metrics.lastClaimAt = Date.now();
    return result.rows.map(row => ({
      outboxId: String(row.outbox_id),
      sourceEventId: String(row.source_event_id),
      jobKind: String(row.job_kind),
      schemaVersion: String(row.schema_version),
      attemptCount: Number(row.attempt_count),
      payload: row.payload,
    }));
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

      await this.persistTerminalOutcome(row.payload, row.outboxId);
      this.metrics.lastCompletedAt = Date.now();
      this.metrics.lastError = null;
    } catch (error) {
      await this.failOrRetry(row, error);
    }
  }

  private async persistTerminalOutcome(payload: TerminalOutcomeOutboxPayload, outboxId: string): Promise<void> {
    const { outcome, feedback } = payload;
    // Data-modifying CTE keeps durable learning + queue completion in one atomic
    // PostgreSQL statement. If persistence fails, completion cannot commit.
    await withCryptaraSupabasePriority('low', () => pool.query(
      `with persisted as (
         insert into private.cryptara_trade_outcomes (
           event_id, opportunity_id, observed_at, settled_at, topology, symbol, chain, strategy,
           success, terminal, settlement_confirmed, realized_profit_usd, realized_fee_usd,
           realized_slippage_bps, latency_ms, model_version, config_version, provenance,
           source_event_ids, payload
         ) values (
           $1, $2, to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0), $5, $6, $7, $8,
           $9, true, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb
         ) on conflict (event_id) do nothing
         returning event_id
       )
       update private.cryptara_outbox
          set status = 'completed', completed_at = now(), locked_at = null, last_error = null
        where outbox_id = $20 and status = 'processing'`,
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
        outboxId,
      ],
    ));
  }

  private async failOrRetry(row: ClaimedOutboxRow, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const maxAttempts = Math.max(1, Math.min(32, Number(process.env.CRYPTARA_OUTBOX_MAX_ATTEMPTS || 8)));
    const baseBackoffMs = Math.max(250, Number(process.env.CRYPTARA_OUTBOX_RETRY_BASE_MS || 1_000));
    const maxBackoffMs = Math.max(baseBackoffMs, Number(process.env.CRYPTARA_OUTBOX_RETRY_MAX_MS || 60_000));
    const exhausted = row.attemptCount >= maxAttempts;
    const capMs = Math.min(maxBackoffMs, baseBackoffMs * Math.pow(2, Math.max(0, row.attemptCount - 1)));
    const backoffMs = jitterMs(capMs);

    await withCryptaraSupabasePriority('low', () => pool.query(
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
    ));
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
      dataPath: this.metrics.dataPath,
    });
  }
}

export const canonicalIntelligenceOutbox = new CanonicalIntelligenceOutbox();

export function ensureCanonicalIntelligenceOutbox(): CanonicalIntelligenceOutbox {
  canonicalIntelligenceOutbox.start();
  return canonicalIntelligenceOutbox;
}
