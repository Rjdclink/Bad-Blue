export const PROFIT_ADMISSION_POLICY = Object.freeze({
  rule: 'strictly_positive_verified_all_in_net_profit' as const,
  minimumProfitUsd: 0 as const,
  minimumProfitBps: 0 as const,
  configurableMagnitudeFloorAllowed: false as const,
  strategySpecificProfitFloorAllowed: false as const,
  advisoryModelProfitVetoAllowed: false as const,
});

function finite(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The one CryptoCrawler profit-admission rule.
 *
 * Admission is based on verified all-in net economics only. There is no minimum
 * dollar amount, percentage, BPS, ROI, historical-performance, or configurable
 * profit magnitude beyond mathematical positivity.
 */
export function isStrictlyPositiveAllInNetProfit(value: unknown): boolean {
  const parsed = finite(value);
  return parsed !== null && parsed > 0;
}

export function requireStrictlyPositiveAllInNetProfit(
  value: unknown,
  label = 'verified all-in net profit',
): number {
  const parsed = finite(value);
  if (parsed === null || parsed <= 0) {
    throw new Error(`${label} must be strictly greater than zero`);
  }
  return parsed;
}

/**
 * Integer-token execution surfaces cannot represent an infinitesimal amount.
 * One smallest token unit is therefore the exact integer representation of > 0,
 * not a configurable or strategy-specific profit threshold.
 */
export function minimumPositiveProfitBaseUnits(): bigint {
  return 1n;
}

export function isStrictlyPositiveProfitBaseUnits(value: bigint | string | number): boolean {
  try {
    return BigInt(value) >= minimumPositiveProfitBaseUnits();
  } catch {
    return false;
  }
}
