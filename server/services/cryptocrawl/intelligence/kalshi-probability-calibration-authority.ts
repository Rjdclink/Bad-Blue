import { createHash } from 'node:crypto';
import logger from '../../../logger.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import { getKalshiApiOrigin } from './kalshi-authenticated-authority.js';
import type { KalshiPredictionIntelligenceSnapshot, KalshiPredictionMarketSignal } from './kalshi-prediction-market-authority.js';

const OBS_TABLE = 'private.cryptocrawler_kalshi_probability_observations';
const MODEL_TABLE = 'private.cryptocrawler_kalshi_probability_models';
const EPS = 1e-6;

export interface KalshiProbabilityCalibration {
  ticker: string;
  asset: string | null;
  category: string;
  liquidityRegime: string;
  rawProbability: number;
  calibratedProbability: number;
  sampleCount: number;
  holdoutCount: number;
  brierScore: number;
  logLoss: number;
  confidenceInterval95: [number, number];
  modelKey: string;
  observedAt: number;
  trainedThrough: number;
  driftDetected: boolean;
  authorityEnabled: true;
  provenance: string[];
}

export interface KalshiCalibrationCycleResult {
  observed: number;
  labelsAttached: number;
  modelsEvaluated: number;
  authorityModels: number;
  unresolved: number;
  errors: number;
  completedAt: number;
  executionAuthority: false;
}

type ResolvedRow = {
  observationId: string;
  ticker: string;
  eventTicker: string;
  asset: string | null;
  category: string;
  liquidityRegime: string;
  rulesFingerprint: string;
  impliedProbability: number;
  observedAt: number;
  resolvedLabel: 0 | 1;
  resolvedAt: number;
};

type HistogramModel = {
  bins: Array<{ lower: number; upper: number; calibrated: number; n: number }>;
  fallback: number;
  confidenceHalfWidth95: number;
};

type StoredModel = {
  modelKey: string;
  asset: string | null;
  category: string;
  liquidityRegime: string;
  sampleCount: number;
  holdoutCount: number;
  rawBrierScore: number | null;
  calibratedBrierScore: number | null;
  rawLogLoss: number | null;
  calibratedLogLoss: number | null;
  recentBrierScore: number | null;
  priorBrierScore: number | null;
  driftDetected: boolean;
  authorityEnabled: boolean;
  model: HistogramModel;
  trainedThrough: number | null;
  evaluatedAt: number;
};

let latestCycle: KalshiCalibrationCycleResult = {
  observed: 0,
  labelsAttached: 0,
  modelsEvaluated: 0,
  authorityModels: 0,
  unresolved: 0,
  errors: 0,
  completedAt: 0,
  executionAuthority: false,
};
let cycleInFlight: Promise<KalshiCalibrationCycleResult> | null = null;

function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : fallback;
}
function boundedNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
function minSamples(): number { return boundedInt(process.env.CRYPTOCRAWL_KALSHI_CALIBRATION_MIN_SAMPLES, 100, 40, 100_000); }
function minHoldout(): number { return boundedInt(process.env.CRYPTOCRAWL_KALSHI_CALIBRATION_MIN_HOLDOUT, 25, 10, 20_000); }
function modelFreshnessMs(): number { return boundedInt(process.env.CRYPTOCRAWL_KALSHI_CALIBRATION_MODEL_MAX_AGE_MS, 6 * 60 * 60_000, 60_000, 7 * 24 * 60 * 60_000); }
function maxBrier(): number { return boundedNumber(process.env.CRYPTOCRAWL_KALSHI_CALIBRATION_MAX_BRIER, 0.24, 0.01, 0.5); }
function maxLogLoss(): number { return boundedNumber(process.env.CRYPTOCRAWL_KALSHI_CALIBRATION_MAX_LOG_LOSS, 0.69, 0.05, 5); }
function driftTolerance(): number { return boundedNumber(process.env.CRYPTOCRAWL_KALSHI_CALIBRATION_DRIFT_BRIER_DELTA, 0.04, 0.005, 0.5); }
function observationBucketMs(): number { return boundedInt(process.env.CRYPTOCRAWL_KALSHI_CALIBRATION_OBSERVATION_BUCKET_MS, 60_000, 10_000, 60 * 60_000); }
function maxResolvePerCycle(): number { return boundedInt(process.env.CRYPTOCRAWL_KALSHI_CALIBRATION_RESOLVE_LIMIT, 64, 1, 500); }

function clampProbability(value: number): number { return Math.max(EPS, Math.min(1 - EPS, value)); }
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function categoryFor(signal: KalshiPredictionMarketSignal): string {
  const material = `${signal.eventTicker} ${signal.title} ${signal.subtitle}`.toLowerCase();
  if (/price|above|below|between|higher|lower|bitcoin|ethereum|crypto|btc|eth/.test(material)) return 'crypto_price';
  if (/rate|fed|interest|yield/.test(material)) return 'rates_macro';
  if (/inflation|cpi|jobs|payroll|gdp|econom/.test(material)) return 'macro_data';
  if (/election|president|senate|house|vote|politic/.test(material)) return 'politics';
  return 'other';
}
function liquidityRegimeFor(signal: KalshiPredictionMarketSignal): string {
  const liquidity = Number(signal.liquidityUsd ?? 0);
  const volume = Number(signal.volume24h ?? 0);
  const activity = Math.max(liquidity, volume);
  if (activity >= 100_000) return 'high';
  if (activity >= 10_000) return 'medium';
  return 'low';
}
function cutoffFor(signal: KalshiPredictionMarketSignal, observedAt: number): number {
  const candidates = [signal.expectedExpirationAt, signal.occurrenceAt].filter((v): v is number => Number.isFinite(v) && Number(v) > observedAt);
  return candidates.length ? Math.min(...candidates) : observedAt + 24 * 60 * 60_000;
}
function observationId(signal: KalshiPredictionMarketSignal, observedAt: number): string {
  const bucket = Math.floor(observedAt / observationBucketMs()) * observationBucketMs();
  return `kalshi-prob:${hash(`${signal.eventTicker}|${signal.rulesFingerprint}|${signal.ticker}|${bucket}`).slice(0, 40)}`;
}
function modelKey(asset: string | null, category: string, liquidityRegime: string): string {
  return `${asset || 'ALL'}:${category}:${liquidityRegime}`;
}
function brier(rows: Array<{ p: number; y: number }>): number | null {
  if (!rows.length) return null;
  return rows.reduce((sum, row) => sum + (row.p - row.y) ** 2, 0) / rows.length;
}
function logLoss(rows: Array<{ p: number; y: number }>): number | null {
  if (!rows.length) return null;
  return -rows.reduce((sum, row) => {
    const p = clampProbability(row.p);
    return sum + row.y * Math.log(p) + (1 - row.y) * Math.log(1 - p);
  }, 0) / rows.length;
}
function confidenceHalfWidth(rows: Array<{ p: number; y: number }>): number {
  if (rows.length < 2) return 1;
  const losses = rows.map(row => (row.p - row.y) ** 2);
  const mean = losses.reduce((a, b) => a + b, 0) / losses.length;
  const variance = losses.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (losses.length - 1);
  return 1.96 * Math.sqrt(Math.max(0, variance) / losses.length);
}

function fitHistogram(rows: ResolvedRow[]): HistogramModel {
  const binsCount = Math.max(5, Math.min(20, Math.round(Math.sqrt(rows.length))));
  const bins: HistogramModel['bins'] = [];
  for (let index = 0; index < binsCount; index++) {
    const lower = index / binsCount;
    const upper = (index + 1) / binsCount;
    const members = rows.filter(row => row.impliedProbability >= lower && (index === binsCount - 1 ? row.impliedProbability <= upper : row.impliedProbability < upper));
    const positives = members.reduce((sum, row) => sum + row.resolvedLabel, 0);
    const calibrated = (positives + 1) / (members.length + 2);
    bins.push({ lower, upper, calibrated, n: members.length });
  }
  const totalPositive = rows.reduce((sum, row) => sum + row.resolvedLabel, 0);
  const fallback = (totalPositive + 1) / (rows.length + 2);
  return { bins, fallback, confidenceHalfWidth95: 1 };
}
function applyModel(model: HistogramModel, probability: number): number {
  const p = Math.max(0, Math.min(1, probability));
  const bin = model.bins.find((candidate, index) => p >= candidate.lower && (index === model.bins.length - 1 ? p <= candidate.upper : p < candidate.upper));
  if (!bin || bin.n < 3) return model.fallback;
  return clampProbability(bin.calibrated);
}

async function publicJson<T>(path: string): Promise<T | null> {
  const response = await fetch(`${getKalshiApiOrigin()}${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Kalshi calibration market read failed HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function terminalMarket(ticker: string): Promise<{ label: 0 | 1; resolvedAt: number; source: string } | null> {
  const encoded = encodeURIComponent(ticker);
  const live = await publicJson<any>(`/trade-api/v2/markets/${encoded}`).catch(() => null);
  const liveMarket = live?.market;
  const liveResult = String(liveMarket?.result || liveMarket?.market_result || '').toLowerCase();
  if (liveResult === 'yes' || liveResult === 'no') {
    const settled = Date.parse(String(liveMarket?.settlement_ts || liveMarket?.updated_time || ''));
    return { label: liveResult === 'yes' ? 1 : 0, resolvedAt: Number.isFinite(settled) ? settled : Date.now(), source: 'kalshi_live_market_terminal' };
  }
  const historical = await publicJson<any>(`/trade-api/v2/historical/markets/${encoded}`).catch(() => null);
  const market = historical?.market;
  const result = String(market?.result || market?.market_result || '').toLowerCase();
  if (result !== 'yes' && result !== 'no') return null;
  const settled = Date.parse(String(market?.settlement_ts || market?.updated_time || ''));
  return { label: result === 'yes' ? 1 : 0, resolvedAt: Number.isFinite(settled) ? settled : Date.now(), source: 'kalshi_historical_market_terminal' };
}

export async function persistKalshiProbabilityObservations(snapshot: KalshiPredictionIntelligenceSnapshot): Promise<number> {
  let inserted = 0;
  for (const signal of snapshot.markets) {
    if (signal.impliedProbability === null || !(signal.impliedProbability >= 0) || !(signal.impliedProbability <= 1)) continue;
    if (!signal.rulesFingerprint || !signal.eventTicker || !signal.ticker) continue;
    const observedAt = signal.observedAt;
    const id = observationId(signal, observedAt);
    const result = await pool.query(
      `INSERT INTO ${OBS_TABLE} (
         observation_id,ticker,event_ticker,asset,category,liquidity_regime,rules_fingerprint,
         implied_probability,observed_at,cutoff_at,provenance
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9/1000.0),to_timestamp($10/1000.0),$11::jsonb)
       ON CONFLICT DO NOTHING`,
      [id, signal.ticker, signal.eventTicker, signal.asset, categoryFor(signal), liquidityRegimeFor(signal), signal.rulesFingerprint,
        signal.impliedProbability, observedAt, cutoffFor(signal, observedAt), JSON.stringify([...signal.provenance, 'kalshi_calibration:prediction_recorded_before_resolution'])],
    );
    inserted += result.rowCount || 0;
  }
  return inserted;
}

async function attachResolvedLabels(): Promise<number> {
  const due = await pool.query(
    `SELECT observation_id,ticker,extract(epoch from observed_at)*1000 AS observed_at
     FROM ${OBS_TABLE}
     WHERE resolved_label IS NULL AND cutoff_at <= now()
     ORDER BY cutoff_at ASC LIMIT $1`,
    [maxResolvePerCycle()],
  );
  let attached = 0;
  const terminalCache = new Map<string, Awaited<ReturnType<typeof terminalMarket>>>();
  for (const row of due.rows) {
    const ticker = String(row.ticker);
    let terminal = terminalCache.get(ticker);
    if (terminal === undefined) {
      terminal = await terminalMarket(ticker);
      terminalCache.set(ticker, terminal);
    }
    if (!terminal) continue;
    const observedAt = Number(row.observed_at);
    if (!(terminal.resolvedAt >= observedAt)) continue;
    const result = await pool.query(
      `UPDATE ${OBS_TABLE}
       SET resolved_label=$2,resolved_at=to_timestamp($3/1000.0),resolution_source=$4,
           provenance=provenance || $5::jsonb,updated_at=now()
       WHERE observation_id=$1 AND resolved_label IS NULL`,
      [String(row.observation_id), terminal.label, terminal.resolvedAt, terminal.source, JSON.stringify(['kalshi_calibration:terminal_label_attached_after_resolution'])],
    );
    attached += result.rowCount || 0;
  }
  return attached;
}

async function loadResolved(): Promise<ResolvedRow[]> {
  const lookbackDays = boundedInt(process.env.CRYPTOCRAWL_KALSHI_CALIBRATION_LOOKBACK_DAYS, 365, 30, 3650);
  const result = await pool.query(
    `SELECT observation_id,ticker,event_ticker,asset,category,liquidity_regime,rules_fingerprint,implied_probability,
            extract(epoch from observed_at)*1000 AS observed_at,resolved_label,extract(epoch from resolved_at)*1000 AS resolved_at
     FROM ${OBS_TABLE}
     WHERE resolved_label IS NOT NULL AND resolved_at >= now() - ($1::text || ' days')::interval
     ORDER BY observed_at ASC`,
    [String(lookbackDays)],
  );
  return result.rows.flatMap((row: any) => {
    const p = Number(row.implied_probability);
    const y = Number(row.resolved_label);
    if (!Number.isFinite(p) || (y !== 0 && y !== 1)) return [];
    return [{
      observationId: String(row.observation_id), ticker: String(row.ticker), eventTicker: String(row.event_ticker),
      asset: row.asset ? String(row.asset) : null, category: String(row.category), liquidityRegime: String(row.liquidity_regime),
      rulesFingerprint: String(row.rules_fingerprint), impliedProbability: p, observedAt: Number(row.observed_at),
      resolvedLabel: y as 0 | 1, resolvedAt: Number(row.resolved_at),
    }];
  });
}

function dedupeCorrelated(rows: ResolvedRow[]): ResolvedRow[] {
  const best = new Map<string, ResolvedRow>();
  for (const row of rows) {
    const key = `${row.eventTicker}|${row.rulesFingerprint}|${Math.floor(row.observedAt / observationBucketMs())}`;
    const prior = best.get(key);
    if (!prior || row.observedAt < prior.observedAt) best.set(key, row);
  }
  return [...best.values()].sort((a, b) => a.observedAt - b.observedAt);
}

async function evaluateModels(rowsInput: ResolvedRow[]): Promise<number> {
  const rows = dedupeCorrelated(rowsInput);
  const groups = new Map<string, ResolvedRow[]>();
  for (const row of rows) {
    const keys = [modelKey(row.asset, row.category, row.liquidityRegime), modelKey(null, row.category, row.liquidityRegime)];
    for (const key of keys) groups.set(key, [...(groups.get(key) || []), row]);
  }
  let authorityModels = 0;
  for (const [key, group] of groups) {
    if (group.length < minSamples()) continue;
    const holdoutCount = Math.max(minHoldout(), Math.floor(group.length * 0.2));
    if (group.length - holdoutCount < Math.max(20, Math.floor(minSamples() * 0.6))) continue;
    const training = group.slice(0, group.length - holdoutCount);
    const holdout = group.slice(group.length - holdoutCount);
    const model = fitHistogram(training);
    const raw = holdout.map(row => ({ p: row.impliedProbability, y: row.resolvedLabel }));
    const calibrated = holdout.map(row => ({ p: applyModel(model, row.impliedProbability), y: row.resolvedLabel }));
    const rawBrier = brier(raw);
    const calibratedBrier = brier(calibrated);
    const rawLL = logLoss(raw);
    const calibratedLL = logLoss(calibrated);
    const halfWidth = confidenceHalfWidth(calibrated);
    model.confidenceHalfWidth95 = halfWidth;
    const recentCount = Math.max(10, Math.floor(holdout.length / 2));
    const recent = calibrated.slice(-recentCount);
    const prior = calibrated.slice(0, Math.max(0, calibrated.length - recentCount));
    const recentBrier = brier(recent);
    const priorBrier = brier(prior);
    const driftDetected = recentBrier !== null && priorBrier !== null && recentBrier - priorBrier > driftTolerance();
    const noMaterialCalibrationRegression = calibratedBrier !== null && rawBrier !== null && calibratedBrier <= rawBrier + Math.max(0.005, halfWidth);
    const noMaterialLogRegression = calibratedLL !== null && rawLL !== null && calibratedLL <= rawLL + 0.02;
    const authorityEnabled = holdout.length >= minHoldout()
      && calibratedBrier !== null && calibratedBrier <= maxBrier()
      && calibratedLL !== null && calibratedLL <= maxLogLoss()
      && noMaterialCalibrationRegression && noMaterialLogRegression && !driftDetected;
    const [asset, category, liquidityRegime] = key.split(':');
    const fullModel = fitHistogram(group);
    fullModel.confidenceHalfWidth95 = halfWidth;
    await pool.query(
      `INSERT INTO ${MODEL_TABLE} (
         model_key,asset,category,liquidity_regime,sample_count,holdout_count,raw_brier_score,calibrated_brier_score,
         raw_log_loss,calibrated_log_loss,recent_brier_score,prior_brier_score,drift_detected,authority_enabled,model,
         trained_through,evaluated_at,updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,to_timestamp($16/1000.0),now(),now())
       ON CONFLICT (model_key) DO UPDATE SET asset=EXCLUDED.asset,category=EXCLUDED.category,liquidity_regime=EXCLUDED.liquidity_regime,
         sample_count=EXCLUDED.sample_count,holdout_count=EXCLUDED.holdout_count,raw_brier_score=EXCLUDED.raw_brier_score,
         calibrated_brier_score=EXCLUDED.calibrated_brier_score,raw_log_loss=EXCLUDED.raw_log_loss,calibrated_log_loss=EXCLUDED.calibrated_log_loss,
         recent_brier_score=EXCLUDED.recent_brier_score,prior_brier_score=EXCLUDED.prior_brier_score,drift_detected=EXCLUDED.drift_detected,
         authority_enabled=EXCLUDED.authority_enabled,model=EXCLUDED.model,trained_through=EXCLUDED.trained_through,evaluated_at=now(),updated_at=now()`,
      [key, asset === 'ALL' ? null : asset, category, liquidityRegime, group.length, holdout.length, rawBrier, calibratedBrier,
        rawLL, calibratedLL, recentBrier, priorBrier, driftDetected, authorityEnabled, JSON.stringify(fullModel), group[group.length - 1].observedAt],
    );
    if (authorityEnabled) authorityModels += 1;
  }
  return authorityModels;
}

function parseModel(row: any): StoredModel | null {
  const model = typeof row?.model === 'string' ? JSON.parse(row.model) : row?.model;
  if (!model || !Array.isArray(model.bins)) return null;
  return {
    modelKey: String(row.model_key), asset: row.asset ? String(row.asset) : null, category: String(row.category), liquidityRegime: String(row.liquidity_regime),
    sampleCount: Number(row.sample_count), holdoutCount: Number(row.holdout_count), rawBrierScore: row.raw_brier_score === null ? null : Number(row.raw_brier_score),
    calibratedBrierScore: row.calibrated_brier_score === null ? null : Number(row.calibrated_brier_score), rawLogLoss: row.raw_log_loss === null ? null : Number(row.raw_log_loss),
    calibratedLogLoss: row.calibrated_log_loss === null ? null : Number(row.calibrated_log_loss), recentBrierScore: row.recent_brier_score === null ? null : Number(row.recent_brier_score),
    priorBrierScore: row.prior_brier_score === null ? null : Number(row.prior_brier_score), driftDetected: row.drift_detected === true, authorityEnabled: row.authority_enabled === true,
    model: model as HistogramModel, trainedThrough: row.trained_through ? new Date(row.trained_through).getTime() : null, evaluatedAt: new Date(row.evaluated_at).getTime(),
  };
}

export async function getKalshiProbabilityCalibration(signal: KalshiPredictionMarketSignal): Promise<KalshiProbabilityCalibration | null> {
  if (signal.impliedProbability === null) return null;
  const category = categoryFor(signal);
  const liquidityRegime = liquidityRegimeFor(signal);
  const keys = [modelKey(signal.asset, category, liquidityRegime), modelKey(null, category, liquidityRegime)];
  const result = await pool.query(
    `SELECT * FROM ${MODEL_TABLE} WHERE model_key = ANY($1::text[]) AND authority_enabled=true ORDER BY (asset IS NOT NULL) DESC, sample_count DESC`,
    [keys],
  );
  const stored = result.rows.map(parseModel).find((row): row is StoredModel => row !== null);
  if (!stored || !stored.authorityEnabled || stored.driftDetected || stored.trainedThrough === null) return null;
  if (Date.now() - stored.evaluatedAt > modelFreshnessMs()) return null;
  if (stored.sampleCount < minSamples() || stored.holdoutCount < minHoldout()) return null;
  if (stored.calibratedBrierScore === null || stored.calibratedLogLoss === null) return null;
  const calibrated = applyModel(stored.model, signal.impliedProbability);
  const half = Math.max(0, Math.min(1, Number(stored.model.confidenceHalfWidth95 || 1)));
  return {
    ticker: signal.ticker, asset: signal.asset, category, liquidityRegime, rawProbability: signal.impliedProbability,
    calibratedProbability: calibrated, sampleCount: stored.sampleCount, holdoutCount: stored.holdoutCount,
    brierScore: stored.calibratedBrierScore, logLoss: stored.calibratedLogLoss,
    confidenceInterval95: [Math.max(0, calibrated - half), Math.min(1, calibrated + half)], modelKey: stored.modelKey,
    observedAt: stored.evaluatedAt, trainedThrough: stored.trainedThrough, driftDetected: false, authorityEnabled: true,
    provenance: ['kalshi_probability:terminal_labels_only', 'kalshi_probability:chronological_holdout', 'kalshi_probability:brier_and_log_loss',
      'kalshi_probability:correlated_event_deduplication', 'kalshi_probability:drift_gate_passed', 'kalshi_probability:authority_enabled'],
  };
}

export async function runKalshiProbabilityCalibrationCycle(snapshot: KalshiPredictionIntelligenceSnapshot): Promise<KalshiCalibrationCycleResult> {
  if (cycleInFlight) return cycleInFlight;
  cycleInFlight = (async () => {
    let errors = 0;
    let observed = 0;
    let labelsAttached = 0;
    let authorityModels = 0;
    try { observed = await persistKalshiProbabilityObservations(snapshot); } catch (error) { errors += 1; logger.debug('[KalshiCalibration] Observation persistence failed closed', { component: 'KalshiProbabilityCalibrationAuthority', error: error instanceof Error ? error.message : String(error) }); }
    try { labelsAttached = await attachResolvedLabels(); } catch (error) { errors += 1; logger.debug('[KalshiCalibration] Label collection failed closed', { component: 'KalshiProbabilityCalibrationAuthority', error: error instanceof Error ? error.message : String(error) }); }
    let modelsEvaluated = 0;
    try {
      const resolved = await loadResolved();
      authorityModels = await evaluateModels(resolved);
      modelsEvaluated = resolved.length >= minSamples() ? 1 : 0;
    } catch (error) { errors += 1; logger.debug('[KalshiCalibration] Model evaluation failed closed', { component: 'KalshiProbabilityCalibrationAuthority', error: error instanceof Error ? error.message : String(error) }); }
    const unresolvedResult = await pool.query(`SELECT count(*)::int AS count FROM ${OBS_TABLE} WHERE resolved_label IS NULL`).catch(() => ({ rows: [{ count: 0 }] }));
    latestCycle = { observed, labelsAttached, modelsEvaluated, authorityModels, unresolved: Number(unresolvedResult.rows?.[0]?.count || 0), errors, completedAt: Date.now(), executionAuthority: false };
    return { ...latestCycle };
  })().finally(() => { cycleInFlight = null; });
  return cycleInFlight;
}

export function getKalshiProbabilityCalibrationStatus(): KalshiCalibrationCycleResult {
  return { ...latestCycle };
}
