import { createHash } from 'node:crypto';
import { pool } from '../../../db.js';
import logger from '../../../logger.js';

export interface SlippageCalibrationKey {
  venuePair: string;
  symbol: string;
  sizeBucket: string;
  volatilityBucket: string;
  timeBucket: string;
}
export interface SlippageObservation extends SlippageCalibrationKey {
  observedAt: number;
  expectedDepthSlippageBps: number;
  realizedSlippageBps: number;
  partialFill: boolean;
  sourceEventId: string;
}
export interface SlippageCalibrationEstimate {
  residualSlippageBps: number;
  samples: number;
  source: 'exact' | 'pair_symbol_size' | 'pair_symbol' | 'global' | 'conservative_fallback';
  regimeVersion: string;
  observedAt: number | null;
  advisoryOnly: true;
}

const MODEL_VERSION = 'residual-slippage-v1';
const MAX_OBSERVATIONS = Math.max(256, Math.min(50_000, Number(process.env.CRYPTO_SLIPPAGE_CALIBRATION_MAX_OBSERVATIONS || 10_000)));
const MIN_SAMPLES = Math.max(3, Number(process.env.CRYPTO_SLIPPAGE_CALIBRATION_MIN_SAMPLES || 12));
const MAX_AGE_MS = Math.max(60_000, Number(process.env.CRYPTO_SLIPPAGE_CALIBRATION_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000));
const REGIME_RESET_MULTIPLIER = Math.max(1.5, Number(process.env.CRYPTO_SLIPPAGE_REGIME_RESET_MULTIPLIER || 3));
const observations: SlippageObservation[] = [];
let regimeVersion = 'regime:0';
let regimeCounter = 0;

function finiteNonNegative(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a,b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}
function residual(observation: SlippageObservation): number {
  const base = Math.max(0, observation.realizedSlippageBps - observation.expectedDepthSlippageBps);
  return observation.partialFill ? base + Math.max(0, Number(process.env.CRYPTO_SLIPPAGE_PARTIAL_FILL_PENALTY_BPS || 5)) : base;
}
function current(now = Date.now()): SlippageObservation[] {
  return observations.filter(item => now - item.observedAt <= MAX_AGE_MS);
}
function matchesExact(item: SlippageObservation, key: SlippageCalibrationKey): boolean {
  return item.venuePair === key.venuePair && item.symbol === key.symbol && item.sizeBucket === key.sizeBucket && item.volatilityBucket === key.volatilityBucket && item.timeBucket === key.timeBucket;
}
function configVersion(): string {
  return process.env.CRYPTOCRAWL_CONFIG_VERSION?.trim() || process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || process.env.GIT_COMMIT?.trim() || 'runtime-config-v1';
}
async function persist(observation: SlippageObservation): Promise<void> {
  const eventId = `slippage:${createHash('sha256').update(JSON.stringify(observation)).digest('hex')}`;
  await pool.query(
    `insert into private.cryptara_metric_samples (
      event_id, observed_at, metric_name, metric_value, provider, strategy, pair, chain,
      timing_bucket, cost_bucket, competition_bucket, model_version, config_version,
      provenance, source_event_ids, payload
    ) values ($1,to_timestamp($2/1000.0),'realized_residual_slippage_bps',$3,$4,'cex_cex',$5,'cex',$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
    on conflict (event_id) do nothing`,
    [eventId, observation.observedAt, residual(observation), observation.venuePair, observation.symbol,
      observation.timeBucket, observation.sizeBucket, observation.volatilityBucket, MODEL_VERSION, configVersion(),
      ['terminal_settlement_only','measured_slippage','advisory_calibration'], [observation.sourceEventId],
      JSON.stringify({ expectedDepthSlippageBps: observation.expectedDepthSlippageBps, realizedSlippageBps: observation.realizedSlippageBps, partialFill: observation.partialFill, regimeVersion })],
  );
}

export function observeSlippageCalibration(observation: SlippageObservation): void {
  if (!observation.venuePair.trim() || !observation.symbol.trim() || !observation.sourceEventId.trim()) return;
  if (!Number.isFinite(observation.observedAt) || observation.observedAt <= 0) return;
  const expected = finiteNonNegative(observation.expectedDepthSlippageBps);
  const realized = finiteNonNegative(observation.realizedSlippageBps);
  if (expected === null || realized === null) return;
  const normalized: SlippageObservation = { ...observation, expectedDepthSlippageBps: expected, realizedSlippageBps: realized };
  const recentResiduals = current().map(residual);
  if (recentResiduals.length >= MIN_SAMPLES) {
    const p95 = Math.max(0.01, percentile(recentResiduals, 0.95));
    if (residual(normalized) > p95 * REGIME_RESET_MULTIPLIER) {
      regimeCounter += 1;
      regimeVersion = `regime:${regimeCounter}:${normalized.observedAt}`;
      observations.length = 0;
      logger.warn('[SlippageCalibration] regime change invalidated prior residual curve', {
        component: 'SlippageCalibrationStore', venuePair: normalized.venuePair, symbol: normalized.symbol,
        residualSlippageBps: residual(normalized), previousP95Bps: p95, regimeVersion,
      });
    }
  }
  observations.push(normalized);
  if (observations.length > MAX_OBSERVATIONS) observations.splice(0, observations.length - MAX_OBSERVATIONS);
  void persist(normalized).catch(error => logger.warn('[SlippageCalibration] durable metric persistence degraded', {
    component: 'SlippageCalibrationStore', error: error instanceof Error ? error.message : String(error), executionBlocked: false,
  }));
}

export function estimateResidualSlippage(key: SlippageCalibrationKey, now = Date.now()): SlippageCalibrationEstimate {
  const pool = current(now);
  const exact = pool.filter(item => matchesExact(item, key));
  const bySize = pool.filter(item => item.venuePair === key.venuePair && item.symbol === key.symbol && item.sizeBucket === key.sizeBucket);
  const byPair = pool.filter(item => item.venuePair === key.venuePair && item.symbol === key.symbol);
  const tiers: Array<[SlippageCalibrationEstimate['source'], SlippageObservation[]]> = [['exact', exact], ['pair_symbol_size', bySize], ['pair_symbol', byPair], ['global', pool]];
  for (const [source, values] of tiers) {
    if (values.length < MIN_SAMPLES) continue;
    const latest = values.reduce((max, item) => Math.max(max, item.observedAt), 0);
    return { residualSlippageBps: percentile(values.map(residual), 0.90), samples: values.length, source, regimeVersion, observedAt: latest, advisoryOnly: true };
  }
  const fallback = Math.max(0, Number(process.env.CRYPTO_SLIPPAGE_RESIDUAL_FALLBACK_BPS || 10));
  return { residualSlippageBps: fallback, samples: pool.length, source: 'conservative_fallback', regimeVersion, observedAt: null, advisoryOnly: true };
}

export function slippageSizeBucket(notionalUsd: number): string {
  if (notionalUsd < 50) return 'lt50';
  if (notionalUsd < 100) return '50_100';
  if (notionalUsd < 250) return '100_250';
  if (notionalUsd < 500) return '250_500';
  if (notionalUsd < 1_000) return '500_1000';
  if (notionalUsd < 5_000) return '1000_5000';
  return 'gte5000';
}
export function slippageTimeBucket(timestamp = Date.now()): string {
  const hour = new Date(timestamp).getUTCHours();
  return hour < 6 ? 'utc_00_06' : hour < 12 ? 'utc_06_12' : hour < 18 ? 'utc_12_18' : 'utc_18_24';
}
export function getSlippageCalibrationHealth() {
  const active = current();
  return { modelVersion: MODEL_VERSION, regimeVersion, samples: active.length, minSamples: MIN_SAMPLES, maxAgeMs: MAX_AGE_MS, calibratedFromTerminalSettlementOnly: true as const, deterministicEconomicsInput: true as const, monteCarloInput: true as const, fabricatedSamplesAllowed: false as const };
}
