import { createHash } from 'node:crypto';
import logger from '../../../logger.js';
import type { MeasuredCandidate, MeasuredOpportunityTopology } from '../discovery/measured-candidate-registry.js';

export type PredictiveCainKind = 'spread_formation' | 'funding_dislocation' | 'liquidity_deterioration' | 'liquidation_window';
export type PredictionOutcome = 'pending' | 'true_positive' | 'false_positive' | 'true_negative' | 'false_negative';

export interface PredictiveCainFeatures {
  venueCount: number;
  chainCount: number;
  quoteCount: number;
  quoteFreshness: number;
  measuredDepth: number;
  preliminarySpreadBps: number;
  missingInformationPressure: number;
  executableCapability: number;
}

export interface PredictedLuxPreparationRecord {
  predictionId: string;
  opportunityId: string;
  kind: PredictiveCainKind;
  topology: MeasuredOpportunityTopology;
  regime: string;
  probability: number;
  threshold: number;
  predictedPositive: boolean;
  observedAt: number;
  expiresAt: number;
  assets: string[];
  venues: string[];
  chains: string[];
  features: PredictiveCainFeatures;
  provenance: string[];
  outcome: PredictionOutcome;
  authoritative: false;
  deterministicPositive: false;
  executable: false;
}

interface OnlineModel {
  weights: number[];
  bias: number;
  samples: number;
}
interface RegimeMetrics {
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
}

const FEATURE_COUNT = 8;
const LEARNING_RATE = Math.max(0.0001, Math.min(0.05, Number(process.env.PREDICTIVE_CAIN_LEARNING_RATE || 0.01)));
const MAX_RECORDS = Math.max(128, Math.min(10_000, Number(process.env.PREDICTIVE_CAIN_MAX_RECORDS || 2048)));
const DEFAULT_THRESHOLD = Math.max(0.5, Math.min(0.95, Number(process.env.PREDICTIVE_CAIN_THRESHOLD || 0.68)));

function sigmoid(value: number): number {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exp = Math.exp(value);
  return exp / (1 + exp);
}
function clamp(value: number, min = 0, max = 1): number { return Math.max(min, Math.min(max, value)); }
function safeBps(bid: number, ask: number): number {
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return 0;
  return ((bid - ask) / ask) * 10_000;
}
function preliminarySpreadBps(candidate: MeasuredCandidate): number {
  const bids = candidate.rawQuotes.map(quote => quote.bid).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  const asks = candidate.rawQuotes.map(quote => quote.ask).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  if (!bids.length || !asks.length) return 0;
  return Math.max(-500, Math.min(500, safeBps(Math.max(...bids), Math.min(...asks))));
}
function features(candidate: MeasuredCandidate, now = Date.now()): PredictiveCainFeatures {
  const quoteAge = candidate.quoteAgeMs ?? Math.max(0, now - candidate.observedAt);
  const horizon = Math.max(500, candidate.expiresAt - candidate.observedAt);
  return {
    venueCount: clamp(candidate.venues.length / 4),
    chainCount: clamp(candidate.chains.length / 4),
    quoteCount: clamp(candidate.rawQuotes.length / 8),
    quoteFreshness: clamp(1 - quoteAge / horizon),
    measuredDepth: candidate.depth.status === 'measured' ? 1 : 0,
    preliminarySpreadBps: clamp((preliminarySpreadBps(candidate) + 100) / 200),
    missingInformationPressure: clamp(candidate.missingInformation.length / 8),
    executableCapability: candidate.executableCapability ? 1 : 0,
  };
}
function vector(value: PredictiveCainFeatures): number[] {
  return [value.venueCount, value.chainCount, value.quoteCount, value.quoteFreshness, value.measuredDepth, value.preliminarySpreadBps, value.missingInformationPressure, value.executableCapability];
}
function predictionKind(topology: MeasuredOpportunityTopology): PredictiveCainKind {
  if (topology === 'FUNDING_ARBITRAGE') return 'funding_dislocation';
  if (topology === 'MEMPOOL_BACKRUN' || topology === 'ZERO_CAPITAL_ATOMIC') return 'liquidation_window';
  if (topology === 'DEX_ATOMIC' || topology === 'CROSS_CHAIN') return 'liquidity_deterioration';
  return 'spread_formation';
}
function regime(candidate: MeasuredCandidate): string {
  const freshness = candidate.quoteAgeMs === null ? 'unknown_age' : candidate.quoteAgeMs <= 1_000 ? 'fresh' : candidate.quoteAgeMs <= 5_000 ? 'aging' : 'stale';
  const depth = candidate.depth.status;
  return `${candidate.topology}:${freshness}:${depth}`;
}
function idFor(candidate: MeasuredCandidate): string {
  const digest = createHash('sha256').update(`${candidate.opportunityId}:${candidate.observedAt}:${candidate.topology}`).digest('hex').slice(0, 24);
  return `predicted-cain:${digest}`;
}
function clone(record: PredictedLuxPreparationRecord): PredictedLuxPreparationRecord {
  return { ...record, assets: [...record.assets], venues: [...record.venues], chains: [...record.chains], features: { ...record.features }, provenance: [...record.provenance] };
}

class PredictiveCainPreparationEngine {
  private readonly models = new Map<string, OnlineModel>();
  private readonly records = new Map<string, PredictedLuxPreparationRecord>();
  private readonly opportunityToPrediction = new Map<string, string>();
  private readonly metrics = new Map<string, RegimeMetrics>();

  observe(candidate: MeasuredCandidate): PredictedLuxPreparationRecord | null {
    if (!['observed', 'enriched'].includes(candidate.status)) {
      this.reconcile(candidate);
      return null;
    }
    const existingId = this.opportunityToPrediction.get(candidate.opportunityId);
    if (existingId) return this.records.get(existingId) ? clone(this.records.get(existingId)!) : null;

    const featureSet = features(candidate);
    const key = regime(candidate);
    const model = this.model(key);
    const values = vector(featureSet);
    const logit = model.bias + values.reduce((sum, value, index) => sum + value * model.weights[index], 0);
    const probability = clamp(sigmoid(logit));
    const threshold = DEFAULT_THRESHOLD;
    const record: PredictedLuxPreparationRecord = {
      predictionId: idFor(candidate),
      opportunityId: candidate.opportunityId,
      kind: predictionKind(candidate.topology),
      topology: candidate.topology,
      regime: key,
      probability,
      threshold,
      predictedPositive: probability >= threshold,
      observedAt: Date.now(),
      expiresAt: candidate.expiresAt,
      assets: [...candidate.assets],
      venues: [...candidate.venues],
      chains: [...candidate.chains],
      features: featureSet,
      provenance: [...new Set([...candidate.provenance, 'predictive_cain', 'lux_predicted_preparation_stream', 'advisory_only'])],
      outcome: 'pending',
      authoritative: false,
      deterministicPositive: false,
      executable: false,
    };
    this.records.set(record.predictionId, record);
    this.opportunityToPrediction.set(candidate.opportunityId, record.predictionId);
    this.prune();
    return clone(record);
  }

  reconcile(candidate: MeasuredCandidate): PredictionOutcome | null {
    const predictionId = this.opportunityToPrediction.get(candidate.opportunityId);
    if (!predictionId) return null;
    const record = this.records.get(predictionId);
    if (!record || record.outcome !== 'pending') return record?.outcome ?? null;
    const deterministicPositive = candidate.status === 'deterministic_positive'
      || candidate.status === 'eligible'
      || (typeof candidate.economics.deterministicNetProfitUsd === 'number' && Number.isFinite(candidate.economics.deterministicNetProfitUsd) && candidate.economics.deterministicNetProfitUsd > 0);
    const terminalForPrediction = deterministicPositive || candidate.status === 'blocked' || candidate.status === 'expired' || candidate.expiresAt < Date.now();
    if (!terminalForPrediction) return null;

    const outcome: PredictionOutcome = record.predictedPositive
      ? deterministicPositive ? 'true_positive' : 'false_positive'
      : deterministicPositive ? 'false_negative' : 'true_negative';
    record.outcome = outcome;
    this.updateMetrics(record.regime, outcome);
    this.learn(record, deterministicPositive ? 1 : 0);
    return outcome;
  }

  getPreparationRecords(limit = 128): PredictedLuxPreparationRecord[] {
    const now = Date.now();
    return [...this.records.values()]
      .filter(record => record.expiresAt >= now && record.outcome === 'pending' && record.predictedPositive)
      .sort((left, right) => right.probability - left.probability || right.observedAt - left.observedAt)
      .slice(0, Math.max(1, Math.min(1024, limit)))
      .map(clone);
  }

  getMetrics() {
    const byRegime = [...this.metrics.entries()].map(([regimeKey, value]) => {
      const positivePredictions = value.truePositive + value.falsePositive;
      const actualPositives = value.truePositive + value.falseNegative;
      return {
        regime: regimeKey,
        ...value,
        precision: positivePredictions > 0 ? value.truePositive / positivePredictions : null,
        recall: actualPositives > 0 ? value.truePositive / actualPositives : null,
      };
    });
    return {
      records: this.records.size,
      pendingPreparation: this.getPreparationRecords(4096).length,
      models: this.models.size,
      byRegime,
      predictionAuthority: 'advisory_preparation_only' as const,
      executionAuthority: false as const,
      deterministicPositiveAuthority: false as const,
      verifiedOpportunitySuppressionAllowed: false as const,
    };
  }

  private model(key: string): OnlineModel {
    let model = this.models.get(key);
    if (!model) {
      model = { weights: Array(FEATURE_COUNT).fill(0), bias: 0, samples: 0 };
      this.models.set(key, model);
    }
    return model;
  }

  private learn(record: PredictedLuxPreparationRecord, label: 0 | 1): void {
    const model = this.model(record.regime);
    const values = vector(record.features);
    const predicted = sigmoid(model.bias + values.reduce((sum, value, index) => sum + value * model.weights[index], 0));
    const error = label - predicted;
    model.bias = Math.max(-6, Math.min(6, model.bias + LEARNING_RATE * error));
    model.weights = model.weights.map((weight, index) => Math.max(-6, Math.min(6, weight + LEARNING_RATE * error * values[index])));
    model.samples++;
  }

  private updateMetrics(key: string, outcome: PredictionOutcome): void {
    const metric = this.metrics.get(key) || { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 };
    if (outcome === 'true_positive') metric.truePositive++;
    if (outcome === 'false_positive') metric.falsePositive++;
    if (outcome === 'true_negative') metric.trueNegative++;
    if (outcome === 'false_negative') metric.falseNegative++;
    this.metrics.set(key, metric);
  }

  private prune(): void {
    if (this.records.size <= MAX_RECORDS) return;
    const oldest = [...this.records.values()].sort((left, right) => left.observedAt - right.observedAt);
    for (let index = 0; index < oldest.length - MAX_RECORDS; index++) {
      const record = oldest[index];
      this.records.delete(record.predictionId);
      if (this.opportunityToPrediction.get(record.opportunityId) === record.predictionId) this.opportunityToPrediction.delete(record.opportunityId);
    }
  }
}

export const predictiveCainPreparation = new PredictiveCainPreparationEngine();

logger.info('[PredictiveCain] advisory preparation engine available', {
  component: 'PredictiveCainPreparation',
  productionRole: 'advisory_prioritization_and_prewarming',
  executionAuthority: false,
  deterministicPositiveAuthority: false,
});
