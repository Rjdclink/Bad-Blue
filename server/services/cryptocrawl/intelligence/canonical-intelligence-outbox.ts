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
  private metricsInFlight: Promise<IntelligenceOutboxMetrics> | null = null;
  private kickPending = false;
  private consecutiveCycleFailures = 0;
  private degradedUntil = 0;
  private nextVisibleAt: number | null = null;
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
    return boundedMs(process.env.CRYPTARA_OUTBOX_POLL_MS, 2_000, 250, 30_000);
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
    this.kickPending = false;
    this.nextVisibleAt = null;
    // One restart-recovery scan is necessary to recover durable work left by a
    // previous process. After that scan, the worker becomes event/retry driven and
    // performs no empty Primary polling.
    this.schedule(0);
    logger.info('[IntelligenceOutbox] Restart-safe event-driven background worker started', {
      component: 'CanonicalIntelligenceOutbox',
      activeFollowupMs: this.activePollMs(),
      metricsIntervalMs: this.metricsIntervalMs(),
      dataPath: this.metrics.dataPath,
      authority: this.metrics.authority,
      executionDependency: false,
      durableDedupe: true,
      staleLeaseRecovery: true,
      batchedClaims: true,
      atomicPersistAndComplete: true,
      restartRecoveryScan: true,
      idlePolling: 'quiescent_after_empty',
      retryWake: 'exact_visible_at_or_database_backoff',
      databaseFailureBackoff: 'bounded_exponential_jitter',
    });
  }

  stop(): void {
    this.metrics.running = false;
    this.kickPending = false;
    this.nextVisibleAt = null;
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
    this.kickPending = true;
    if (this.cycleInFlight) return;
    this.kickPending = false;
    this.schedule(0);
  }

  private scheduleKnownRetry(): boolean {
    if (this.nextVisibleAt === null) return false;
    const delayMs = this.nextVisibleAt - Date.now();
    if (delayMs <= 0) {
      this.nextVisibleAt = null;
      this.schedule(0);
      return true;
    }
    this.schedule(delayMs);
    return true;
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
      this.schedule(0);
      return;
    }

    if (this.degradedUntil > Date.now()) {
      this.schedule(Math.max(1, this.degradedUntil - Date.now()));
      return;
    }

    const batchSize = this.batchSize();
    if (processed >= batchSize) {
      // A full bounded claim means more immediately-ready work may remain.
      this.schedule(0);
      return;
    }

    if (this.scheduleKnownRetry()) return;

    // No ready work, no locally-known retry, and no new terminal event. Remain
    // fully quiescent instead of asking Primary repeatedly whether work exists.
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
    // Insert or prove the exact immutable duplicate in one SQL round trip. This
    // preserves the former collision validation without paying a second SELECT.
    const result = await withCryptaraSupabasePriority('high', () => pool.query(
      `with inserted as (
         insert into private.cryptara_outbox (
           outbox_id, source_event_id, job_kind, schema_version, dedupe_key, status,
           attempt_count, visible_at, payload
         ) values ($1, $2, $3, $4, $5, 'pending', 0, now(), $6::jsonb)
         on conflict (dedupe_key) do nothing
         returning outbox_id
       ), verified as (
         select outbox_id from inserted
         union all
         select outbox_id
           from private.cryptara_outbox
          where dedupe_key = $5
            and source_event_id = $2
            and job_kind = $3
            and schema_version = $4
          limit 1
       )
       select outbox_id from verified limit 1`,
      [
        outboxId,
        outcome.eventId,
        TERMINAL_JOB_KIND,
        OUTBOX_SCHEMA_VERSION,
        outboxId,
        JSON.stringify(payload),
      ],
    ));
    const durable = (result.rowCount || 0) > 0;
    if (durable) this.kick();
    return durable;
  }

  getMetrics(): IntelligenceOutboxMetrics {
    return { ...this.metrics };
  }

  async refreshMetrics(): Promise<IntelligenceOutboxMetrics> {
    const now = Date.now();
    if (this.lastMetricsRefreshAt > 0 && now - this.lastMetricsRefreshAt < this.metricsIntervalMs()) {
      return this.getMetrics();
    }
    if (this.metricsInFlight) return this.metricsInFlight;

    const refresh = (async (): Promise<IntelligenceOutboxMetrics> => {
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
      } catch (error) {
        this.metrics.lastError = error instanceof Error ? error.message : String(error);
        this.metrics.lastMetricsAt = Date.now();
      } finally {
        this.lastMetricsRefreshAt = Date.now();
      }
      return this.getMetrics();
    })();

    this.metricsInFlight = refresh;
    try {
      return await refresh;
    } finally {
      if (this.metricsInFlight === refresh) this.metricsInFlight = null;
    }
  }

  private databaseBackoffMs(): number {
    const baseMs = Math.max(1_000, Number(process.env.CRYPTARA_OUTBOX_DB_BACKOFF_BASE_MS || 5_000));
    const maxMs = Math.max(baseMs, Number(process.env.CRYPTARA_OUTBOX_DB_BACKOFF_MAX_MS || 900_000));
    const policyMultiplier = Math.max(
      1,
      Number(getCryptaraSupabaseCompSwitchSnapshot().policy.backgroundPollMultiplier || 1),
    );
    const exponential = baseMs * Math.pow(2, Math.max(0, this.consecutiveCycleFailures - 1));
    const cap = Math.min(maxMs, Math.max(baseMs, Math.floor(exponential * policyMultiplier)));
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
      const rows = await this.claimBatch(batchSize);
      for (const row of rows) {
        processed += 1;
        await this.process(row);
      }

      if (processed > 0 && Date.now() - this.lastMetricsRefreshAt >= this.metricsIntervalMs()) {
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
    const configuredLeaseMs = Math.max(5_000, Number(process.env.CRYPTARA_OUTBOX_LEASE_MS || 30_000));
    // A batch is marked processing at once but completed sequentially. Scale the
    // stale-recovery window with bounded batch width so a healthy second worker
    // cannot reclaim the tail of the same batch merely because Supabase is slow.
    const leaseMs = Math.max(configuredLeaseMs, Math.min(300_000, Math.max(1, limit) * 15_000));
    // Claim all immediately-ready work and discover the exact earliest future
    // retry in one Primary round trip. That exact timestamp replaces empty polling.
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
       ), claimed as (
         update private.cryptara_outbox as outbox
            set status = 'processing',
                locked_at = now(),
                attempt_count = outbox.attempt_count + 1,
                last_error = null
           from candidates
          where outbox.outbox_id = candidates.outbox_id
         returning outbox.outbox_id, outbox.source_event_id, outbox.job_kind,
                   outbox.schema_version, outbox.attempt_count, outbox.payload
       ), next_retry as (
         select extract(epoch from min(visible_at)) * 1000 as next_visible_at_ms
           from private.cryptara_outbox
          where status in ('pending','retry') and visible_at > now()
       )
       select
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'outbox_id', claimed.outbox_id,
               'source_event_id', claimed.source_event_id,
               'job_kind', claimed.job_kind,
               'schema_version', claimed.schema_version,
               'attempt_count', claimed.attempt_count,
               'payload', claimed.payload
             )
           ) filter (where claimed.outbox_id is not null),
           '[]'::jsonb
         ) as claimed_rows,
         (select next_visible_at_ms from next_retry) as next_visible_at_ms
       from claimed`,
      [leaseMs, Math.max(1, Math.min(32, Math.floor(limit)))],
    ));

    const aggregate = result.rows?.[0] || {};
    const nextVisibleAt = Number(aggregate.next_visible_at_ms);
    this.nextVisibleAt = Number.isFinite(nextVisibleAt) && nextVisibleAt > Date.now()
      ? nextVisibleAt
      : null;

    const claimedRows = Array.isArray(aggregate.claimed_rows) ? aggregate.claimed_rows : [];
    if (claimedRows.length === 0) return [];
    this.metrics.lastClaimAt = Date.now();
    return claimedRows.map((row: any) => ({
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

    if (!exhausted) {
      const retryAt = Date.now() + backoffMs;
      this.nextVisibleAt = this.nextVisibleAt === null
        ? retryAt
        : Math.min(this.nextVisibleAt, retryAt);
    }

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
