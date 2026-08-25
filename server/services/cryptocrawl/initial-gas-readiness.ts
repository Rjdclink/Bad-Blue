import { providers, ethers } from 'ethers';
import { coinGeckoPriceClient } from './bridge/coingecko-client.js';
import type { SupportedChain } from './core/zero-capital-engine.js';

export type InitialGasReadinessStatus =
  | 'PRE_STAGE_1_BOOTSTRAP'
  | 'INITIAL_GAS_READY'
  | 'GAS_READY'
  | 'GAS_BELOW_THRESHOLD'
  | 'GAS_ZERO_BALANCE'
  | 'BALANCE_UNKNOWN'
  | 'PRICE_UNKNOWN'
  | 'PROVIDER_UNAVAILABLE';

export interface InitialGasChainMeasurement {
  chain: SupportedChain;
  nativeSymbol: string;
  nativeDecimals: number | null;
  walletAddress?: string;
  walletAddressSource?: 'execution_wallet' | 'bridge_wallet';
  rpcReachable: boolean;
  nativeBalanceWei: string | null;
  nativeBalance: number | null;
  nativePriceUsd: number | null;
  usableNativeGasUsd: number | null;
  eligibleForReadinessCalculation: boolean;
  observedAt: number;
  status: 'verified' | 'balance_unknown' | 'price_unknown' | 'provider_unavailable' | 'wallet_unavailable' | 'unsupported_chain' | 'ineligible';
  exclusionReason?: string;
  reason?: string;
}

export interface InitialGasReadiness {
  status: InitialGasReadinessStatus;
  initialGasReady: boolean;
  thresholdUsd: number;
  usableNativeGasUsd: number | null;
  selectedChain?: SupportedChain;
  measurements: InitialGasChainMeasurement[];
  observedAt: number;
  provenance: string[];
  reason?: string;
}

const NATIVE_ASSETS: Record<string, { symbol: string; decimals: number; eligible: boolean; exclusionReason?: string }> = {
  ethereum: { symbol: 'ETH', decimals: 18, eligible: true },
  polygon: { symbol: 'POL', decimals: 18, eligible: true },
  arbitrum: { symbol: 'ETH', decimals: 18, eligible: true },
  optimism: { symbol: 'ETH', decimals: 18, eligible: true },
  bsc: { symbol: 'BNB', decimals: 18, eligible: true },
  avalanche: { symbol: 'AVAX', decimals: 18, eligible: true },
  europa: {
    symbol: 'SKL',
    decimals: 18,
    eligible: false,
    exclusionReason: 'Europa uses the verified zero-monetary-gas adapter; SKL balance is observed but does not qualify as paid native gas',
  },
};

export function getInitialGasThresholdUsd(environment: NodeJS.ProcessEnv = process.env): number {
  const configured = environment.ZERO_CAPITAL_INITIAL_GAS_USD?.trim() || '20';
  const threshold = Number(configured);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error('ZERO_CAPITAL_INITIAL_GAS_USD must be a finite positive number');
  }
  return threshold;
}

export async function assessInitialGasReadiness(input: {
  providers: ReadonlyMap<SupportedChain, providers.Provider>;
  walletAddresses: ReadonlyMap<SupportedChain, string>;
  walletAddressSources?: ReadonlyMap<SupportedChain, 'execution_wallet' | 'bridge_wallet'>;
  environment?: NodeJS.ProcessEnv;
  priceProvider?: (symbols: string[]) => Promise<Map<string, number>>;
}): Promise<InitialGasReadiness> {
  const thresholdUsd = getInitialGasThresholdUsd(input.environment);
  const observedAt = Date.now();
  const chains = Array.from(input.providers.keys());
  const symbols = [...new Set(chains
    .map(chain => NATIVE_ASSETS[chain]?.eligible ? NATIVE_ASSETS[chain].symbol : null)
    .filter((symbol): symbol is string => symbol !== null))];
  let livePrices: Map<string, number>;
  let priceError: string | undefined;
  try {
    livePrices = await (input.priceProvider || (symbolsToPrice => coinGeckoPriceClient.getLiveSymbolPrices(symbolsToPrice)))(symbols);
  } catch (error) {
    livePrices = new Map();
    priceError = error instanceof Error ? error.message : String(error);
  }

  const measurements = await Promise.all(chains.map(async chain => {
    const provider = input.providers.get(chain)!;
    const asset = NATIVE_ASSETS[chain];
    const walletAddress = input.walletAddresses.get(chain);
    const walletAddressSource = input.walletAddressSources?.get(chain);
    if (!asset) {
      return {
        chain,
        nativeSymbol: 'UNKNOWN',
        nativeDecimals: null,
        walletAddress,
        walletAddressSource,
        rpcReachable: true,
        nativeBalanceWei: null,
        nativeBalance: null,
        nativePriceUsd: null,
        usableNativeGasUsd: null,
        eligibleForReadinessCalculation: false,
        observedAt,
        status: 'unsupported_chain' as const,
        exclusionReason: `Chain ${chain} has no configured native-gas asset metadata`,
      };
    }

    if (!walletAddress) {
      return {
        chain,
        nativeSymbol: asset.symbol,
        nativeDecimals: asset.decimals,
        walletAddress: undefined,
        walletAddressSource,
        rpcReachable: true,
        nativeBalanceWei: null,
        nativeBalance: null,
        nativePriceUsd: null,
        usableNativeGasUsd: null,
        eligibleForReadinessCalculation: asset.eligible,
        observedAt,
        status: 'wallet_unavailable' as const,
        reason: 'No canonical execution or bridge wallet address is available for this chain',
      };
    }

    let balance: ethers.BigNumber;
    try {
      balance = await provider.getBalance(walletAddress);
    } catch (error) {
      return {
        chain,
        nativeSymbol: asset.symbol,
        nativeDecimals: asset.decimals,
        walletAddress,
        walletAddressSource,
        rpcReachable: false,
        nativeBalanceWei: null,
        nativeBalance: null,
        nativePriceUsd: asset.eligible ? livePrices.get(asset.symbol) ?? null : null,
        usableNativeGasUsd: null,
        eligibleForReadinessCalculation: asset.eligible,
        observedAt,
        status: 'provider_unavailable' as const,
        reason: `Native balance RPC query failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const nativeBalance = Number(ethers.utils.formatUnits(balance, asset.decimals));
    const nativePriceUsd = asset.eligible ? livePrices.get(asset.symbol) ?? null : null;
    if (!Number.isFinite(nativeBalance)) {
      return {
        chain,
        nativeSymbol: asset.symbol,
        nativeDecimals: asset.decimals,
        walletAddress,
        walletAddressSource,
        rpcReachable: true,
        nativeBalanceWei: balance.toString(),
        nativeBalance: null,
        nativePriceUsd,
        usableNativeGasUsd: null,
        eligibleForReadinessCalculation: asset.eligible,
        observedAt,
        status: 'balance_unknown' as const,
        reason: 'Native balance conversion was not finite',
      };
    }
    if (!asset.eligible) {
      return {
        chain,
        nativeSymbol: asset.symbol,
        nativeDecimals: asset.decimals,
        walletAddress,
        walletAddressSource,
        rpcReachable: true,
        nativeBalanceWei: balance.toString(),
        nativeBalance,
        nativePriceUsd: null,
        usableNativeGasUsd: null,
        eligibleForReadinessCalculation: false,
        observedAt,
        status: 'ineligible' as const,
        exclusionReason: asset.exclusionReason,
      };
    }
    if (nativePriceUsd === null) {
      return {
        chain,
        nativeSymbol: asset.symbol,
        nativeDecimals: asset.decimals,
        walletAddress,
        walletAddressSource,
        rpcReachable: true,
        nativeBalanceWei: balance.toString(),
        nativeBalance,
        nativePriceUsd,
        usableNativeGasUsd: null,
        eligibleForReadinessCalculation: true,
        observedAt,
        status: 'price_unknown' as const,
        reason: `Live USD price for ${asset.symbol} is unavailable${priceError ? `: ${priceError}` : ''}`,
      };
    }

    const usableNativeGasUsd = nativeBalance * nativePriceUsd;
    if (!Number.isFinite(usableNativeGasUsd)) {
      return {
        chain,
        nativeSymbol: asset.symbol,
        nativeDecimals: asset.decimals,
        walletAddress,
        walletAddressSource,
        rpcReachable: true,
        nativeBalanceWei: balance.toString(),
        nativeBalance,
        nativePriceUsd,
        usableNativeGasUsd: null,
        eligibleForReadinessCalculation: true,
        observedAt,
        status: 'balance_unknown' as const,
        reason: 'Native balance USD conversion was not finite',
      };
    }
    return {
      chain,
      nativeSymbol: asset.symbol,
      nativeDecimals: asset.decimals,
      walletAddress,
      walletAddressSource,
      rpcReachable: true,
      nativeBalanceWei: balance.toString(),
      nativeBalance,
      nativePriceUsd,
      usableNativeGasUsd,
      eligibleForReadinessCalculation: true,
      observedAt,
      status: 'verified' as const,
    };
  }));

  if (measurements.length === 0) {
    return {
      status: input.providers.size === 0 ? 'PROVIDER_UNAVAILABLE' : 'BALANCE_UNKNOWN',
      initialGasReady: false,
      thresholdUsd,
      usableNativeGasUsd: null,
      measurements,
      observedAt,
      provenance: ['configured_native_gas_chains'],
      reason: input.providers.size === 0
        ? 'No configured blockchain provider is available'
        : 'No configured execution wallet is available for native-gas readiness',
    };
  }

  const verified = measurements.filter(measurement => measurement.status === 'verified' && measurement.eligibleForReadinessCalculation);
  const best = verified.reduce<InitialGasChainMeasurement | undefined>((current, measurement) => {
    if (!current || (measurement.usableNativeGasUsd ?? 0) > (current.usableNativeGasUsd ?? 0)) return measurement;
    return current;
  }, undefined);
  const usableNativeGasUsd = verified.reduce((total, measurement) => total + (measurement.usableNativeGasUsd ?? 0), 0);
  const hasUnknown = measurements.some(measurement => ['balance_unknown', 'price_unknown', 'provider_unavailable', 'wallet_unavailable'].includes(measurement.status));
  if (usableNativeGasUsd >= thresholdUsd) {
    return {
      status: 'INITIAL_GAS_READY',
      initialGasReady: true,
      thresholdUsd,
      usableNativeGasUsd,
      selectedChain: best.chain,
      measurements,
      observedAt,
      provenance: ['confirmed_native_balance', 'coingecko_live_usd_price'],
    };
  }

  if (hasUnknown) {
    const unknown = measurements.find(measurement => measurement.status !== 'verified');
    const status = unknown?.status === 'price_unknown'
      ? 'PRICE_UNKNOWN'
      : unknown?.status === 'balance_unknown'
        ? 'BALANCE_UNKNOWN'
        : 'PROVIDER_UNAVAILABLE';
    return {
      status,
      initialGasReady: false,
      thresholdUsd,
      usableNativeGasUsd: best?.usableNativeGasUsd ?? null,
      selectedChain: best?.chain,
      measurements,
      observedAt,
      provenance: ['confirmed_native_balance', 'coingecko_live_usd_price'],
      reason: 'Initial native-gas readiness is incomplete; unknown evidence remains gated',
    };
  }

  const total = usableNativeGasUsd;
  return {
    status: total === 0 ? 'GAS_ZERO_BALANCE' : 'GAS_BELOW_THRESHOLD',
    initialGasReady: false,
    thresholdUsd,
    usableNativeGasUsd: total,
    selectedChain: best?.chain,
    measurements,
    observedAt,
    provenance: ['confirmed_native_balance', 'coingecko_live_usd_price'],
    reason: `Verified native-gas readiness is $${total.toFixed(2)}; $${thresholdUsd.toFixed(2)} is required`,
  };
}