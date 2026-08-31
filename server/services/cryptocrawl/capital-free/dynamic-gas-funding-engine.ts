import { ethers } from 'ethers';
import type { DynamicChainConfig } from '../core/dynamic-chain-registry.js';

export type GasFundingMode = 'sponsored' | 'native' | 'unavailable';

export interface GasFundingDecision {
  chain: string;
  mode: GasFundingMode;
  nativeBalance: bigint;
  reserveFloor: bigint;
  reason: string;
}

/**
 * Zero-capital execution must prove realized all-in profit, not merely receiver
 * token surplus. Sponsored execution has verified zero monetary gas for the
 * execution wallet. Native execution is permitted only when the reserve floor is
 * actually present; terminal settlement then measures receipt gas, converts the
 * native fee to USD, subtracts it from gross receiver profit, and fails closed if
 * that conversion is unavailable. Funding selection never invents zero gas.
 */
export function chooseGasFundingMode(
  chain: DynamicChainConfig,
  nativeBalance: bigint,
  sponsorReady: boolean,
): GasFundingDecision {
  const defaultFloor = ethers.utils.parseEther(process.env.DYNAMIC_GAS_RESERVE_NATIVE || '0.002').toBigInt();
  const specific = process.env[`DYNAMIC_GAS_RESERVE_${chain.nativeAsset}`];
  const reserveFloor = specific ? ethers.utils.parseUnits(specific, 18).toBigInt() : defaultFloor;

  if (chain.sponsoredBootstrap && sponsorReady) {
    return {
      chain: chain.id,
      mode: 'sponsored',
      nativeBalance,
      reserveFloor,
      reason: 'Sponsored execution is ready; final receipt still verifies zero monetary gas before realized-profit accounting',
    };
  }

  if (nativeBalance >= reserveFloor) {
    return {
      chain: chain.id,
      mode: 'native',
      nativeBalance,
      reserveFloor,
      reason: 'Native gas reserve is sufficient; actual receipt gas is terminally converted and subtracted before realized profit is accepted',
    };
  }

  return {
    chain: chain.id,
    mode: 'unavailable',
    nativeBalance,
    reserveFloor,
    reason: 'Neither verified sponsorship nor the required native gas reserve is available',
  };
}

export function gasReserveShareBps(): number {
  return Math.max(0, Math.min(5000, Number(process.env.DYNAMIC_GAS_PROFIT_RESERVE_BPS || 500)));
}
