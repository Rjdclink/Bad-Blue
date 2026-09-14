import { ethers } from 'ethers';
import type { DynamicChainConfig } from '../core/dynamic-chain-registry.js';

export type GasFundingMode = 'sponsored' | 'native' | 'unavailable';
export type GasFundingPaymentSource = 'provider_sponsored' | 'system_owned_native' | 'unproven_native_balance' | 'unavailable';

export interface GasFundingProofContext {
  sponsorOperatorMonetaryCostProvenZero?: boolean;
  nativeSystemOwnedProven?: boolean;
}

export interface GasFundingDecision {
  chain: string;
  mode: GasFundingMode;
  nativeBalance: bigint;
  reserveFloor: bigint;
  reason: string;
  paymentSource?: GasFundingPaymentSource;
  /** True when no pre-existing operator/wallet capital is required to submit this execution. */
  strictZeroInitialCapitalEligible?: boolean;
  /** True only when the operator must add money before this exact execution can run. */
  operatorMonetaryInputRequired?: boolean;
  /** Provider-fronted gas may still be billed later and remains a canonical economic cost. */
  providerBillingLiability?: boolean;
  sponsorOperatorMonetaryCostProvenZero?: boolean;
}

/** Strong lifetime-zero-operator-cost mode is opt-in; default objective is zero initial capital. */
export function strictZeroOperatorCostRequired(): boolean {
  return process.env.ZERO_INITIAL_CAPITAL_STRICT_OPERATOR_ZERO_COST?.trim().toLowerCase() === 'true';
}

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

  if (chain.sponsoredBootstrap && sponsorReady && (!requireZeroOperatorCost || sponsorCostProvenZero)) {
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
        : 'Provider sponsorship proves zero upfront wallet/native capital; provider-fronted gas remains a billing liability that canonical all-in economics must charge',
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
    ? requireZeroOperatorCost
      ? 'sponsorship removes upfront native funding but explicit zero-operator-cost mode requires independent proof that the provider bill is zero'
      : 'configured sponsorship did not satisfy the executable funding boundary'
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
    reason: `Zero-initial-capital funding rejected: ${sponsorReason}; ${nativeReason}`,
  };
}

export function gasReserveShareBps(): number {
  return Math.max(0, Math.min(5000, Number(process.env.DYNAMIC_GAS_PROFIT_RESERVE_BPS || 500)));
}
