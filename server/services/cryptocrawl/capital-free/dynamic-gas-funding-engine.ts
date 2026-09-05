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
   * to be charged to the operator/application. A configured hosted sponsorship
   * policy by itself is not that proof.
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
  strictZeroInitialCapitalEligible?: boolean;
  operatorMonetaryInputRequired?: boolean;
}

function strictZeroOperatorCostRequired(): boolean {
  return process.env.ZERO_INITIAL_CAPITAL_STRICT_OPERATOR_ZERO_COST?.trim().toLowerCase() !== 'false';
}

/**
 * Selects execution gas without converting a wallet-level gas abstraction into a
 * false zero-operator-cost claim.
 *
 * In strict zero-initial-capital mode (the default), a hosted paymaster is not
 * bootstrap-eligible merely because the execution wallet spends zero native gas:
 * the provider's monetary charge must independently be proven not to fall on the
 * operator/application. Likewise, a positive execution-wallet native balance is
 * not system capital merely because it exists; SELF_FUNDED provenance must prove
 * ownership before that balance can satisfy strict zero-capital funding.
 *
 * Non-strict mode preserves the legacy sponsored/native behavior for callers that
 * explicitly opt out of the strict zero-operator-cost requirement.
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
  const strict = strictZeroOperatorCostRequired();

  if (chain.sponsoredBootstrap && sponsorReady) {
    const strictEligible = proof.sponsorOperatorMonetaryCostProvenZero === true;
    if (!strict || strictEligible) {
      return {
        chain: chain.id,
        mode: 'sponsored',
        nativeBalance,
        reserveFloor,
        paymentSource: 'provider_sponsored',
        strictZeroInitialCapitalEligible: strictEligible,
        operatorMonetaryInputRequired: !strictEligible,
        reason: strictEligible
          ? 'Sponsored execution is proven to impose zero operator monetary gas input; provider cost remains in canonical economics/provenance'
          : 'Non-strict mode permits configured sponsorship even though zero operator monetary cost is not independently proven',
      };
    }
  }

  if (nativeBalance >= reserveFloor) {
    const strictEligible = proof.nativeSystemOwnedProven === true;
    if (!strict || strictEligible) {
      return {
        chain: chain.id,
        mode: 'native',
        nativeBalance,
        reserveFloor,
        paymentSource: strictEligible ? 'system_owned_native' : 'unproven_native_balance',
        strictZeroInitialCapitalEligible: strictEligible,
        operatorMonetaryInputRequired: !strictEligible,
        reason: strictEligible
          ? 'Native reserve is sufficient and durable provenance proves it is system-owned; actual receipt gas remains canonical realized cost'
          : 'Non-strict mode permits the available native balance without treating it as proven system-owned bootstrap capital',
      };
    }
  }

  const sponsorReason = chain.sponsoredBootstrap && sponsorReady
    ? 'configured hosted sponsorship does not prove zero operator monetary cost'
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
    reason: strict
      ? `Strict zero-initial-capital funding rejected: ${sponsorReason}; ${nativeReason}`
      : 'Neither configured sponsorship nor the required native gas reserve is available',
  };
}

export function gasReserveShareBps(): number {
  return Math.max(0, Math.min(5000, Number(process.env.DYNAMIC_GAS_PROFIT_RESERVE_BPS || 500)));
}
