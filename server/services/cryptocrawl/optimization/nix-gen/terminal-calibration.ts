import {
  getSettlementProfitCalibrationSnapshot,
  type SettlementProfitCalibrationFilter,
  type SettlementProfitCalibrationSnapshot,
} from '../../learning/settlement-profit-calibrator.js';

export interface NixGenTerminalCalibrationInput extends SettlementProfitCalibrationFilter {
  expectedNetProfitUsd: number;
}

export interface NixGenTerminalCalibration {
  factor: number;
  terminalSamples: number;
  calibrationConfidence: number;
  confidenceWeightedReserveUsd: number | null;
  overestimateRate: number | null;
  source: SettlementProfitCalibrationSnapshot;
  authority: 'settlement_profit_calibrator_read_only';
  executionAuthority: false;
  learningAuthority: false;
  canonicalEconomicsAuthority: false;
}

/**
 * Read-only terminal calibration for Nix-Gen scheduling utility. A factor below
 * one may reduce advisory priority when confirmed settlement history shows
 * systematic prediction error, but it can never alter canonical economics,
 * candidate eligibility, settlement truth, or execution authority.
 */
export function getNixGenTerminalCalibration(
  input: NixGenTerminalCalibrationInput,
): NixGenTerminalCalibration {
  const source = getSettlementProfitCalibrationSnapshot({
    chain: input.chain,
    symbol: input.symbol,
    strategy: input.strategy,
  });
  const expected = Number(input.expectedNetProfitUsd);
  const confidence = Math.max(0, Math.min(1, Number(source.calibrationConfidence) || 0));
  const reserve = source.confidenceWeightedProfitReserveUsd;
  const overestimateRate = source.overestimateRate;

  let factor = 1;
  if (source.terminalSamples > 0 && Number.isFinite(expected) && expected > 0) {
    const reserveBurden = reserve !== null && Number.isFinite(reserve)
      ? Math.min(0.8, Math.max(0, reserve) / Math.max(1e-9, expected))
      : 0;
    const overestimateBurden = overestimateRate !== null && Number.isFinite(overestimateRate)
      ? 0.25 * Math.max(0, Math.min(1, overestimateRate)) * confidence
      : 0;
    factor = Math.max(0.2, Math.min(1, 1 - reserveBurden * confidence - overestimateBurden));
  }

  return {
    factor: Number(factor.toFixed(8)),
    terminalSamples: source.terminalSamples,
    calibrationConfidence: confidence,
    confidenceWeightedReserveUsd: reserve,
    overestimateRate,
    source,
    authority: 'settlement_profit_calibrator_read_only',
    executionAuthority: false,
    learningAuthority: false,
    canonicalEconomicsAuthority: false,
  };
}
