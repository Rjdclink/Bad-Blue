import { ethers } from 'ethers';
import type { AcrossBridgeQuote } from '../bridge/across-bridge-provider.js';

export interface CrossChainRouteEconomics {
  notionalUsd: number;
  inputAmountHuman: number;
  guaranteedOutputHuman: number;
  inputValueUsd: number;
  guaranteedOutputValueUsd: number;
  routeGainUsdBeforeOriginGas: number;
  swapOriginGasUsd: number;
  approvalGasUsd: number;
  originGasUsd: number;
  deterministicNetProfitUsd: number;
  netProfitBps: number;
  executablePositive: boolean;
  authority: 'across_min_output_closed_usd_plus_live_input_output_prices';
}

function positiveFinite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeFinite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Across Swap API may compose origin swap + bridge + destination swap. The only
 * recognized cross-chain profit is closed USD value: exact input marked at a live
 * input-asset price versus the provider-guaranteed minimum output marked at a
 * separately live output-asset price. Separately paid origin transaction gas and
 * any required approval gas are subtracted exactly once. Approval gas must be a
 * measured conservative ceiling when approvals are required; it is zero only when
 * Across reports no approval transaction. Expected output and fee-attribution
 * fields never manufacture profit.
 */
export function evaluateAcrossClosedUsdProfit(input: {
  quote: AcrossBridgeQuote;
  liveInputAssetUsdPrice: number;
  liveOutputAssetUsdPrice: number;
}): CrossChainRouteEconomics | null {
  const { quote } = input;
  const inputPrice = positiveFinite(input.liveInputAssetUsdPrice);
  const outputPrice = positiveFinite(input.liveOutputAssetUsdPrice);
  const swapOriginGasUsd = nonNegativeFinite(quote.originGasUsd);
  const approvalGasUsd = quote.approvalTransactions === 0
    ? 0
    : nonNegativeFinite(quote.approvalGasUsd);
  if (!inputPrice || !outputPrice || swapOriginGasUsd === null || approvalGasUsd === null) return null;
  if (!quote.minOutputAmount || !quote.inputSymbol || !quote.outputSymbol) return null;

  let inputAmountHuman: number;
  let guaranteedOutputHuman: number;
  try {
    inputAmountHuman = Number(ethers.utils.formatUnits(quote.inputAmount, quote.inputTokenDecimals));
    guaranteedOutputHuman = Number(ethers.utils.formatUnits(quote.minOutputAmount, quote.outputTokenDecimals));
  } catch {
    return null;
  }
  if (!(inputAmountHuman > 0) || !(guaranteedOutputHuman > 0) || !Number.isFinite(inputAmountHuman) || !Number.isFinite(guaranteedOutputHuman)) return null;

  const inputValueUsd = inputAmountHuman * inputPrice;
  const guaranteedOutputValueUsd = guaranteedOutputHuman * outputPrice;
  if (!(inputValueUsd > 0) || !Number.isFinite(inputValueUsd) || !Number.isFinite(guaranteedOutputValueUsd)) return null;
  const routeGainUsdBeforeOriginGas = guaranteedOutputValueUsd - inputValueUsd;
  const originGasUsd = swapOriginGasUsd + approvalGasUsd;
  const deterministicNetProfitUsd = routeGainUsdBeforeOriginGas - originGasUsd;
  const netProfitBps = deterministicNetProfitUsd / inputValueUsd * 10_000;

  return {
    notionalUsd: inputValueUsd,
    inputAmountHuman,
    guaranteedOutputHuman,
    inputValueUsd,
    guaranteedOutputValueUsd,
    routeGainUsdBeforeOriginGas,
    swapOriginGasUsd,
    approvalGasUsd,
    originGasUsd,
    deterministicNetProfitUsd,
    netProfitBps,
    executablePositive: deterministicNetProfitUsd > 0,
    authority: 'across_min_output_closed_usd_plus_live_input_output_prices',
  };
}

/** Backward-compatible same-asset helper retained for existing callers/verifiers. */
export function evaluateAcrossSameAssetProfit(input: {
  quote: AcrossBridgeQuote;
  liveAssetUsdPrice: number;
}): CrossChainRouteEconomics | null {
  if (input.quote.inputSymbol !== input.quote.outputSymbol) return null;
  return evaluateAcrossClosedUsdProfit({
    quote: input.quote,
    liveInputAssetUsdPrice: input.liveAssetUsdPrice,
    liveOutputAssetUsdPrice: input.liveAssetUsdPrice,
  });
}
