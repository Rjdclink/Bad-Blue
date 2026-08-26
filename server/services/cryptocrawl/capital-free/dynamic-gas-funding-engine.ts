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

export function chooseGasFundingMode(
  chain: DynamicChainConfig,
  nativeBalance: bigint,
  sponsorReady: boolean,
): GasFundingDecision {
  const defaultFloor = ethers.utils.parseEther(process.env.DYNAMIC_GAS_RESERVE_NATIVE || '0.002').toBigInt();
  const specific = process.env[`DYNAMIC_GAS_RESERVE_${chain.nativeAsset}`];
  const reserveFloor = specific ? ethers.utils.parseUnits(specific, 18).toBigInt() : defaultFloor;
  if (nativeBalance >= reserveFloor) {
    return { chain: chain.id, mode: 'native', nativeBalance, reserveFloor, reason: 'Native gas reserve is sufficient; sponsorship is unnecessary' };
  }
  if (chain.sponsoredBootstrap && sponsorReady) {
    return { chain: chain.id, mode: 'sponsored', nativeBalance, reserveFloor, reason: 'Native reserve is below floor; use sponsored bootstrap/fallback' };
  }
  return { chain: chain.id, mode: 'unavailable', nativeBalance, reserveFloor, reason: 'Neither sufficient native gas nor compatible sponsorship is available' };
}

export function gasReserveShareBps(): number {
  return Math.max(0, Math.min(5000, Number(process.env.DYNAMIC_GAS_PROFIT_RESERVE_BPS || 500)));
}
