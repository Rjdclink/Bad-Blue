import { ethers } from 'ethers';
import type { DynamicChainConfig } from '../core/dynamic-chain-registry.js';

export type GasFundingMode = 'sponsored' | 'native' | 'unavailable';
export type GasFundingPaymentSource =
  | 'provider_sponsored'
  | 'system_owned_native'
  | 'unproven_native_balance'
  | 'unavailable';

export interface GasFundingProofContext {
  /**
   * True only when the provider/paymaster's monetary gas obligation is proven not
   * to be charged to the operator/application. Hosted sponsorship that is billed
   * later is not zero-operator-cost funding and cannot satisfy ZERO_CAPITAL_ATOMIC.
   */
  sponsorOperatorMonetaryCostProvenZero?: boolean;
  /** True only when durable capital provenance proves the native reserve is system-owned. */
  nativeSystemOwnedProven?: boolean;
}

export interface GasFundingDecision {
  chain: string;
  mode: GasFundingMode;
  nativeBalance: bigint;
  reserveFloor: bigint;
  reason: string;
  paymentSource?: GasFundingPaymentSource;
  /** True only when this lane can execute without operator/personal capital or fees. */
  strictZeroInitialCapitalEligible?: boolean;
  /** True only when an operator must add money before or after this exact execution. */
  operatorMonetaryInputRequired?: boolean;
  /** Provider-fronted gas billed to the operator/application is a monetary liability. */
  providerBillingLiability?: boolean;
  /** Independent proof that the sponsor itself creates no operator monetary cost. */
  sponsorOperatorMonetaryCostProvenZero?: boolean;
}

/**
 * ZERO_CAPITAL_ATOMIC is a hard zero-personal-cost boundary: no operator principal,
 * gas, collateral, or provider bill may be introduced by the selected funding lane.
 * This cannot be weakened by environment configuration. A provider-fronted bill is
 * economically real even when it removes an upfront native-token requirement.
 */
export function strictZeroOperatorCostRequired(): boolean {
  return true;
}

/**
 * Select the funding lane for an exact zero-personal-cost attempt.
 *
 * Provider/paymaster sponsorship qualifies only when independent evidence proves
 * the provider cost is not billed back to the operator/application. Native gas can
 * qualify only after durable provenance proves that the reserve was generated or
 * retained by the system itself; its realized gas still belongs in terminal system
 * economics because spending system-owned value is an economic cost.
 */
export function chooseGasFundingMode(
  chain: DynamicChainConfig,
  nativeBalance: bigint,
  sponsorReady: boolean,
  proof: GasFundingProofContext = {},
): GasFundingDecision {
  const defaultFloor = ethers.utils.parseEther(process.env.DYNAMIC_GAS_RESERVE_NATIVE || '0.002').toBigInt();
  const specific = process.env[`DYNAMIC_GAS_RESERVE_${chain.nativeAsset}`];
  const reserveFloor = specific ? ethers.utils.parseUnits(specific, 18).toBigInt() : defaultFloor;
  const sponsorCostProvenZero = proof.sponsorOperatorMonetaryCostProvenZero === true;

  if (chain.sponsoredBootstrap && sponsorReady && sponsorCostProvenZero) {
    return {
      chain: chain.id,
      mode: 'sponsored',
      nativeBalance,
      reserveFloor,
      paymentSource: 'provider_sponsored',
      strictZeroInitialCapitalEligible: true,
      operatorMonetaryInputRequired: false,
      providerBillingLiability: false,
      sponsorOperatorMonetaryCostProvenZero: true,
      reason: 'Provider sponsorship independently proves zero operator monetary gas cost and creates no provider billing liability',
    };
  }

  if (nativeBalance >= reserveFloor && proof.nativeSystemOwnedProven === true) {
    return {
      chain: chain.id,
      mode: 'native',
      nativeBalance,
      reserveFloor,
      paymentSource: 'system_owned_native',
      strictZeroInitialCapitalEligible: true,
      operatorMonetaryInputRequired: false,
      providerBillingLiability: false,
      sponsorOperatorMonetaryCostProvenZero: false,
      reason: 'Native reserve is sufficient and durable provenance proves it is system-owned; actual receipt gas is terminally converted and subtracted from realized system economics',
    };
  }

  const sponsorReason = chain.sponsoredBootstrap && sponsorReady
    ? sponsorCostProvenZero
      ? 'configured sponsorship did not satisfy the executable funding boundary'
      : 'provider sponsorship removes upfront native funding but is not admissible without proof of zero operator billing liability'
    : 'no configured sponsored lane is ready';
  const nativeReason = nativeBalance >= reserveFloor
    ? 'native balance exists but SELF_FUNDED system ownership is not proven at this boundary'
    : 'native balance is below the reserve floor';

  return {
    chain: chain.id,
    mode: 'unavailable',
    nativeBalance,
    reserveFloor,
    paymentSource: nativeBalance >= reserveFloor ? 'unproven_native_balance' : 'unavailable',
    strictZeroInitialCapitalEligible: false,
    operatorMonetaryInputRequired: true,
    providerBillingLiability: chain.sponsoredBootstrap && sponsorReady && !sponsorCostProvenZero,
    sponsorOperatorMonetaryCostProvenZero: false,
    reason: `Zero-personal-cost funding rejected: ${sponsorReason}; ${nativeReason}`,
  };
}

export function gasReserveShareBps(): number {
  return Math.max(0, Math.min(5000, Number(process.env.DYNAMIC_GAS_PROFIT_RESERVE_BPS || 500)));
}
