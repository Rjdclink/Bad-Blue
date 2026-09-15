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
  /** External provider account/subscription billing is outside Cryptara trade economics. */
  providerBillingLiability?: boolean;
  sponsorOperatorMonetaryCostProvenZero?: boolean;
}

/** Strong lifetime-zero-operator-cost mode is retained for compatibility; zero-initial-capital admission is the canonical objective. */
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
  const sponsorCostProvenZero = proof.sponsorOperatorMonetaryCostProvenZero === true;
  const sponsorConfiguredAndReady = chain.sponsoredBootstrap && sponsorReady;

  // Primary sponsored lane: external provider account billing is paid outside Cryptara and
  // therefore is not trade capital, a trade fee, prefunding, or canonical all-in economics.
  if (sponsorConfiguredAndReady) {
    return {
      chain: chain.id,
      mode: 'sponsored',
      nativeBalance,
      reserveFloor,
      paymentSource: 'provider_sponsored',
      strictZeroInitialCapitalEligible: true,
      operatorMonetaryInputRequired: false,
      providerBillingLiability: false,
      sponsorOperatorMonetaryCostProvenZero: sponsorCostProvenZero,
      reason: 'Primary hosted sponsorship removes the upfront wallet-gas requirement; externally paid provider account billing is outside Cryptara trade economics',
    };
  }

  // Fallback to already-proven system-owned native gas if the primary sponsored lane is unavailable.
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

  const sponsorReason = 'no configured sponsored lane is ready';
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
