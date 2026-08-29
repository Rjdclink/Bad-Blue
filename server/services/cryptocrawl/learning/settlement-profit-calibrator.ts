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
  lastObservedAt: number | null;
  authority: 'learning_only';
  executionAuthority: false;
}

const MAX_SAMPLES = Math.max(32, Math.min(4096, Number(process.env.CRYPTOCRAWL_SETTLEMENT_CALIBRATION_SAMPLES || 512)));
const STABLE_SAMPLE_TARGET = Math.max(8, Math.min(256, Number(process.env.CRYPTOCRAWL_SETTLEMENT_CALIBRATION_STABLE_SAMPLES || 32)));
const samples: Array<{ at: number; errorUsd: number }> = [];

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

export function recordSettlementProfitCalibration(outcome: ExecutionOutcomeObservation): void {
  const realized = terminalRealized(outcome);
  if (realized === null || !Number.isFinite(outcome.expectedProfitUsd)) return;
  samples.push({ at: outcome.timestamp, errorUsd: realized - outcome.expectedProfitUsd });
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
}

export function getSettlementProfitCalibrationSnapshot(): SettlementProfitCalibrationSnapshot {
  const calibrationConfidence = Math.max(0, Math.min(1, samples.length / STABLE_SAMPLE_TARGET));
  if (samples.length === 0) {
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
      lastObservedAt: null,
      authority: 'learning_only',
      executionAuthority: false,
    };
  }
  const signed = samples.reduce((sum, sample) => sum + sample.errorUsd, 0) / samples.length;
  const absoluteErrors = samples.map(sample => Math.abs(sample.errorUsd));
  const absolute = absoluteErrors.reduce((sum, value) => sum + value, 0) / absoluteErrors.length;
  const overestimateMagnitudes = samples.filter(sample => sample.errorUsd < 0).map(sample => Math.abs(sample.errorUsd));
  const p90OverestimateUsd = percentile(overestimateMagnitudes, 0.9);
  const p95OverestimateUsd = percentile(overestimateMagnitudes, 0.95);
  const p90AbsoluteProfitErrorUsd = percentile(absoluteErrors, 0.9);
  const p95AbsoluteProfitErrorUsd = percentile(absoluteErrors, 0.95);
  const reserve = Math.max(0, p95OverestimateUsd ?? 0, p90AbsoluteProfitErrorUsd ?? 0, signed < 0 ? Math.abs(signed) : 0);
  const confidenceWeightedReserve = reserve * Math.max(0.25, calibrationConfidence);
  return {
    terminalSamples: samples.length,
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
    overestimateRate: Number((overestimateMagnitudes.length / samples.length).toFixed(6)),
    downsideTailSampleFraction: Number((overestimateMagnitudes.length / samples.length).toFixed(6)),
    lastObservedAt: samples[samples.length - 1]?.at ?? null,
    authority: 'learning_only',
    executionAuthority: false,
  };
}
