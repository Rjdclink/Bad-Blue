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
   * to be charged to the operator/application. This is stronger than zero initial
   * wallet capital: hosted sponsorship can remove the native-balance prerequisite
   * while still creating a provider-billing liability that belongs in economics.
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
  /** True when this lane can execute without any pre-existing operator/wallet capital injection. */
  strictZeroInitialCapitalEligible?: boolean;
  /** True only when an operator must add money before this exact execution can run. */
  operatorMonetaryInputRequired?: boolean;
  /** Hosted sponsorship may be billed later even though it requires no upfront native balance. */
  providerBillingLiability?: boolean;
  /** Independent proof that the sponsor itself creates no operator monetary cost. */
  sponsorOperatorMonetaryCostProvenZero?: boolean;
}

/**
 * Zero INITIAL capital is the production objective. A stronger "zero operator
 * monetary cost ever" mode is available only when explicitly requested. Keeping
 * it opt-in prevents a provider-fronted paymaster bill from being confused with an
 * upfront native-token requirement while preserving a strict fail-closed option.
 */
export function strictZeroOperatorCostRequired(): boolean {
  return process.env.ZERO_INITIAL_CAPITAL_STRICT_OPERATOR_ZERO_COST?.trim().toLowerCase() === 'true';
}

/**
 * Select the funding lane for an exact zero-initial-capital attempt.
 *
 * A real paymaster/Wallet-API sponsorship can satisfy zero initial capital because
 * the execution account needs no pre-existing native gas. It does NOT imply free
 * gas: unless independent proof establishes zero sponsor cost, the provider-fronted
 * gas remains a billing liability and must be charged by canonical economics.
 *
 * Native gas can satisfy zero initial capital only after durable provenance proves
 * that the reserve was generated/retained by the system itself. An unexplained
 * wallet balance never becomes bootstrap authority merely because it exists.
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
  const requireZeroOperatorCost = strictZeroOperatorCostRequired();
  const sponsorCostProvenZero = proof.sponsorOperatorMonetaryCostProvenZero === true;

  if (chain.sponsoredBootstrap && sponsorReady) {
    if (!requireZeroOperatorCost || sponsorCostProvenZero) {
      return {
        chain: chain.id,
        mode: 'sponsored',
        nativeBalance,
        reserveFloor,
        paymentSource: 'provider_sponsored',
        strictZeroInitialCapitalEligible: true,
        operatorMonetaryInputRequired: false,
        providerBillingLiability: !sponsorCostProvenZero,
        sponsorOperatorMonetaryCostProvenZero: sponsorCostProvenZero,
        reason: sponsorCostProvenZero
          ? 'Provider sponsorship proves zero upfront wallet capital and independently proves zero operator monetary gas cost'
          : 'Provider sponsorship proves zero upfront wallet/native capital; provider-fronted gas remains a billing liability that canonical realized economics must charge',
      };
    }
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
      reason: 'Native reserve is sufficient and durable provenance proves it is system-owned; actual receipt gas is terminally converted and subtracted from realized economics',
    };
  }

  const sponsorReason = chain.sponsoredBootstrap && sponsorReady
    ? requireZeroOperatorCost
      ? 'sponsorship removes upfront native funding but explicit zero-operator-cost mode requires independent proof that the provider bill is zero'
      : 'configured sponsorship is not execution-ready at this boundary'
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
    providerBillingLiability: false,
    sponsorOperatorMonetaryCostProvenZero: false,
    reason: `Zero-initial-capital funding rejected: ${sponsorReason}; ${nativeReason}`,
  };
}

export function gasReserveShareBps(): number {
  return Math.max(0, Math.min(5000, Number(process.env.DYNAMIC_GAS_PROFIT_RESERVE_BPS || 500)));
}
