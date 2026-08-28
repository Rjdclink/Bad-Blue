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
 * Zero-capital execution must be able to prove realized all-in profit, not only
 * contract-level token profit. Sponsored execution has measured zero monetary
 * gas. Native-funded trading remains observation/reserve evidence only until the
 * settlement layer has a measured native-gas -> input-token/USD conversion for
 * the actual receipt fee; otherwise realized net profit would be unknowable.
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
      reason: 'Sponsored execution is ready and preserves measured zero-monetary-gas settlement accounting',
    };
  }

  if (nativeBalance >= reserveFloor) {
    return {
      chain: chain.id,
      mode: 'unavailable',
      nativeBalance,
      reserveFloor,
      reason: 'Native gas reserve is sufficient, but live trading is fail-closed until actual receipt gas has measured same-unit realized-profit conversion',
    };
  }

  return {
    chain: chain.id,
    mode: 'unavailable',
    nativeBalance,
    reserveFloor,
    reason: 'Neither settlement-accountable sponsorship nor executable native-gas accounting is available',
  };
}

export function gasReserveShareBps(): number {
  return Math.max(0, Math.min(5000, Number(process.env.DYNAMIC_GAS_PROFIT_RESERVE_BPS || 500)));
}
