import { ethers } from 'ethers';
import type { AcrossBridgeQuote } from '../bridge/across-bridge-provider.js';

export interface CrossChainRouteEconomics {
  notionalUsd: number;
  inputAmountHuman: number;
  guaranteedOutputHuman: number;
  routeGainUsdBeforeOriginGas: number;
  originGasUsd: number;
  deterministicNetProfitUsd: number;
  netProfitBps: number;
  executablePositive: boolean;
  authority: 'across_min_output_same_asset_plus_live_usd_price';
}

function positiveFinite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Cross-chain profit is recognized only for same-asset routes. Across exact-input
 * output/minOutput already include route swap/bridge/destination fees. Origin gas
 * is paid separately by the signer, so it is subtracted once here. Using the
 * guaranteed minimum output prevents expected-output optimism from becoming
 * canonical profit. Different-asset mark-to-market routes are deliberately not
 * admitted by this function because that would introduce price exposure rather
 * than closed economic profit.
 */
export function evaluateAcrossSameAssetProfit(input: {
  quote: AcrossBridgeQuote;
  liveAssetUsdPrice: number;
}): CrossChainRouteEconomics | null {
  const { quote } = input;
  const price = positiveFinite(input.liveAssetUsdPrice);
  const originGasUsd = quote.originGasUsd === null ? null : Number(quote.originGasUsd);
  if (!price || originGasUsd === null || !Number.isFinite(originGasUsd) || originGasUsd < 0) return null;
  if (!quote.minOutputAmount || quote.token.trim().toUpperCase() === '') return null;

  let inputAmountHuman: number;
  let guaranteedOutputHuman: number;
  try {
    inputAmountHuman = Number(ethers.utils.formatUnits(quote.inputAmount, quote.inputTokenDecimals));
    guaranteedOutputHuman = Number(ethers.utils.formatUnits(quote.minOutputAmount, quote.outputTokenDecimals));
  } catch {
    return null;
  }
  if (!(inputAmountHuman > 0) || !(guaranteedOutputHuman > 0) || !Number.isFinite(inputAmountHuman) || !Number.isFinite(guaranteedOutputHuman)) return null;

  const notionalUsd = inputAmountHuman * price;
  if (!(notionalUsd > 0) || !Number.isFinite(notionalUsd)) return null;
  const routeGainUsdBeforeOriginGas = (guaranteedOutputHuman - inputAmountHuman) * price;
  const deterministicNetProfitUsd = routeGainUsdBeforeOriginGas - originGasUsd;
  const netProfitBps = deterministicNetProfitUsd / notionalUsd * 10_000;

  return {
    notionalUsd,
    inputAmountHuman,
    guaranteedOutputHuman,
    routeGainUsdBeforeOriginGas,
    originGasUsd,
    deterministicNetProfitUsd,
    netProfitBps,
    executablePositive: deterministicNetProfitUsd > 0,
    authority: 'across_min_output_same_asset_plus_live_usd_price',
  };
}
