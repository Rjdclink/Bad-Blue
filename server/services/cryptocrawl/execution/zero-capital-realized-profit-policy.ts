export interface ZeroCapitalRealizedProfitInput {
  grossProfitBaseUnits: bigint;
  inputTokenDecimals: number;
  inputTokenUsdPrice: number | null;
  sponsoredExecution: boolean;
  /**
   * Receipt-equivalent network gas consumed by the transaction. For a hosted
   * paymaster this is still an economic cost unless independent zero-cost proof
   * exists; sponsorship removes the upfront native-balance requirement, not the
   * provider bill.
   */
  nativeFeeWei: bigint;
  nativeUsdPrice: number | null;
  sponsorOperatorMonetaryCostProvenZero?: boolean;
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
 * Receiver-emitted profit is denominated in the opportunity's input token, never
 * inherently in USD. Terminal realized economics therefore require a live USD
 * price for that exact token before the receipt can become realized-profit truth.
 *
 * Sponsorship is a funding mechanism, not automatically a discount. Unless the
 * sponsor's operator monetary cost is independently proven zero, receipt-equivalent
 * network gas is charged exactly like native-funded gas. This prevents provider-
 * fronted gas from manufacturing positive realized BPS.
 */
export function evaluateZeroCapitalRealizedProfit(
  input: ZeroCapitalRealizedProfitInput,
): ZeroCapitalRealizedProfitDecision {
  if (input.grossProfitBaseUnits < 0n) throw new Error('Gross receiver profit cannot be negative');
  if (input.nativeFeeWei < 0n) throw new Error('Native fee cannot be negative');

  const inputTokenUsdPrice = finitePositive(input.inputTokenUsdPrice);
  const sponsorCostProvenZero = input.sponsoredExecution && input.sponsorOperatorMonetaryCostProvenZero === true;
  if (inputTokenUsdPrice === null) {
    return {
      economicsComplete: false,
      grossProfitUsd: 0,
      gasUsd: sponsorCostProvenZero ? 0 : null,
      netProfitUsd: null,
      netProfitBaseUnits: null,
      positiveAfterAllInCost: false,
      missingInformation: ['live_input_token_usd_price_for_realized_profit'],
    };
  }

  const grossProfitToken = unitsToNumber(input.grossProfitBaseUnits, input.inputTokenDecimals);
  const grossProfitUsd = grossProfitToken * inputTokenUsdPrice;
  if (!Number.isFinite(grossProfitUsd) || grossProfitUsd < 0) {
    return {
      economicsComplete: false,
      grossProfitUsd: 0,
      gasUsd: sponsorCostProvenZero ? 0 : null,
      netProfitUsd: null,
      netProfitBaseUnits: null,
      positiveAfterAllInCost: false,
      missingInformation: ['finite_realized_input_token_usd_value'],
    };
  }

  if (sponsorCostProvenZero) {
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

  if (input.sponsoredExecution && input.nativeFeeWei <= 0n) {
    return {
      economicsComplete: false,
      grossProfitUsd,
      gasUsd: null,
      netProfitUsd: null,
      netProfitBaseUnits: null,
      positiveAfterAllInCost: false,
      missingInformation: ['provider_sponsored_receipt_equivalent_gas_cost'],
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
  const gasCostInputToken = gasUsd / inputTokenUsdPrice;
  const gasCostBaseUnitsNumber = gasCostInputToken * Number(tokenScale);
  if (!Number.isFinite(gasCostBaseUnitsNumber) || gasCostBaseUnitsNumber < 0) {
    return {
      economicsComplete: false,
      grossProfitUsd,
      gasUsd,
      netProfitUsd: null,
      netProfitBaseUnits: null,
      positiveAfterAllInCost: false,
      missingInformation: ['finite_realized_gas_input_token_cost'],
    };
  }

  // Round the cost upward to one token base unit. A rounding artifact must never
  // manufacture a positive realized result near zero.
  const gasCostBaseUnits = BigInt(Math.ceil(gasCostBaseUnitsNumber));
  const netProfitBaseUnits = input.grossProfitBaseUnits - gasCostBaseUnits;
  const netProfitUsd = unitsToNumber(netProfitBaseUnits, input.inputTokenDecimals) * inputTokenUsdPrice;

  return {
    economicsComplete: Number.isFinite(netProfitUsd),
    grossProfitUsd,
    gasUsd,
    netProfitUsd: Number.isFinite(netProfitUsd) ? netProfitUsd : null,
    netProfitBaseUnits: Number.isFinite(netProfitUsd) ? netProfitBaseUnits : null,
    positiveAfterAllInCost: Number.isFinite(netProfitUsd) && netProfitBaseUnits > 0n,
    missingInformation: Number.isFinite(netProfitUsd) ? [] : ['finite_realized_net_profit_usd'],
  };
}
