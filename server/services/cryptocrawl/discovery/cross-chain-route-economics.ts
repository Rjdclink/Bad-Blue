import { ethers } from 'ethers';
import type { AcrossBridgeQuote } from '../bridge/across-bridge-provider.js';

export interface CrossChainRouteEconomics {
  notionalUsd: number;
  inputAmountHuman: number;
  guaranteedOutputHuman: number;
  inputValueUsd: number;
  guaranteedOutputValueUsd: number;
  routeGainUsdBeforeOriginGas: number;
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

/**
 * Across Swap API may compose origin swap + bridge + destination swap. The only
 * recognized cross-chain profit is closed USD value: exact input marked at a live
 * input-asset price versus the provider-guaranteed minimum output marked at a
 * separately live output-asset price, with separately paid origin gas subtracted
 * once. Expected output, bridge fee breakdowns and theoretical slippage never add
 * profit. This supports same-asset transfers and measured USDC<->USDT cross-swaps
 * without pretending an asynchronous bridge is flash-atomic.
 */
export function evaluateAcrossClosedUsdProfit(input: {
  quote: AcrossBridgeQuote;
  liveInputAssetUsdPrice: number;
  liveOutputAssetUsdPrice: number;
}): CrossChainRouteEconomics | null {
  const { quote } = input;
  const inputPrice = positiveFinite(input.liveInputAssetUsdPrice);
  const outputPrice = positiveFinite(input.liveOutputAssetUsdPrice);
  const originGasUsd = quote.originGasUsd === null ? null : Number(quote.originGasUsd);
  if (!inputPrice || !outputPrice || originGasUsd === null || !Number.isFinite(originGasUsd) || originGasUsd < 0) return null;
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
  const deterministicNetProfitUsd = routeGainUsdBeforeOriginGas - originGasUsd;
  const netProfitBps = deterministicNetProfitUsd / inputValueUsd * 10_000;

  return {
    notionalUsd: inputValueUsd,
    inputAmountHuman,
    guaranteedOutputHuman,
    inputValueUsd,
    guaranteedOutputValueUsd,
    routeGainUsdBeforeOriginGas,
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
