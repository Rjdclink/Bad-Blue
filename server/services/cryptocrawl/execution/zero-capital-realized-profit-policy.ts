export interface ZeroCapitalRealizedProfitInput {
  grossProfitBaseUnits: bigint;
  inputTokenDecimals: number;
  sponsoredExecution: boolean;
  nativeFeeWei: bigint;
  nativeUsdPrice: number | null;
}

export interface ZeroCapitalRealizedProfitDecision {
  economicsComplete: boolean;
  grossProfitUsd: number;
  gasUsd: number | null;
  netProfitUsd: number | null;
  netProfitBaseUnits: bigint | null;
  positiveAfterAllInCost: boolean;
  missingInformation: string[];
}

function finitePositive(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function unitsToNumber(units: bigint, decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Token decimals must be an integer from 0 to 36');
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const scale = 10n ** BigInt(decimals);
  const whole = magnitude / scale;
  const fraction = magnitude % scale;
  const text = decimals === 0
    ? whole.toString()
    : `${whole.toString()}.${fraction.toString().padStart(decimals, '0')}`;
  const parsed = Number(`${negative ? '-' : ''}${text}`);
  if (!Number.isFinite(parsed)) throw new Error('Token base-unit value cannot be represented as a finite number');
  return parsed;
}

/**
 * Receiver-emitted profit is gross with respect to the externally funded native
 * transaction fee. For native-funded execution, realized profitability is not
 * verified until the receipt's actual gas charge is converted with a live native
 * asset USD price and subtracted. Sponsored execution has zero user-paid native
 * gas only when the sponsorship path itself was verified by the caller.
 */
export function evaluateZeroCapitalRealizedProfit(
  input: ZeroCapitalRealizedProfitInput,
): ZeroCapitalRealizedProfitDecision {
  if (input.grossProfitBaseUnits < 0n) throw new Error('Gross receiver profit cannot be negative');
  if (input.nativeFeeWei < 0n) throw new Error('Native fee cannot be negative');
  const grossProfitUsd = unitsToNumber(input.grossProfitBaseUnits, input.inputTokenDecimals);

  if (input.sponsoredExecution) {
    return {
      economicsComplete: true,
      grossProfitUsd,
      gasUsd: 0,
      netProfitUsd: grossProfitUsd,
      netProfitBaseUnits: input.grossProfitBaseUnits,
      positiveAfterAllInCost: input.grossProfitBaseUnits > 0n,
      missingInformation: [],
    };
  }

  const nativeUsdPrice = finitePositive(input.nativeUsdPrice);
  if (nativeUsdPrice === null) {
    return {
      economicsComplete: false,
      grossProfitUsd,
      gasUsd: null,
      netProfitUsd: null,
      netProfitBaseUnits: null,
      positiveAfterAllInCost: false,
      missingInformation: ['live_native_asset_usd_price_for_realized_gas'],
    };
  }

  const nativeFee = unitsToNumber(input.nativeFeeWei, 18);
  const gasUsd = nativeFee * nativeUsdPrice;
  if (!Number.isFinite(gasUsd) || gasUsd < 0) {
    return {
      economicsComplete: false,
      grossProfitUsd,
      gasUsd: null,
      netProfitUsd: null,
      netProfitBaseUnits: null,
      positiveAfterAllInCost: false,
      missingInformation: ['finite_realized_gas_usd'],
    };
  }

  const tokenScale = 10n ** BigInt(input.inputTokenDecimals);
  // Round the cost upward to one token base unit. A rounding artifact must never
  // manufacture a positive realized result near zero.
  const gasCostBaseUnits = BigInt(Math.ceil(gasUsd * Number(tokenScale)));
  const netProfitBaseUnits = input.grossProfitBaseUnits - gasCostBaseUnits;
  const netProfitUsd = unitsToNumber(netProfitBaseUnits, input.inputTokenDecimals);

  return {
    economicsComplete: true,
    grossProfitUsd,
    gasUsd,
    netProfitUsd,
    netProfitBaseUnits,
    positiveAfterAllInCost: netProfitBaseUnits > 0n,
    missingInformation: [],
  };
}
