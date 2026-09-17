import type { providers } from 'ethers';
import { livePriceMesh } from '../bridge/live-price-mesh.js';
import type { GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';
import type {
  ConfiguredZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import type { SupportedExecutionChain } from '../execution/adapters/onchain-payload-builder.js';
import { getGasSponsorManager } from '../strategies/gas-sponsorship.js';

const NATIVE_SYMBOL: Record<Exclude<SupportedExecutionChain, 'europa'>, 'ETH' | 'POL' | 'BNB' | 'AVAX'> = {
  ethereum: 'ETH',
  polygon: 'POL',
  arbitrum: 'ETH',
  optimism: 'ETH',
  bsc: 'BNB',
  avalanche: 'AVAX',
};

type GasCostAuthority =
  | 'verified_sponsored_operator_cost_zero'
  | 'measured_system_owned_native_gas'
  | 'measured_sponsored_billing_liability'
  | 'measured_unfunded_observation_gas';

export interface ConfiguredGasEconomicsResult {
  routes: ConfiguredZeroCapitalRoute[];
  gasCostAuthority: GasCostAuthority;
  estimatedGasUnits: number;
  expectedGasPriceWei: bigint;
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, normalized));
}

export function expectedExecutionGasPriceWei(feeData: providers.FeeData): bigint {
  if (feeData.gasPrice?.gt(0)) return BigInt(feeData.gasPrice.toString());
  if (feeData.lastBaseFeePerGas?.gt(0)) {
    const priority = feeData.maxPriorityFeePerGas?.gt(0)
      ? BigInt(feeData.maxPriorityFeePerGas.toString())
      : 0n;
    return BigInt(feeData.lastBaseFeePerGas.toString()) + priority;
  }
  if (feeData.maxFeePerGas?.gt(0)) return BigInt(feeData.maxFeePerGas.toString());
  return 0n;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Gas conversion denominator must be positive');
  return (numerator + denominator - 1n) / denominator;
}

function gasUsdToTokenBaseUnits(gasUsd: number, tokenUsd: number, decimals: number): string {
  if (!Number.isFinite(gasUsd) || gasUsd <= 0) throw new Error('Measured gas USD cost must be positive');
  if (!Number.isFinite(tokenUsd) || tokenUsd <= 0) throw new Error('Live input-token USD price must be positive');
  const normalizedDecimals = Math.max(0, Math.min(36, Math.trunc(decimals)));
  const gasMicroUsd = BigInt(Math.max(1, Math.ceil(gasUsd * 1_000_000)));
  const tokenMicroUsd = BigInt(Math.max(1, Math.floor(tokenUsd * 1_000_000)));
  return ceilDiv(gasMicroUsd * (10n ** BigInt(normalizedDecimals)), tokenMicroUsd).toString();
}

function zeroOperatorGasCostProven(funding: GasFundingDecision): boolean {
  return funding.mode === 'sponsored'
    && funding.paymentSource === 'provider_sponsored'
    && funding.sponsorOperatorMonetaryCostProvenZero === true
    && funding.providerBillingLiability === false;
}

function authorityFor(funding: GasFundingDecision): GasCostAuthority {
  if (funding.mode === 'native' && funding.paymentSource === 'system_owned_native') {
    return 'measured_system_owned_native_gas';
  }
  if (funding.mode === 'sponsored' && funding.providerBillingLiability === true) {
    return 'measured_sponsored_billing_liability';
  }
  return 'measured_unfunded_observation_gas';
}

function applyBpsSurcharge(units: number, surchargeBps: number): number {
  if (units <= 0) return 0;
  return Math.ceil(units * (10_000 + Math.max(0, surchargeBps)) / 10_000);
}

/**
 * Price configured zero-capital routes before they enter Stage One BPS admission.
 *
 * Static route definitions intentionally carry a zero seed. This boundary replaces
 * that seed with the gas economics of the gas authority that will actually submit
 * the transaction. During bootstrap that authority is Pimlico, so Stage One uses
 * Pimlico's live UserOperation gas price plus ERC-4337/paymaster overhead before a
 * spread is surfaced. After the durable self-funded transition, the same boundary
 * automatically returns to measured native gas economics.
 */
export async function enrichConfiguredZeroCapitalGasEconomics(
  chain: SupportedExecutionChain,
  provider: providers.Provider,
  routes: readonly ConfiguredZeroCapitalRoute[],
  funding: GasFundingDecision,
): Promise<ConfiguredGasEconomicsResult> {
  if (chain === 'europa' || routes.length === 0) {
    return {
      routes: [...routes],
      gasCostAuthority: 'measured_unfunded_observation_gas',
      estimatedGasUnits: 0,
      expectedGasPriceWei: 0n,
    };
  }

  if (zeroOperatorGasCostProven(funding)) {
    return {
      routes: routes.map(route => ({ ...route, estimatedGasCostInInputToken: '0' })),
      gasCostAuthority: 'verified_sponsored_operator_cost_zero',
      estimatedGasUnits: 0,
      expectedGasPriceWei: 0n,
    };
  }

  const baseEstimatedGasUnits = Math.floor(bounded(
    process.env.ZERO_CAPITAL_CONFIGURED_EXECUTION_GAS_UNITS,
    1_400_000,
    100_000,
    5_000_000,
  ));
  const safetyMultiplier = bounded(
    process.env.ZERO_CAPITAL_CONFIGURED_GAS_SAFETY_MULTIPLIER,
    chain === 'optimism' ? 1.75 : 1.25,
    1,
    3,
  );
  const nativeSymbol = NATIVE_SYMBOL[chain];
  const inputSymbols = [...new Set(routes.map(route => route.inputAssetSymbol))];
  const sponsor = getGasSponsorManager();

  const pricesPromise = livePriceMesh.getLiveSymbolPrices([nativeSymbol, ...inputSymbols]);
  let estimatedGasUnits = baseEstimatedGasUnits;
  let gasPricePromise: Promise<bigint>;

  if (funding.mode === 'sponsored' && funding.paymentSource === 'provider_sponsored') {
    const network = await provider.getNetwork();
    estimatedGasUnits = applyBpsSurcharge(
      baseEstimatedGasUnits + sponsor.getStageOneOverheadGasUnits(),
      funding.providerBillingLiability === true ? sponsor.getBillingSurchargeBps() : 0,
    );
    gasPricePromise = sponsor.getGasPriceQuote(network.chainId).then(quote => quote.maxFeePerGasWei);
  } else {
    gasPricePromise = provider.getFeeData().then(expectedExecutionGasPriceWei);
  }

  const [gasPriceWei, prices] = await Promise.all([gasPricePromise, pricesPromise]);
  const nativeUsd = prices.get(nativeSymbol);
  if (gasPriceWei <= 0n || !Number.isFinite(nativeUsd) || Number(nativeUsd) <= 0) {
    throw new Error(`Configured ${chain} route gas economics unavailable`);
  }

  const gasNative = (Number(gasPriceWei) * estimatedGasUnits) / 1e18;
  const gasUsd = gasNative * Number(nativeUsd) * safetyMultiplier;
  if (!Number.isFinite(gasUsd) || gasUsd <= 0) {
    throw new Error(`Configured ${chain} route gas conversion unavailable`);
  }

  return {
    routes: routes.map(route => {
      const inputUsd = prices.get(route.inputAssetSymbol);
      if (!Number.isFinite(inputUsd) || Number(inputUsd) <= 0) {
        throw new Error(`Live ${route.inputAssetSymbol}/USD evidence unavailable for configured gas economics`);
      }
      return {
        ...route,
        estimatedGasCostInInputToken: gasUsdToTokenBaseUnits(gasUsd, Number(inputUsd), route.inputTokenDecimals),
      };
    }),
    gasCostAuthority: authorityFor(funding),
    estimatedGasUnits,
    expectedGasPriceWei: gasPriceWei,
  };
}
