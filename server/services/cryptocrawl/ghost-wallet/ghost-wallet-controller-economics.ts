import { Contract, providers } from 'ethers';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import type { GhostWalletChain } from './ghost-wallet-provider-mesh.js';

const ERC20_METADATA_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];
const PRICE_SCALE = 100_000_000n;
const WEI = 10n ** 18n;

export interface GhostWalletControllerEconomics {
  assetSymbol: string;
  assetDecimals: number;
  nativeSymbol: 'ETH' | 'POL' | 'BNB' | 'AVAX';
  nativePriceUsd: number;
  assetPriceUsd: number;
  gasUnits: bigint;
  feePerGasWei: bigint;
  gasCostWei: bigint;
  gasCostAssetBaseUnits: bigint;
  expectedSpreadBaseUnits: bigint;
  expectedNetProfitBaseUnits: bigint;
  approved: boolean;
  reason: string;
}

export interface GhostWalletMultiAssetEconomics {
  nativeSymbol: 'ETH' | 'POL' | 'BNB' | 'AVAX';
  gasCostUsdScaled: bigint;
  expectedProfitUsdScaled: bigint;
  expectedNetProfitUsdScaled: bigint;
  approved: boolean;
  reason: string;
  profitAssets: Array<{ asset: string; symbol: string; decimals: number; amount: bigint; valueUsdScaled: bigint }>;
}

function nativeSymbol(chain: GhostWalletChain): 'ETH' | 'POL' | 'BNB' | 'AVAX' {
  if (chain === 'polygon') return 'POL';
  if (chain === 'bsc') return 'BNB';
  if (chain === 'avalanche') return 'AVAX';
  return 'ETH';
}

function canonicalPriceSymbol(raw: string): string {
  const symbol = raw.trim().toUpperCase();
  if (symbol === 'WETH') return 'ETH';
  if (symbol === 'WMATIC' || symbol === 'WPOL' || symbol === 'MATIC') return 'POL';
  if (symbol === 'WBNB') return 'BNB';
  if (symbol === 'WAVAX') return 'AVAX';
  return symbol;
}

function scaledPrice(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) throw new Error('GHOST_WALLET_CONTROLLER_PRICE_INVALID');
  return BigInt(Math.ceil(value * Number(PRICE_SCALE)));
}

function divUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('GHOST_WALLET_CONTROLLER_DIVISOR_INVALID');
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}

async function tokenMetadata(provider: providers.JsonRpcProvider, asset: string): Promise<{ symbol: string; decimals: number }> {
  const token = new Contract(asset, ERC20_METADATA_ABI, provider);
  const [symbolRaw, decimalsRaw] = await Promise.all([token.symbol(), token.decimals()]);
  const symbol = canonicalPriceSymbol(String(symbolRaw));
  const decimals = Number(decimalsRaw.toString());
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error('GHOST_WALLET_CONTROLLER_ASSET_DECIMALS_INVALID');
  }
  return { symbol, decimals };
}

export async function evaluateGhostWalletControllerEconomics(input: {
  chain: GhostWalletChain;
  provider: providers.JsonRpcProvider;
  asset: string;
  gasUnits: bigint;
  feePerGasWei: bigint;
  expectedSpreadBaseUnits: bigint;
}): Promise<GhostWalletControllerEconomics> {
  if (input.gasUnits <= 0n || input.feePerGasWei <= 0n || input.expectedSpreadBaseUnits <= 0n) {
    throw new Error('GHOST_WALLET_CONTROLLER_ECONOMICS_INPUT_INVALID');
  }
  const metadata = await tokenMetadata(input.provider, input.asset);
  const assetSymbol = metadata.symbol;
  const assetDecimals = metadata.decimals;
  const gasSymbol = nativeSymbol(input.chain);
  const priceSymbols = [...new Set([gasSymbol, assetSymbol])];
  const prices = await coinGeckoPriceClient.getLiveSymbolPrices(priceSymbols);
  const nativePriceUsd = prices.get(gasSymbol);
  const assetPriceUsd = prices.get(assetSymbol);
  if (!nativePriceUsd || !assetPriceUsd) {
    throw new Error(`GHOST_WALLET_CONTROLLER_PRICE_EVIDENCE_UNAVAILABLE:${gasSymbol}:${assetSymbol}`);
  }

  const gasCostWei = input.gasUnits * input.feePerGasWei;
  const numerator = gasCostWei * scaledPrice(nativePriceUsd) * (10n ** BigInt(assetDecimals));
  const denominator = WEI * scaledPrice(assetPriceUsd);
  const gasCostAssetBaseUnits = divUp(numerator, denominator);
  const expectedNetProfitBaseUnits = input.expectedSpreadBaseUnits - gasCostAssetBaseUnits;
  const approved = expectedNetProfitBaseUnits > 0n;
  return {
    assetSymbol,
    assetDecimals,
    nativeSymbol: gasSymbol,
    nativePriceUsd,
    assetPriceUsd,
    gasUnits: input.gasUnits,
    feePerGasWei: input.feePerGasWei,
    gasCostWei,
    gasCostAssetBaseUnits,
    expectedSpreadBaseUnits: input.expectedSpreadBaseUnits,
    expectedNetProfitBaseUnits,
    approved,
    reason: approved
      ? 'strict_positive_realized_spread_after_controller_gas'
      : 'ghost_spread_does_not_cover_controller_gas',
  };
}

export async function evaluateGhostWalletMultiAssetControllerEconomics(input: {
  chain: GhostWalletChain;
  provider: providers.JsonRpcProvider;
  gasUnits: bigint;
  feePerGasWei: bigint;
  profits: Array<{ asset: string; amount: bigint }>;
}): Promise<GhostWalletMultiAssetEconomics> {
  const positive = input.profits.filter(item => item.amount > 0n);
  if (input.gasUnits <= 0n || input.feePerGasWei <= 0n || positive.length === 0) {
    throw new Error('GHOST_WALLET_CONTROLLER_MULTI_ASSET_INPUT_INVALID');
  }
  const metadata = await Promise.all(positive.map(async item => ({
    ...item,
    ...await tokenMetadata(input.provider, item.asset),
  })));
  const gasSymbol = nativeSymbol(input.chain);
  const prices = await coinGeckoPriceClient.getLiveSymbolPrices([...new Set([gasSymbol, ...metadata.map(item => item.symbol)])]);
  const nativePrice = prices.get(gasSymbol);
  if (!nativePrice) throw new Error(`GHOST_WALLET_CONTROLLER_PRICE_EVIDENCE_UNAVAILABLE:${gasSymbol}`);
  const gasCostWei = input.gasUnits * input.feePerGasWei;
  const gasCostUsdScaled = (gasCostWei * scaledPrice(nativePrice)) / WEI;
  let expectedProfitUsdScaled = 0n;
  const profitAssets: GhostWalletMultiAssetEconomics['profitAssets'] = [];
  for (const item of metadata) {
    const price = prices.get(item.symbol);
    if (!price) throw new Error(`GHOST_WALLET_CONTROLLER_PRICE_EVIDENCE_UNAVAILABLE:${item.symbol}`);
    const valueUsdScaled = (item.amount * scaledPrice(price)) / (10n ** BigInt(item.decimals));
    expectedProfitUsdScaled += valueUsdScaled;
    profitAssets.push({
      asset: item.asset,
      symbol: item.symbol,
      decimals: item.decimals,
      amount: item.amount,
      valueUsdScaled,
    });
  }
  const expectedNetProfitUsdScaled = expectedProfitUsdScaled - gasCostUsdScaled;
  const approved = expectedNetProfitUsdScaled > 0n;
  return {
    nativeSymbol: gasSymbol,
    gasCostUsdScaled,
    expectedProfitUsdScaled,
    expectedNetProfitUsdScaled,
    approved,
    reason: approved
      ? 'strict_positive_multi_asset_fees_after_controller_gas'
      : 'ghost_matched_intent_fees_do_not_cover_controller_gas',
    profitAssets,
  };
}

export const GHOST_WALLET_CONTROLLER_ECONOMICS_POLICY = {
  zeroCapitalEconomicsAuthority: false,
  advisoryVetoAuthority: false,
  livePriceEvidenceRequired: true,
  exactPreparedGasEstimateRequired: true,
  strictPositiveAllInNetRequired: true,
  multiAssetFeeValuationSupported: true,
  hardBpsProfitFloor: false,
} as const;
