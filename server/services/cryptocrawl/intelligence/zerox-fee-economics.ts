import type { DexQuoteObservation } from './market-data-providers.js';

export type ZeroXFeeTreatment =
  | 'embedded_in_quote_sell_amount'
  | 'external_native_transaction_cost'
  | 'unknown_fail_closed';

export interface ZeroXFeeComponentEvidence {
  field: string;
  amount: string;
  token: string;
  type: string | null;
  treatment: ZeroXFeeTreatment;
}

export interface ZeroXFeeEconomicsEvidence {
  components: ZeroXFeeComponentEvidence[];
  embedded: ZeroXFeeComponentEvidence[];
  externalNative: ZeroXFeeComponentEvidence[];
  unknown: ZeroXFeeComponentEvidence[];
  completeForSameChainAllowanceHolder: boolean;
  economicRule: 'embedded_fees_are_reflected_by_quote_output_and_must_not_be_subtracted_twice';
}

function feeRows(value: unknown): Array<{ amount?: unknown; token?: unknown; type?: unknown }> {
  if (Array.isArray(value)) return value.filter(row => row && typeof row === 'object') as Array<{ amount?: unknown; token?: unknown; type?: unknown }>;
  if (value && typeof value === 'object') return [value as { amount?: unknown; token?: unknown; type?: unknown }];
  return [];
}

function positiveIntegerString(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  try { return BigInt(text) > 0n ? text : null; } catch { return null; }
}

function treatmentFor(field: string): ZeroXFeeTreatment {
  if (field === 'zeroExFee' || field === 'integratorFee' || field === 'integratorFees') {
    return 'embedded_in_quote_sell_amount';
  }
  if (field === 'bridgeNativeFee' || field === 'gasFee') return 'external_native_transaction_cost';
  return 'unknown_fail_closed';
}

/**
 * 0x v2 returns explicit fee evidence in quote.fees. 0x documents zeroExFee and
 * integrator fee as deductions from sellAmount, so the returned buyAmount already
 * reflects their economic effect. They are attribution evidence, not another
 * amount to subtract from canonical net profit. Native bridge/gas fees are
 * additional costs and are not admitted by the same-chain stablecoin atomic lane.
 */
export function inspectZeroXFeeEconomics(quote: DexQuoteObservation): ZeroXFeeEconomicsEvidence {
  const source = quote.fees && typeof quote.fees === 'object' ? quote.fees : {};
  const components: ZeroXFeeComponentEvidence[] = [];

  for (const [field, raw] of Object.entries(source)) {
    if (raw === null || raw === undefined) continue;
    const rows = feeRows(raw);
    if (rows.length === 0) {
      components.push({
        field,
        amount: 'unknown',
        token: 'unknown',
        type: null,
        treatment: 'unknown_fail_closed',
      });
      continue;
    }
    for (const row of rows) {
      const amount = positiveIntegerString(row.amount);
      if (!amount) continue;
      const token = String(row.token ?? '').trim();
      components.push({
        field,
        amount,
        token: token || 'unknown',
        type: row.type === null || row.type === undefined ? null : String(row.type),
        treatment: token ? treatmentFor(field) : 'unknown_fail_closed',
      });
    }
  }

  const embedded = components.filter(component => component.treatment === 'embedded_in_quote_sell_amount');
  const externalNative = components.filter(component => component.treatment === 'external_native_transaction_cost');
  const unknown = components.filter(component => component.treatment === 'unknown_fail_closed');
  return {
    components,
    embedded,
    externalNative,
    unknown,
    completeForSameChainAllowanceHolder: externalNative.length === 0 && unknown.length === 0,
    economicRule: 'embedded_fees_are_reflected_by_quote_output_and_must_not_be_subtracted_twice',
  };
}
