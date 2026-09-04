import type { CexStreamVenue } from './cex-order-book-stream.js';

export interface MakerTerminalCalibrationObservation {
  venue: CexStreamVenue;
  symbol: string;
  side: 'buy' | 'sell';
  orderId: string;
  predictedFillProbability: number;
  requestedQuantity: number;
  filledQuantity: number;
  submittedAt: number;
  terminalAt: number;
  terminalStatus: string;
}

export interface MakerTerminalCalibrationSnapshot {
  venue: CexStreamVenue;
  symbol: string;
  side: 'buy' | 'sell';
  sampleCount: number;
  predictedFillProbabilityEwma: number | null;
  realizedFillFractionEwma: number | null;
  absolutePredictionErrorEwma: number | null;
  terminalLatencyMsEwma: number | null;
  calibrationMultiplier: number;
  lastObservedAt: number | null;
  authority: 'realized_terminal_maker_calibration_only';
  executionAuthority: false;
  economicBpsAuthority: false;
}

type MutableCalibration = Omit<MakerTerminalCalibrationSnapshot, 'authority' | 'executionAuthority' | 'economicBpsAuthority'>;

const calibrations = new Map<string, MutableCalibration>();
const terminalOrderIds = new Map<string, number>();
const MAX_TERMINAL_ORDER_IDS = 4096;
const EWMA_ALPHA = 0.20;

function key(venue: CexStreamVenue, symbol: string, side: 'buy' | 'sell'): string {
  return `${venue}:${symbol.trim().toUpperCase()}:${side}`;
}

function terminalOrderKey(venue: CexStreamVenue, orderId: string): string {
  return `${venue}:${orderId}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ewma(previous: number | null, value: number): number {
  return previous === null ? value : previous + EWMA_ALPHA * (value - previous);
}

function pruneTerminalOrderIds(): void {
  if (terminalOrderIds.size <= MAX_TERMINAL_ORDER_IDS) return;
  const ordered = [...terminalOrderIds.entries()].sort((left, right) => left[1] - right[1]);
  for (const [orderKey] of ordered.slice(0, terminalOrderIds.size - MAX_TERMINAL_ORDER_IDS)) {
    terminalOrderIds.delete(orderKey);
  }
}

export function recordMakerTerminalCalibration(input: MakerTerminalCalibrationObservation): void {
  const symbol = input.symbol.trim().toUpperCase();
  const dedupeKey = terminalOrderKey(input.venue, input.orderId);
  if (!symbol || !input.orderId || terminalOrderIds.has(dedupeKey)) return;
  if (!(input.requestedQuantity > 0) || !Number.isFinite(input.filledQuantity)) return;
  if (!Number.isFinite(input.submittedAt) || !Number.isFinite(input.terminalAt) || input.terminalAt < input.submittedAt) return;

  const predicted = clamp(Number(input.predictedFillProbability) || 0, 0, 1);
  const realized = clamp(input.filledQuantity / input.requestedQuantity, 0, 1);
  const absoluteError = Math.abs(realized - predicted);
  const latencyMs = Math.max(0, input.terminalAt - input.submittedAt);
  const calibrationKey = key(input.venue, symbol, input.side);
  const previous = calibrations.get(calibrationKey) ?? {
    venue: input.venue,
    symbol,
    side: input.side,
    sampleCount: 0,
    predictedFillProbabilityEwma: null,
    realizedFillFractionEwma: null,
    absolutePredictionErrorEwma: null,
    terminalLatencyMsEwma: null,
    calibrationMultiplier: 1,
    lastObservedAt: null,
  };

  const predictedEwma = ewma(previous.predictedFillProbabilityEwma, predicted);
  const realizedEwma = ewma(previous.realizedFillFractionEwma, realized);
  const multiplier = predictedEwma > 0.05
    ? clamp(realizedEwma / predictedEwma, 0.35, 1.50)
    : 1;

  calibrations.set(calibrationKey, {
    ...previous,
    sampleCount: previous.sampleCount + 1,
    predictedFillProbabilityEwma: predictedEwma,
    realizedFillFractionEwma: realizedEwma,
    absolutePredictionErrorEwma: ewma(previous.absolutePredictionErrorEwma, absoluteError),
    terminalLatencyMsEwma: ewma(previous.terminalLatencyMsEwma, latencyMs),
    calibrationMultiplier: multiplier,
    lastObservedAt: Date.now(),
  });
  terminalOrderIds.set(dedupeKey, Date.now());
  pruneTerminalOrderIds();
}

export function getMakerTerminalCalibration(
  venue: CexStreamVenue,
  symbol: string,
  side: 'buy' | 'sell',
): MakerTerminalCalibrationSnapshot {
  const normalized = symbol.trim().toUpperCase();
  const row = calibrations.get(key(venue, normalized, side));
  return {
    venue,
    symbol: normalized,
    side,
    sampleCount: row?.sampleCount ?? 0,
    predictedFillProbabilityEwma: row?.predictedFillProbabilityEwma ?? null,
    realizedFillFractionEwma: row?.realizedFillFractionEwma ?? null,
    absolutePredictionErrorEwma: row?.absolutePredictionErrorEwma ?? null,
    terminalLatencyMsEwma: row?.terminalLatencyMsEwma ?? null,
    calibrationMultiplier: row?.calibrationMultiplier ?? 1,
    lastObservedAt: row?.lastObservedAt ?? null,
    authority: 'realized_terminal_maker_calibration_only',
    executionAuthority: false,
    economicBpsAuthority: false,
  };
}

export function calibrateMakerFillProbability(input: {
  venue: CexStreamVenue;
  symbol: string;
  side: 'buy' | 'sell';
  rawFillProbability: number;
}): { probability: number; calibration: MakerTerminalCalibrationSnapshot } {
  const calibration = getMakerTerminalCalibration(input.venue, input.symbol, input.side);
  const raw = clamp(Number(input.rawFillProbability) || 0, 0, 1);
  // Require multiple terminal samples before realized evidence can materially
  // move the shadow queue model. Until then, preserve the existing estimate.
  const weight = calibration.sampleCount < 3 ? 0 : clamp(calibration.sampleCount / 20, 0, 1);
  const adjusted = raw * (1 + (calibration.calibrationMultiplier - 1) * weight);
  return { probability: clamp(adjusted, 0, 1), calibration };
}

export function getMakerTerminalCalibrationSnapshot(): MakerTerminalCalibrationSnapshot[] {
  return [...calibrations.values()].map(row => ({
    ...row,
    authority: 'realized_terminal_maker_calibration_only',
    executionAuthority: false,
    economicBpsAuthority: false,
  }));
}
