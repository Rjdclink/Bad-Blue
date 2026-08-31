import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../../../db.js';
import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { withCryptaraSupabasePriority } from '../integration/cryptara-supabase-admission-worker.js';
import type { NormalizedRealizedExecution } from '../execution/settlement-types.js';
import type { MonteCarloTopology } from './monte-carlo-policy.js';

export interface MonteCarloCalibrationObservation {
  eventId: string;
  observedAt: number;
  topology: MonteCarloTopology;
  venuePair: string;
  symbol: string;
  chain: string;
  strategy: string;
  sizeBucket: string;
  success: boolean;
  bothLegsFilled: boolean | null;
  partialFill: boolean;
  profitResidualUsd: number | null;
  costMultiplier: number | null;
  slippageResidualBps: number | null;
  realizedProfitUsd: number | null;
  realizedFeeUsd: number | null;
  realizedSlippageBps: number | null;
  latencyMs: number | null;
  providerFailure: boolean;
  provenance: string[];
}

export interface MonteCarloCalibrationSampleSet {
  key: string;
  topology: MonteCarloTopology;
  samples: number;
  observations: MonteCarloCalibrationObservation[];
  profitResidualsUsd: number[];
  costMultipliers: number[];
  slippageResidualsBps: number[];
  latenciesMs: number[];
  bothLegsFillRate: number | null;
  partialFillRate: number | null;
  providerFailureRate: number | null;
  provenance: string[];
}

const TABLE = 'cryptocrawler_mc_calibration_v1';
const MODEL_VERSION = 'mc-calibration-v1';

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferredTopology(feedback: CryptaraExecutionFeedback): MonteCarloTopology {
  if (feedback.usedZeroCapital || feedback.source === 'flash_loan') return 'ZERO_CAPITAL';
  if (feedback.strategy.toLowerCase().includes('backrun')) return 'MEMPOOL_BACKRUN';
  if (feedback.strategy.toLowerCase().includes('cross_chain') || feedback.strategy.toLowerCase().includes('cross-chain')) return 'CROSS_CHAIN';
  if (feedback.chain === 'cex' || feedback.strategy === 'verified_cex_arbitrage') return 'CEX_CEX';
  return 'DEX_ATOMIC';
}

function venuePair(settlement: NormalizedRealizedExecution): string {
  const venues = [...new Set((settlement.orders || []).map(order => order.venue).filter(Boolean))];
  return venues.length > 0 ? venues.join('->') : settlement.venueOrRoute || 'unknown';
}

function notionalUsd(settlement: NormalizedRealizedExecution): number | null {
  const orders = settlement.orders || [];
  const values = orders
    .map(order => order.averageFillPrice !== null && order.filledQuantity !== null
      ? order.averageFillPrice * order.filledQuantity
      : null)
    .filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
  return values.length > 0 ? Math.max(...values) : null;
}

function sizeBucket(value: number | null): string {
  if (value === null) return 'unknown';
  if (value < 50) return 'lt50';
  if (value < 100) return '50_100';
  if (value < 250) return '100_250';
  if (value < 500) return '250_500';
  if (value < 1000) return '500_1000';
  if (value < 5000) return '1000_5000';
  return 'gte5000';
}

function bothLegsFilled(settlement: NormalizedRealizedExecution): boolean | null {
  const orders = settlement.orders || [];
  if (orders.length < 2) return null;
  return orders.every(order => order.status === 'filled' && order.terminal &&
    order.filledQuantity !== null && order.filledQuantity >= order.requestedQuantity * 0.999999);
}

function partialFill(settlement: NormalizedRealizedExecution): boolean {
  return (settlement.orders || []).some(order => order.status === 'partially_filled' ||
    (order.filledQuantity !== null && order.filledQuantity > 0 && order.filledQuantity < order.requestedQuantity));
}

function calibrationKey(input: {
  topology: MonteCarloTopology;
  venuePair: string;
  symbol: string;
  chain: string;
  strategy: string;
  sizeBucket: string;
}): string {
  return [input.topology, input.venuePair, input.symbol.toUpperCase(), input.chain.toLowerCase(), input.strategy, input.sizeBucket].join('|');
}

function toObservation(feedback: CryptaraExecutionFeedback): MonteCarloCalibrationObservation | null {
  const settlement = feedback.settlement;
  if (!settlement || settlement.terminal !== true || feedback.settlementConfirmed !== true) return null;
  const predictedProfit = finite(settlement.predicted.profitUsd ?? feedback.expectedProfitUsd);
  const realizedProfit = finite(settlement.realized.netProfitUsd ?? feedback.realizedProfitUsd);
  const predictedFee = finite(settlement.predicted.feeUsd);
  const measuredFees = [settlement.realized.exchangeFeeUsd, settlement.realized.gasUsd]
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const realizedFee = measuredFees.length > 0 ? measuredFees.reduce((sum, value) => sum + value, 0) : finite(feedback.feeUsd);
  const predictedSlippage = finite(settlement.predicted.slippageBps);
  const realizedSlippage = finite(settlement.realized.slippageBps ?? feedback.slippageBps);
  const topology = inferredTopology(feedback);
  const pair = venuePair(settlement);
  const bucket = sizeBucket(notionalUsd(settlement));
  return {
    eventId: `${feedback.opportunityId || `${feedback.symbol}:${feedback.strategy}`}:${feedback.timestamp}`,
    observedAt: feedback.timestamp,
    topology,
    venuePair: pair,
    symbol: feedback.symbol,
    chain: feedback.chain,
    strategy: feedback.strategy,
    sizeBucket: bucket,
    success: feedback.success,
    bothLegsFilled: bothLegsFilled(settlement),
    partialFill: partialFill(settlement),
    profitResidualUsd: predictedProfit !== null && realizedProfit !== null ? realizedProfit - predictedProfit : null,
    costMultiplier: predictedFee !== null && predictedFee > 0 && realizedFee !== null ? realizedFee / predictedFee : null,
    slippageResidualBps: predictedSlippage !== null && realizedSlippage !== null ? realizedSlippage - predictedSlippage : null,
    realizedProfitUsd: realizedProfit,
    realizedFeeUsd: realizedFee,
    realizedSlippageBps: realizedSlippage,
    latencyMs: finite(feedback.latencyMs),
    providerFailure: !feedback.success && ['rejected', 'failed', 'settlement_unknown'].includes(settlement.status),
    provenance: [...new Set([MODEL_VERSION, 'terminal_normalized_settlement', ...(feedback.provenance || []), ...settlement.provenance])],
  };
}

class MonteCarloCalibrationStore {
  private readonly observations = new Map<string, MonteCarloCalibrationObservation>();
  private hydratePromise: Promise<void> | null = null;
  private tableReady: Promise<boolean> | null = null;
  private persistenceReady = false;
  private readonly maxEntries = Math.max(128, Math.min(50_000, Number(process.env.CRYPTOCRAWL_MC_CALIBRATION_MAX || 10_000)));

  private async ensureTable(): Promise<boolean> {
    if (!isDatabaseConfigured) return false;
    if (this.tableReady) return this.tableReady;
    this.tableReady = (async () => {
      try {
        // Migration 023 owns this schema. Runtime calibration must never acquire
        // DDL locks or create indexes on the hot path; verify the migration-owned
        // relation once, then use ordinary DML through the shared admission lane.
        const result = await withCryptaraSupabasePriority('low', () =>
          pool.query('SELECT to_regclass($1::text) AS relation', [`public.${TABLE}`]),
        );
        this.persistenceReady = typeof result.rows?.[0]?.relation === 'string';
        if (!this.persistenceReady) {
          logger.warn('[MonteCarloCalibration] Migration-owned persistence table unavailable; retaining measured in-memory calibration', {
            component: 'MonteCarloCalibrationStore',
            table: TABLE,
          });
        }
        return this.persistenceReady;
      } catch (error) {
        this.persistenceReady = false;
        logger.warn('[MonteCarloCalibration] Persistence unavailable; retaining measured in-memory calibration', {
          component: 'MonteCarloCalibrationStore',
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    })();
    return this.tableReady;
  }

  async hydrate(): Promise<void> {
    if (this.hydratePromise) return this.hydratePromise;
    this.hydratePromise = (async () => {
      if (!await this.ensureTable()) return;
      const result = await withCryptaraSupabasePriority('low', () =>
        pool.query(`SELECT payload FROM ${TABLE} ORDER BY observed_at DESC LIMIT $1`, [this.maxEntries]),
      );
      for (const row of result.rows) {
        const observation = row.payload as MonteCarloCalibrationObservation;
        if (observation?.eventId) this.observations.set(observation.eventId, observation);
      }
      logger.info('[MonteCarloCalibration] Measured terminal calibration hydrated', {
        component: 'MonteCarloCalibrationStore',
        samples: this.observations.size,
        modelVersion: MODEL_VERSION,
      });
    })().catch(error => {
      logger.warn('[MonteCarloCalibration] Hydration failed closed', {
        component: 'MonteCarloCalibrationStore',
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return this.hydratePromise;
  }

  async recordTerminal(feedback: CryptaraExecutionFeedback): Promise<MonteCarloCalibrationObservation | null> {
    const observation = toObservation(feedback);
    if (!observation) return null;
    this.observations.set(observation.eventId, observation);
    this.prune();
    if (await this.ensureTable()) {
      await withCryptaraSupabasePriority('low', () => pool.query(
        `INSERT INTO ${TABLE} (event_id, observed_at, topology, venue_pair, symbol, chain, strategy, size_bucket, payload, model_version)
         VALUES ($1, to_timestamp($2 / 1000.0), $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          observation.eventId,
          observation.observedAt,
          observation.topology,
          observation.venuePair,
          observation.symbol,
          observation.chain,
          observation.strategy,
          observation.sizeBucket,
          JSON.stringify(observation),
          MODEL_VERSION,
        ],
      )).catch(error => {
        logger.warn('[MonteCarloCalibration] Persistence write failed; measured in-memory sample retained', {
          component: 'MonteCarloCalibrationStore',
          eventId: observation.eventId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    return { ...observation, provenance: [...observation.provenance] };
  }

  getSamples(input: {
    topology: MonteCarloTopology;
    venuePair?: string;
    symbol?: string;
    chain?: string;
    strategy?: string;
    sizeBucket?: string;
    limit?: number;
  }): MonteCarloCalibrationSampleSet {
    const limit = Math.max(1, Math.min(5000, input.limit ?? 512));
    const all = [...this.observations.values()]
      .filter(item => item.topology === input.topology)
      .filter(item => !input.venuePair || item.venuePair === input.venuePair)
      .filter(item => !input.symbol || item.symbol.toUpperCase() === input.symbol.toUpperCase())
      .filter(item => !input.chain || item.chain.toLowerCase() === input.chain.toLowerCase())
      .filter(item => !input.strategy || item.strategy === input.strategy)
      .filter(item => !input.sizeBucket || item.sizeBucket === input.sizeBucket)
      .sort((a, b) => b.observedAt - a.observedAt)
      .slice(0, limit);
    const fill = all.filter(item => item.bothLegsFilled !== null);
    const partial = all.filter(item => item.bothLegsFilled !== null || item.partialFill);
    const provider = all;
    return {
      key: calibrationKey({
        topology: input.topology,
        venuePair: input.venuePair || '*',
        symbol: input.symbol || '*',
        chain: input.chain || '*',
        strategy: input.strategy || '*',
        sizeBucket: input.sizeBucket || '*',
      }),
      topology: input.topology,
      samples: all.length,
      observations: all.map(item => ({ ...item, provenance: [...item.provenance] })),
      profitResidualsUsd: all.map(item => item.profitResidualUsd).filter((value): value is number => value !== null),
      costMultipliers: all.map(item => item.costMultiplier).filter((value): value is number => value !== null && value >= 0),
      slippageResidualsBps: all.map(item => item.slippageResidualBps).filter((value): value is number => value !== null),
      latenciesMs: all.map(item => item.latencyMs).filter((value): value is number => value !== null && value >= 0),
      bothLegsFillRate: fill.length > 0 ? fill.filter(item => item.bothLegsFilled).length / fill.length : null,
      partialFillRate: partial.length > 0 ? partial.filter(item => item.partialFill).length / partial.length : null,
      providerFailureRate: provider.length > 0 ? provider.filter(item => item.providerFailure).length / provider.length : null,
      provenance: [MODEL_VERSION, 'terminal_normalized_settlement_only'],
    };
  }

  getMetrics(): { samples: number; modelVersion: string; persisted: boolean } {
    return { samples: this.observations.size, modelVersion: MODEL_VERSION, persisted: this.persistenceReady };
  }

  private prune(): void {
    if (this.observations.size <= this.maxEntries) return;
    const oldest = [...this.observations.values()].sort((a, b) => a.observedAt - b.observedAt);
    for (let index = 0; index < oldest.length - this.maxEntries; index++) this.observations.delete(oldest[index].eventId);
  }
}

export const monteCarloCalibrationStore = new MonteCarloCalibrationStore();
