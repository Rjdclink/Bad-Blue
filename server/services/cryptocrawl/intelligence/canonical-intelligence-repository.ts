import { pool } from '../../../db.js';
import logger from '../../../logger.js';
import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';

export interface DurableTerminalOutcome {
  eventId: string;
  opportunityId: string;
  observedAt: number;
  settledAt: number;
  topology: string;
  symbol: string;
  chain: string;
  strategy: string;
  success: boolean;
  terminal: true;
  settlementConfirmed: boolean;
  realizedProfitUsd: number | null;
  realizedFeeUsd: number | null;
  realizedSlippageBps: number | null;
  latencyMs: number;
  modelVersion: string;
  configVersion: string;
  provenance: string[];
  sourceEventIds: string[];
}

export interface IntelligenceMemoryMetrics {
  hydrated: boolean;
  hotOutcomes: number;
  persistenceQueueDepth: number;
  persistenceInFlight: boolean;
  droppedPersistenceTasks: number;
  lastPersistedAt: number | null;
  lastPersistenceError: string | null;
  durableAuthority: 'private_postgres';
  hotAuthority: 'bounded_process_memory';
  executionDependency: false;
}

export interface AdvisoryPatternMatch {
  patternId: string;
  patternKind: string;
  observedAt: number;
  cosineDistance: number;
  embeddingModel: string | null;
  embeddingVersion: string | null;
  normalizationMethod: string | null;
  provenance: string[];
  sourceEventIds: string[];
  payload: unknown;
  advisoryOnly: true;
}

type PersistTask = {
  eventId: string;
  outcome: DurableTerminalOutcome;
  feedback: CryptaraExecutionFeedback;
  attempts: number;
};

const HOT_OUTCOME_LIMIT = Math.max(64, Math.min(4096, Number(process.env.CRYPTARA_HOT_OUTCOME_LIMIT || 512)));
const PERSISTENCE_QUEUE_LIMIT = Math.max(64, Math.min(8192, Number(process.env.CRYPTARA_PERSISTENCE_QUEUE_LIMIT || 2048)));
const HYDRATE_LIMIT = Math.max(32, Math.min(HOT_OUTCOME_LIMIT, Number(process.env.CRYPTARA_REHYDRATE_LIMIT || 256)));
const persistenceMaxRetriesRaw = Number(process.env.CRYPTARA_PERSISTENCE_MAX_RETRIES || 5);
const persistenceRetryBaseMsRaw = Number(process.env.CRYPTARA_PERSISTENCE_RETRY_BASE_MS || 500);
const PERSISTENCE_MAX_RETRIES = Number.isFinite(persistenceMaxRetriesRaw)
  ? Math.max(1, Math.min(12, Math.trunc(persistenceMaxRetriesRaw)))
  : 5;
const PERSISTENCE_RETRY_BASE_MS = Number.isFinite(persistenceRetryBaseMsRaw)
  ? Math.max(100, Math.min(10_000, Math.trunc(persistenceRetryBaseMsRaw)))
  : 500;

function modelVersion(): string {
  return process.env.CRYPTARA_MODEL_VERSION?.trim() || 'cryptara-runtime-v1';
}

function configVersion(): string {
  return process.env.CRYPTOCRAWL_CONFIG_VERSION?.trim()
    || process.env.RAILWAY_GIT_COMMIT_SHA?.trim()
    || process.env.GIT_COMMIT?.trim()
    || 'runtime-config-v1';
}

function topologyFor(feedback: CryptaraExecutionFeedback): string {
  if (feedback.source === 'zero_capital' || feedback.source === 'flash_loan') return 'ZERO_CAPITAL_ATOMIC';
  if (feedback.chain.trim().toLowerCase() === 'cex') return 'CEX_CEX';
  return 'ONCHAIN';
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function vectorLiteral(embedding: readonly number[]): string {
  if (embedding.length !== 1536 || embedding.some(value => !Number.isFinite(value))) {
    throw new Error('Pattern similarity requires exactly 1536 finite embedding values');
  }
  return `[${embedding.join(',')}]`;
}

class CanonicalIntelligenceRepository {
  private readonly hotOutcomes = new Map<string, DurableTerminalOutcome>();
  private readonly persistenceQueue: PersistTask[] = [];
  private hydrated = false;
  private hydrationInFlight: Promise<void> | null = null;
  private persistenceInFlight = false;
  private droppedPersistenceTasks = 0;
  private lastPersistedAt: number | null = null;
  private lastPersistenceError: string | null = null;

  hydrate(limit = HYDRATE_LIMIT): Promise<void> {
    if (this.hydrated) return Promise.resolve();
    if (this.hydrationInFlight) return this.hydrationInFlight;
    const boundedLimit = Math.max(1, Math.min(HOT_OUTCOME_LIMIT, Math.floor(limit)));
    this.hydrationInFlight = this.hydrateOnce(boundedLimit)
      .catch(error => {
        this.lastPersistenceError = error instanceof Error ? error.message : String(error);
        logger.warn('[IntelligenceMemory] Durable rehydration unavailable; continuing with bounded hot memory', {
          component: 'CanonicalIntelligenceRepository',
          error: this.lastPersistenceError,
          executionBlocked: false,
        });
      })
      .finally(() => {
        this.hydrated = true;
        this.hydrationInFlight = null;
      });
    return this.hydrationInFlight;
  }

  observeTerminalOutcome(feedback: CryptaraExecutionFeedback, eventId: string): void {
    const settlement = feedback.settlement;
    if (!settlement || settlement.terminal !== true) {
      throw new Error('Canonical intelligence memory accepts terminal normalized execution evidence only');
    }
    if (!eventId.trim()) throw new Error('Canonical intelligence memory requires a deterministic terminal event id');

    const now = Date.now();
    const settledAt = asTimestamp(settlement.settledAt, asTimestamp(settlement.submittedAt, feedback.timestamp || now));
    const observedAt = asTimestamp(feedback.timestamp, settledAt);
    const outcome: DurableTerminalOutcome = {
      eventId,
      opportunityId: feedback.opportunityId || eventId,
      observedAt,
      settledAt,
      topology: topologyFor(feedback),
      symbol: feedback.symbol,
      chain: feedback.chain,
      strategy: feedback.strategy,
      success: feedback.success,
      terminal: true,
      settlementConfirmed: settlement.settlementConfirmed === true,
      realizedProfitUsd: finiteOrNull(feedback.realizedProfitUsd),
      realizedFeeUsd: finiteOrNull(feedback.feeUsd),
      realizedSlippageBps: finiteOrNull(feedback.slippageBps),
      latencyMs: Number.isFinite(feedback.latencyMs) && feedback.latencyMs >= 0 ? feedback.latencyMs : 0,
      modelVersion: modelVersion(),
      configVersion: configVersion(),
      provenance: [...new Set([...(feedback.provenance || []), ...(settlement.provenance || []), 'canonical_terminal_memory'])],
      sourceEventIds: [...new Set([eventId])],
    };

    this.rememberHot(outcome);
    this.enqueue({ eventId, outcome, feedback: structuredClone(feedback), attempts: 0 });
  }

  getRecentTerminalOutcomes(limit = 128): DurableTerminalOutcome[] {
    return [...this.hotOutcomes.values()]
      .sort((left, right) => right.settledAt - left.settledAt)
      .slice(0, Math.max(1, Math.min(HOT_OUTCOME_LIMIT, Math.floor(limit))))
      .map(outcome => ({ ...outcome, provenance: [...outcome.provenance], sourceEventIds: [...outcome.sourceEventIds] }));
  }

  getMetrics(): IntelligenceMemoryMetrics {
    return {
      hydrated: this.hydrated,
      hotOutcomes: this.hotOutcomes.size,
      persistenceQueueDepth: this.persistenceQueue.length,
      persistenceInFlight: this.persistenceInFlight,
      droppedPersistenceTasks: this.droppedPersistenceTasks,
      lastPersistedAt: this.lastPersistedAt,
      lastPersistenceError: this.lastPersistenceError,
      durableAuthority: 'private_postgres',
      hotAuthority: 'bounded_process_memory',
      executionDependency: false,
    };
  }

  async querySimilarPatternsAdvisory(embedding: readonly number[], limit = 12): Promise<AdvisoryPatternMatch[]> {
    const boundedLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const literal = vectorLiteral(embedding);
    const result = await pool.query(
      `select pattern_id, pattern_kind, observed_at, embedding <=> $1::extensions.vector as cosine_distance,
              embedding_model, embedding_version, normalization_method, provenance, source_event_ids, payload
         from private.cryptara_patterns
        where embedding is not null and revoked_at is null
        order by embedding <=> $1::extensions.vector
        limit $2`,
      [literal, boundedLimit],
    );
    return result.rows.map(row => ({
      patternId: String(row.pattern_id),
      patternKind: String(row.pattern_kind),
      observedAt: new Date(row.observed_at).getTime(),
      cosineDistance: Number(row.cosine_distance),
      embeddingModel: row.embedding_model ? String(row.embedding_model) : null,
      embeddingVersion: row.embedding_version ? String(row.embedding_version) : null,
      normalizationMethod: row.normalization_method ? String(row.normalization_method) : null,
      provenance: Array.isArray(row.provenance) ? row.provenance.map(String) : [],
      sourceEventIds: Array.isArray(row.source_event_ids) ? row.source_event_ids.map(String) : [],
      payload: row.payload,
      advisoryOnly: true as const,
    }));
  }

  private async hydrateOnce(limit: number): Promise<void> {
    const result = await pool.query(
      `select event_id, opportunity_id, extract(epoch from observed_at) * 1000 as observed_at_ms,
              extract(epoch from settled_at) * 1000 as settled_at_ms, topology, symbol, chain, strategy,
              success, terminal, settlement_confirmed, realized_profit_usd, realized_fee_usd,
              realized_slippage_bps, latency_ms, model_version, config_version, provenance, source_event_ids
         from private.cryptara_trade_outcomes
        where terminal = true
        order by settled_at desc
        limit $1`,
      [limit],
    );
    for (const row of [...result.rows].reverse()) {
      this.rememberHot({
        eventId: String(row.event_id),
        opportunityId: String(row.opportunity_id),
        observedAt: Number(row.observed_at_ms),
        settledAt: Number(row.settled_at_ms),
        topology: String(row.topology),
        symbol: String(row.symbol),
        chain: String(row.chain),
        strategy: String(row.strategy),
        success: row.success === true,
        terminal: true,
        settlementConfirmed: row.settlement_confirmed === true,
        realizedProfitUsd: finiteOrNull(row.realized_profit_usd === null ? null : Number(row.realized_profit_usd)),
        realizedFeeUsd: finiteOrNull(row.realized_fee_usd === null ? null : Number(row.realized_fee_usd)),
        realizedSlippageBps: finiteOrNull(row.realized_slippage_bps === null ? null : Number(row.realized_slippage_bps)),
        latencyMs: Number.isFinite(Number(row.latency_ms)) ? Number(row.latency_ms) : 0,
        modelVersion: String(row.model_version),
        configVersion: String(row.config_version),
        provenance: Array.isArray(row.provenance) ? row.provenance.map(String) : [],
        sourceEventIds: Array.isArray(row.source_event_ids) ? row.source_event_ids.map(String) : [],
      });
    }
    logger.info('[IntelligenceMemory] Bounded terminal memory rehydrated', {
      component: 'CanonicalIntelligenceRepository',
      outcomes: result.rowCount || 0,
      limit,
      executionBlocked: false,
    });
  }

  private rememberHot(outcome: DurableTerminalOutcome): void {
    this.hotOutcomes.delete(outcome.eventId);
    this.hotOutcomes.set(outcome.eventId, outcome);
    while (this.hotOutcomes.size > HOT_OUTCOME_LIMIT) {
      const oldestKey = this.hotOutcomes.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.hotOutcomes.delete(oldestKey);
    }
  }

  private enqueue(task: PersistTask): void {
    if (this.persistenceQueue.some(queued => queued.eventId === task.eventId)) return;
    if (this.persistenceQueue.length >= PERSISTENCE_QUEUE_LIMIT) {
      this.persistenceQueue.shift();
      this.droppedPersistenceTasks++;
      logger.warn('[IntelligenceMemory] Persistence queue reached its bounded in-process limit', {
        component: 'CanonicalIntelligenceRepository',
        droppedPersistenceTasks: this.droppedPersistenceTasks,
        queueLimit: PERSISTENCE_QUEUE_LIMIT,
        executionBlocked: false,
      });
    }
    this.persistenceQueue.push(task);
    void this.drainPersistenceQueue();
  }

  private async drainPersistenceQueue(): Promise<void> {
    if (this.persistenceInFlight) return;
    this.persistenceInFlight = true;
    try {
      while (this.persistenceQueue.length > 0) {
        const task = this.persistenceQueue.shift()!;
        try {
          await this.persist(task);
          this.lastPersistedAt = Date.now();
          this.lastPersistenceError = null;
        } catch (error) {
          this.lastPersistenceError = error instanceof Error ? error.message : String(error);
          task.attempts += 1;
          if (task.attempts <= PERSISTENCE_MAX_RETRIES) {
            const retryMs = Math.min(30_000, PERSISTENCE_RETRY_BASE_MS * (2 ** (task.attempts - 1)));
            this.persistenceQueue.push(task);
            logger.warn('[IntelligenceMemory] Durable terminal persistence retry scheduled; hot learning memory retained', {
              component: 'CanonicalIntelligenceRepository',
              eventId: task.eventId,
              attempt: task.attempts,
              maxRetries: PERSISTENCE_MAX_RETRIES,
              retryMs,
              error: this.lastPersistenceError,
              executionBlocked: false,
            });
            await new Promise(resolve => setTimeout(resolve, retryMs));
          } else {
            this.droppedPersistenceTasks++;
            logger.error('[IntelligenceMemory] Durable terminal persistence exhausted bounded retries; hot learning memory retained', {
              component: 'CanonicalIntelligenceRepository',
              eventId: task.eventId,
              attempts: task.attempts,
              droppedPersistenceTasks: this.droppedPersistenceTasks,
              error: this.lastPersistenceError,
              executionBlocked: false,
            });
          }
        }
      }
    } finally {
      this.persistenceInFlight = false;
    }
  }

  private async persist(task: PersistTask): Promise<void> {
    const { outcome, feedback } = task;
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
        JSON.stringify({ feedback, terminalEventId: outcome.eventId }),
      ],
    );
  }
}

export const canonicalIntelligenceRepository = new CanonicalIntelligenceRepository();
