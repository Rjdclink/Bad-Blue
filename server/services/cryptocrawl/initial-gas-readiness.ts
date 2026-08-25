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
  walletAddress?: string;
  nativeBalanceWei: string | null;
  nativeBalance: number | null;
  nativePriceUsd: number | null;
  usableNativeGasUsd: number | null;
  observedAt: number;
  status: 'verified' | 'balance_unknown' | 'price_unknown' | 'provider_unavailable';
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

const NATIVE_SYMBOLS: Partial<Record<SupportedChain, string>> = {
  ethereum: 'ETH',
  polygon: 'POL',
  arbitrum: 'ETH',
  optimism: 'ETH',
  bsc: 'BNB',
  avalanche: 'AVAX',
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
  environment?: NodeJS.ProcessEnv;
}): Promise<InitialGasReadiness> {
  const thresholdUsd = getInitialGasThresholdUsd(input.environment);
  const observedAt = Date.now();
  const chains = Array.from(input.providers.keys())
    .filter(chain => NATIVE_SYMBOLS[chain])
    .filter(chain => input.walletAddresses.has(chain));
  const symbols = [...new Set(chains.map(chain => NATIVE_SYMBOLS[chain]!))];
  let livePrices: Map<string, number>;
  try {
    livePrices = await coinGeckoPriceClient.getLiveSymbolPrices(symbols);
  } catch {
    livePrices = new Map();
  }

  const measurements = await Promise.all(chains.map(async chain => {
    const provider = input.providers.get(chain)!;
    const walletAddress = input.walletAddresses.get(chain)!;
    const nativeSymbol = NATIVE_SYMBOLS[chain]!;
    const nativePriceUsd = livePrices.get(nativeSymbol) ?? null;
    if (nativePriceUsd === null) {
      return {
        chain,
        nativeSymbol,
        walletAddress,
        nativeBalanceWei: null,
        nativeBalance: null,
        nativePriceUsd,
        usableNativeGasUsd: null,
        observedAt,
        status: 'price_unknown' as const,
        reason: `Live USD price for ${nativeSymbol} is unavailable`,
      };
    }

    try {
      const balance = await provider.getBalance(walletAddress);
      const nativeBalance = Number(ethers.utils.formatEther(balance));
      const usableNativeGasUsd = nativeBalance * nativePriceUsd;
      if (!Number.isFinite(nativeBalance) || !Number.isFinite(usableNativeGasUsd)) {
        throw new Error('Native balance conversion was not finite');
      }
      return {
        chain,
        nativeSymbol,
        walletAddress,
        nativeBalanceWei: balance.toString(),
        nativeBalance,
        nativePriceUsd,
        usableNativeGasUsd,
        observedAt,
        status: 'verified' as const,
      };
    } catch (error) {
      return {
        chain,
        nativeSymbol,
        walletAddress,
        nativeBalanceWei: null,
        nativeBalance: null,
        nativePriceUsd,
        usableNativeGasUsd: null,
        observedAt,
        status: 'balance_unknown' as const,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
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

  const verified = measurements.filter(measurement => measurement.status === 'verified');
  const best = verified.reduce<InitialGasChainMeasurement | undefined>((current, measurement) => {
    if (!current || (measurement.usableNativeGasUsd || 0) > (current.usableNativeGasUsd || 0)) return measurement;
    return current;
  }, undefined);
  const hasUnknown = measurements.some(measurement => measurement.status !== 'verified');
  if (best && (best.usableNativeGasUsd || 0) >= thresholdUsd) {
    return {
      status: 'INITIAL_GAS_READY',
      initialGasReady: true,
      thresholdUsd,
      usableNativeGasUsd: best.usableNativeGasUsd,
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

  const total = best?.usableNativeGasUsd ?? 0;
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