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
  const token = new Contract(input.asset, ERC20_METADATA_ABI, input.provider);
  const [symbolRaw, decimalsRaw] = await Promise.all([token.symbol(), token.decimals()]);
  const assetSymbol = canonicalPriceSymbol(String(symbolRaw));
  const assetDecimals = Number(decimalsRaw.toString());
  if (!Number.isSafeInteger(assetDecimals) || assetDecimals < 0 || assetDecimals > 36) {
    throw new Error('GHOST_WALLET_CONTROLLER_ASSET_DECIMALS_INVALID');
  }
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

export const GHOST_WALLET_CONTROLLER_ECONOMICS_POLICY = {
  zeroCapitalEconomicsAuthority: false,
  advisoryVetoAuthority: false,
  livePriceEvidenceRequired: true,
  exactPreparedGasEstimateRequired: true,
  strictPositiveAllInNetRequired: true,
  hardBpsProfitFloor: false,
} as const;
