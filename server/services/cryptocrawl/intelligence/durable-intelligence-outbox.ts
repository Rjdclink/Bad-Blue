import { pool } from '../../../db.js';
import logger from '../../../logger.js';
import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
import type { PersistedCryptaraExecutionEvidence } from '../governance/stage-management.js';
import { terminalFeedbackIdentity } from '../learning/terminal-feedback-identity.js';
import { canonicalIntelligenceRepository } from './canonical-intelligence-repository.js';

const OUTBOX_SCHEMA_VERSION = 'cryptara-terminal-feedback-v1';
const OUTBOX_JOB_KIND = 'persist_terminal_outcome';
const MAX_ATTEMPTS = Math.max(1, Math.min(32, Number(process.env.CRYPTARA_OUTBOX_MAX_ATTEMPTS || 8)));
const LOCK_TIMEOUT_MS = Math.max(5_000, Number(process.env.CRYPTARA_OUTBOX_LOCK_TIMEOUT_MS || 60_000));
const POLL_INTERVAL_MS = Math.max(250, Number(process.env.CRYPTARA_OUTBOX_POLL_MS || 1_000));
const BATCH_LIMIT = Math.max(1, Math.min(100, Number(process.env.CRYPTARA_OUTBOX_BATCH_LIMIT || 20)));
const MAX_RETRY_DELAY_MS = Math.max(5_000, Number(process.env.CRYPTARA_OUTBOX_MAX_RETRY_DELAY_MS || 5 * 60_000));

interface OutboxPayloadV1 {
  schemaVersion: typeof OUTBOX_SCHEMA_VERSION;
  sourceEventId: string;
  feedback: CryptaraExecutionFeedback;
}

interface ClaimedOutboxJob {
  outboxId: string;
  sourceEventId: string;
  jobKind: string;
  schemaVersion: string;
  dedupeKey: string;
  attemptCount: number;
  payload: unknown;
}

export interface DurableOutboxHealth {
  workerRunning: boolean;
  workerBusy: boolean;
  pending: number;
  retry: number;
  processing: number;
  completed: number;
  failed: number;
  readyNow: number;
  oldestReadyAgeMs: number | null;
  lastCompletedAt: number | null;
  lastWorkerError: string | null;
  lastReconciledAt: number | null;
  lastReconciledEvidence: number;
  executionDependency: false;
  authority: 'background_persistence_transport_only';
}

function outboxDedupeKey(eventId: string): string {
  return `terminal-outcome:${eventId}`;
}

function outboxId(eventId: string): string {
  return `outbox:${outboxDedupeKey(eventId)}`;
}

function retryDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(20, attemptCount - 1));
  return Math.min(MAX_RETRY_DELAY_MS, 1_000 * Math.pow(2, exponent));
}

function backgroundIntervalsAllowed(): boolean {
  if (process.env.NO_INTERVALS === 'true') return false;
  return (process.env.CRYPTARA_MODE || '').trim().toUpperCase() !== 'SILENT_WATCHER_ONLY';
}

function normalizePayload(value: unknown): OutboxPayloadV1 {
  if (!value || typeof value !== 'object') throw new Error('Outbox payload is not an object');
  const input = value as Partial<OutboxPayloadV1>;
  if (input.schemaVersion !== OUTBOX_SCHEMA_VERSION) {
    throw new Error(`Unsupported outbox schema version: ${String(input.schemaVersion)}`);
  }
  if (typeof input.sourceEventId !== 'string' || !input.sourceEventId.trim()) {
    throw new Error('Outbox payload is missing sourceEventId');
  }
  if (!input.feedback || typeof input.feedback !== 'object') {
    throw new Error('Outbox payload is missing terminal feedback');
  }
  const feedback = input.feedback as CryptaraExecutionFeedback;
  if (!feedback.settlement || feedback.settlement.terminal !== true) {
    throw new Error('Outbox payload does not contain terminal normalized settlement evidence');
  }
  const derivedEventId = terminalFeedbackIdentity(feedback);
  if (derivedEventId !== input.sourceEventId) {
    throw new Error('Outbox source event id does not match canonical terminal feedback identity');
  }
  return {
    schemaVersion: OUTBOX_SCHEMA_VERSION,
    sourceEventId: input.sourceEventId,
    feedback,
  };
}

class DurableIntelligenceOutbox {
  private timer: NodeJS.Timeout | null = null;
  private workerBusy = false;
  private lastWorkerError: string | null = null;
  private lastCompletedAt: number | null = null;
  private lastReconciledAt: number | null = null;
  private lastReconciledEvidence = 0;

  async enqueueTerminalPersistence(feedback: CryptaraExecutionFeedback, eventId: string): Promise<boolean> {
    if (!feedback.settlement || feedback.settlement.terminal !== true) {
      throw new Error('Durable outbox accepts terminal normalized execution evidence only');
    }
    const canonicalEventId = terminalFeedbackIdentity(feedback);
    if (canonicalEventId !== eventId) {
      throw new Error('Durable outbox event id does not match canonical terminal feedback identity');
    }
    const payload: OutboxPayloadV1 = {
      schemaVersion: OUTBOX_SCHEMA_VERSION,
      sourceEventId: eventId,
      feedback: structuredClone(feedback),
    };
    const result = await pool.query(
      `insert into private.cryptara_outbox (
         outbox_id, source_event_id, job_kind, schema_version, dedupe_key,
         status, attempt_count, visible_at, payload
       ) values ($1, $2, $3, $4, $5, 'pending', 0, now(), $6::jsonb)
       on conflict (dedupe_key) do nothing`,
      [
        outboxId(eventId),
        eventId,
        OUTBOX_JOB_KIND,
        OUTBOX_SCHEMA_VERSION,
        outboxDedupeKey(eventId),
        JSON.stringify(payload),
      ],
    );
    return (result.rowCount || 0) > 0;
  }

  /**
   * Rebuild missing transport records from StageManager's already-restored,
   * authoritative terminal evidence. This is idempotent and never manufactures
   * execution evidence: every queued job must map back to terminal settlement data
   * that governance had previously persisted.
   */
  async reconcilePersistedTerminalEvidence(
    evidence: readonly PersistedCryptaraExecutionEvidence[],
  ): Promise<{ scanned: number; terminal: number; enqueued: number; failed: number }> {
    let terminal = 0;
    let enqueued = 0;
    let failed = 0;
    for (const persisted of evidence) {
      if (!persisted.settlement || persisted.settlement.terminal !== true) continue;
      terminal++;
      try {
        const eventId = terminalFeedbackIdentity(persisted);
        if (await this.enqueueTerminalPersistence(persisted, eventId)) enqueued++;
      } catch (error) {
        failed++;
        this.lastWorkerError = error instanceof Error ? error.message : String(error);
        logger.warn('[IntelligenceOutbox] Persisted terminal evidence reconciliation degraded', {
          component: 'DurableIntelligenceOutbox',
          opportunityId: persisted.opportunityId,
          error: this.lastWorkerError,
          executionBlocked: false,
        });
      }
    }
    this.lastReconciledAt = Date.now();
    this.lastReconciledEvidence = terminal;
    logger.info('[IntelligenceOutbox] Persisted terminal evidence reconciled', {
      component: 'DurableIntelligenceOutbox',
      scanned: evidence.length,
      terminal,
      enqueued,
      failed,
      executionDependency: false,
      authority: 'background_persistence_transport_only',
    });
    return { scanned: evidence.length, terminal, enqueued, failed };
  }

  start(): void {
    if (this.timer || !backgroundIntervalsAllowed()) {
      if (!backgroundIntervalsAllowed()) {
        logger.info('[IntelligenceOutbox] Background polling disabled by runtime interval policy', {
          component: 'DurableIntelligenceOutbox',
          executionBlocked: false,
        });
      }
      return;
    }
    void this.drainAvailable();
    this.timer = setInterval(() => void this.drainAvailable(), POLL_INTERVAL_MS);
    this.timer.unref?.();
    logger.info('[IntelligenceOutbox] Restart-safe background persistence worker started', {
      component: 'DurableIntelligenceOutbox',
      pollIntervalMs: POLL_INTERVAL_MS,
      batchLimit: BATCH_LIMIT,
      maxAttempts: MAX_ATTEMPTS,
      lockTimeoutMs: LOCK_TIMEOUT_MS,
      executionDependency: false,
      authority: 'background_persistence_transport_only',
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async drainAvailable(): Promise<void> {
    if (this.workerBusy) return;
    this.workerBusy = true;
    try {
      for (let index = 0; index < BATCH_LIMIT; index++) {
        const job = await this.claimNext();
        if (!job) break;
        await this.processClaimed(job);
      }
    } catch (error) {
      this.lastWorkerError = error instanceof Error ? error.message : String(error);
      logger.warn('[IntelligenceOutbox] Worker cycle degraded', {
        component: 'DurableIntelligenceOutbox',
        error: this.lastWorkerError,
        executionBlocked: false,
      });
    } finally {
      this.workerBusy = false;
    }
  }

  async getHealth(): Promise<DurableOutboxHealth> {
    try {
      const result = await pool.query(
        `select
           count(*) filter (where status = 'pending')::int as pending,
           count(*) filter (where status = 'retry')::int as retry,
           count(*) filter (where status = 'processing')::int as processing,
           count(*) filter (where status = 'completed')::int as completed,
           count(*) filter (where status = 'failed')::int as failed,
           count(*) filter (where status in ('pending','retry') and visible_at <= now())::int as ready_now,
           extract(epoch from (now() - min(created_at) filter (where status in ('pending','retry') and visible_at <= now()))) * 1000 as oldest_ready_age_ms
         from private.cryptara_outbox`,
      );
      const row = result.rows[0] || {};
      return {
        workerRunning: this.timer !== null,
        workerBusy: this.workerBusy,
        pending: Number(row.pending) || 0,
        retry: Number(row.retry) || 0,
        processing: Number(row.processing) || 0,
        completed: Number(row.completed) || 0,
        failed: Number(row.failed) || 0,
        readyNow: Number(row.ready_now) || 0,
        oldestReadyAgeMs: row.oldest_ready_age_ms === null || row.oldest_ready_age_ms === undefined
          ? null
          : Number(row.oldest_ready_age_ms),
        lastCompletedAt: this.lastCompletedAt,
        lastWorkerError: this.lastWorkerError,
        lastReconciledAt: this.lastReconciledAt,
        lastReconciledEvidence: this.lastReconciledEvidence,
        executionDependency: false,
        authority: 'background_persistence_transport_only',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastWorkerError = message;
      return {
        workerRunning: this.timer !== null,
        workerBusy: this.workerBusy,
        pending: 0,
        retry: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        readyNow: 0,
        oldestReadyAgeMs: null,
        lastCompletedAt: this.lastCompletedAt,
        lastWorkerError: message,
        lastReconciledAt: this.lastReconciledAt,
        lastReconciledEvidence: this.lastReconciledEvidence,
        executionDependency: false,
        authority: 'background_persistence_transport_only',
      };
    }
  }

  private async claimNext(): Promise<ClaimedOutboxJob | null> {
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
              attempt_count = outbox.attempt_count + 1,
              locked_at = now(),
              last_error = null
         from candidate
        where outbox.outbox_id = candidate.outbox_id
       returning outbox.outbox_id, outbox.source_event_id, outbox.job_kind,
                 outbox.schema_version, outbox.dedupe_key, outbox.attempt_count, outbox.payload`,
      [LOCK_TIMEOUT_MS],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      outboxId: String(row.outbox_id),
      sourceEventId: String(row.source_event_id),
      jobKind: String(row.job_kind),
      schemaVersion: String(row.schema_version),
      dedupeKey: String(row.dedupe_key),
      attemptCount: Number(row.attempt_count),
      payload: row.payload,
    };
  }

  private async processClaimed(job: ClaimedOutboxJob): Promise<void> {
    try {
      if (job.jobKind !== OUTBOX_JOB_KIND) throw new Error(`Unsupported outbox job kind: ${job.jobKind}`);
      if (job.schemaVersion !== OUTBOX_SCHEMA_VERSION) throw new Error(`Unsupported outbox schema version: ${job.schemaVersion}`);
      if (job.dedupeKey !== outboxDedupeKey(job.sourceEventId)) throw new Error('Outbox dedupe key is inconsistent with source event id');
      const payload = normalizePayload(job.payload);
      if (payload.sourceEventId !== job.sourceEventId) throw new Error('Outbox row source event id does not match immutable payload source id');

      await canonicalIntelligenceRepository.persistTerminalOutcomeFromOutbox(payload.feedback, payload.sourceEventId);
      await pool.query(
        `update private.cryptara_outbox
            set status = 'completed', completed_at = now(), locked_at = null, last_error = null
          where outbox_id = $1 and status = 'processing'`,
        [job.outboxId],
      );
      this.lastCompletedAt = Date.now();
      this.lastWorkerError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastWorkerError = message;
      const terminalFailure = job.attemptCount >= MAX_ATTEMPTS;
      const delayMs = retryDelayMs(job.attemptCount);
      await pool.query(
        `update private.cryptara_outbox
            set status = $2,
                visible_at = case when $2 = 'retry' then now() + ($3::double precision * interval '1 millisecond') else visible_at end,
                locked_at = null,
                last_error = $4,
                completed_at = case when $2 = 'failed' then now() else completed_at end
          where outbox_id = $1 and status = 'processing'`,
        [job.outboxId, terminalFailure ? 'failed' : 'retry', delayMs, message.slice(0, 4_000)],
      );
      logger.warn('[IntelligenceOutbox] Durable background job failed', {
        component: 'DurableIntelligenceOutbox',
        outboxId: job.outboxId,
        sourceEventId: job.sourceEventId,
        attemptCount: job.attemptCount,
        maxAttempts: MAX_ATTEMPTS,
        terminalFailure,
        retryDelayMs: terminalFailure ? null : delayMs,
        error: message,
        executionBlocked: false,
      });
    }
  }
}

export const durableIntelligenceOutbox = new DurableIntelligenceOutbox();
