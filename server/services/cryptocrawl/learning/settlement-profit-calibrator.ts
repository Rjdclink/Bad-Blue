import type { ExecutionOutcomeObservation } from './execution-outcome.js';

export interface SettlementProfitCalibrationSnapshot {
  terminalSamples: number;
  meanAbsoluteProfitErrorUsd: number | null;
  meanSignedProfitErrorUsd: number | null;
  overestimateRate: number | null;
  lastObservedAt: number | null;
  authority: 'learning_only';
  executionAuthority: false;
}

const MAX_SAMPLES = Math.max(32, Math.min(4096, Number(process.env.CRYPTOCRAWL_SETTLEMENT_CALIBRATION_SAMPLES || 512)));
const samples: Array<{ at: number; errorUsd: number }> = [];

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
  if (samples.length === 0) {
    return {
      terminalSamples: 0,
      meanAbsoluteProfitErrorUsd: null,
      meanSignedProfitErrorUsd: null,
      overestimateRate: null,
      lastObservedAt: null,
      authority: 'learning_only',
      executionAuthority: false,
    };
  }
  const signed = samples.reduce((sum, sample) => sum + sample.errorUsd, 0) / samples.length;
  const absolute = samples.reduce((sum, sample) => sum + Math.abs(sample.errorUsd), 0) / samples.length;
  const overestimates = samples.filter(sample => sample.errorUsd < 0).length / samples.length;
  return {
    terminalSamples: samples.length,
    meanAbsoluteProfitErrorUsd: Number(absolute.toFixed(8)),
    meanSignedProfitErrorUsd: Number(signed.toFixed(8)),
    overestimateRate: Number(overestimates.toFixed(6)),
    lastObservedAt: samples[samples.length - 1]?.at ?? null,
    authority: 'learning_only',
    executionAuthority: false,
  };
}
