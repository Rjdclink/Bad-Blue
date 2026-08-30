import type { ExecutionOutcomeObservation } from './execution-outcome.js';

export interface SettlementProfitCalibrationSnapshot {
  terminalSamples: number;
  meanAbsoluteProfitErrorUsd: number | null;
  meanSignedProfitErrorUsd: number | null;
  medianAbsoluteProfitErrorUsd: number | null;
  p90AbsoluteProfitErrorUsd: number | null;
  p95AbsoluteProfitErrorUsd: number | null;
  p90OverestimateUsd: number | null;
  p95OverestimateUsd: number | null;
  calibrationConfidence: number;
  stableCalibrationSampleTarget: number;
  recommendedConservativeProfitReserveUsd: number | null;
  confidenceWeightedProfitReserveUsd: number | null;
  overestimateRate: number | null;
  downsideTailSampleFraction: number | null;
  downsideTailSamples: number;
  lastObservedAt: number | null;
  authority: 'learning_only';
  executionAuthority: false;
}

export interface SettlementProfitCalibrationFilter {
  chain?: string;
  symbol?: string;
  strategy?: string;
}

type CalibrationSample = {
  at: number;
  errorUsd: number;
  chain: string;
  symbol: string;
  strategy: string;
};

const MAX_SAMPLES = Math.max(32, Math.min(4096, Number(process.env.CRYPTOCRAWL_SETTLEMENT_CALIBRATION_SAMPLES || 512)));
const STABLE_SAMPLE_TARGET = Math.max(8, Math.min(256, Number(process.env.CRYPTOCRAWL_SETTLEMENT_CALIBRATION_STABLE_SAMPLES || 32)));
const samples: CalibrationSample[] = [];

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction)))];
}

function terminalRealized(outcome: ExecutionOutcomeObservation): number | null {
  if (!outcome.settlement?.terminal || !outcome.settlement.settlementConfirmed) return null;
  const realized = outcome.settlement.realizedProfitUsd ?? outcome.realizedProfitUsd;
  return realized !== null && Number.isFinite(realized) ? Number(realized) : null;
}

function normalize(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function selectSamples(filter: SettlementProfitCalibrationFilter = {}): CalibrationSample[] {
  const chain = normalize(filter.chain);
  const symbol = normalize(filter.symbol);
  const strategy = normalize(filter.strategy);
  return samples.filter(sample =>
    (!chain || sample.chain === chain)
    && (!symbol || sample.symbol === symbol)
    && (!strategy || sample.strategy === strategy),
  );
}

export function recordSettlementProfitCalibration(outcome: ExecutionOutcomeObservation): void {
  const realized = terminalRealized(outcome);
  if (realized === null || !Number.isFinite(outcome.expectedProfitUsd)) return;
  samples.push({
    at: outcome.timestamp,
    errorUsd: realized - outcome.expectedProfitUsd,
    chain: normalize(outcome.chain) || 'unknown',
    symbol: normalize(outcome.symbol) || 'unknown',
    strategy: normalize(outcome.strategy) || 'unknown',
  });
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
}

export function getSettlementProfitCalibrationSnapshot(
  filter: SettlementProfitCalibrationFilter = {},
): SettlementProfitCalibrationSnapshot {
  const selected = selectSamples(filter);
  const calibrationConfidence = Math.max(0, Math.min(1, selected.length / STABLE_SAMPLE_TARGET));
  if (selected.length === 0) {
    return {
      terminalSamples: 0,
      meanAbsoluteProfitErrorUsd: null,
      meanSignedProfitErrorUsd: null,
      medianAbsoluteProfitErrorUsd: null,
      p90AbsoluteProfitErrorUsd: null,
      p95AbsoluteProfitErrorUsd: null,
      p90OverestimateUsd: null,
      p95OverestimateUsd: null,
      calibrationConfidence,
      stableCalibrationSampleTarget: STABLE_SAMPLE_TARGET,
      recommendedConservativeProfitReserveUsd: null,
      confidenceWeightedProfitReserveUsd: null,
      overestimateRate: null,
      downsideTailSampleFraction: null,
      downsideTailSamples: 0,
      lastObservedAt: null,
      authority: 'learning_only',
      executionAuthority: false,
    };
  }
  const signed = selected.reduce((sum, sample) => sum + sample.errorUsd, 0) / selected.length;
  const absoluteErrors = selected.map(sample => Math.abs(sample.errorUsd));
  const absolute = absoluteErrors.reduce((sum, value) => sum + value, 0) / absoluteErrors.length;
  const overestimateMagnitudes = selected.filter(sample => sample.errorUsd < 0).map(sample => Math.abs(sample.errorUsd));
  const p90OverestimateUsd = percentile(overestimateMagnitudes, 0.9);
  const p95OverestimateUsd = percentile(overestimateMagnitudes, 0.95);
  const p90AbsoluteProfitErrorUsd = percentile(absoluteErrors, 0.9);
  const p95AbsoluteProfitErrorUsd = percentile(absoluteErrors, 0.95);
  const reserve = Math.max(0, p95OverestimateUsd ?? 0, p90AbsoluteProfitErrorUsd ?? 0, signed < 0 ? Math.abs(signed) : 0);
  const confidenceWeightedReserve = reserve * Math.max(0.25, calibrationConfidence);
  const downsideTailSampleFraction = overestimateMagnitudes.length / selected.length;
  return {
    terminalSamples: selected.length,
    meanAbsoluteProfitErrorUsd: Number(absolute.toFixed(8)),
    meanSignedProfitErrorUsd: Number(signed.toFixed(8)),
    medianAbsoluteProfitErrorUsd: percentile(absoluteErrors, 0.5),
    p90AbsoluteProfitErrorUsd,
    p95AbsoluteProfitErrorUsd,
    p90OverestimateUsd,
    p95OverestimateUsd,
    calibrationConfidence: Number(calibrationConfidence.toFixed(6)),
    stableCalibrationSampleTarget: STABLE_SAMPLE_TARGET,
    recommendedConservativeProfitReserveUsd: Number(reserve.toFixed(8)),
    confidenceWeightedProfitReserveUsd: Number(confidenceWeightedReserve.toFixed(8)),
    overestimateRate: Number(downsideTailSampleFraction.toFixed(6)),
    downsideTailSampleFraction: Number(downsideTailSampleFraction.toFixed(6)),
    downsideTailSamples: overestimateMagnitudes.length,
    lastObservedAt: selected[selected.length - 1]?.at ?? null,
    authority: 'learning_only',
    executionAuthority: false,
  };
}
