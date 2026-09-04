import { ethers } from 'ethers';
import type { DynamicChainConfig } from '../core/dynamic-chain-registry.js';
import { getCryptaraZeroInitialCapitalFundingLearning } from '../../cryptara/zero-capital-funding-learning.js';

export type GasFundingMode = 'sponsored' | 'native' | 'unavailable';

export interface GasFundingDecision {
  chain: string;
  mode: GasFundingMode;
  nativeBalance: bigint;
  reserveFloor: bigint;
  reason: string;
}

export interface GasFundingCandidate extends GasFundingDecision {
  laneId: string;
  operatorNativeGasInputRequired: boolean;
  bootstrapEligible: boolean;
  learningScore: number;
}

/**
 * Funding selection never invents free gas. Sponsored mode means the execution
 * wallet supplies zero native gas up front; the sponsor/provider still bears a
 * monetary gas cost that must be included in the canonical all-in economics or
 * covered by the sponsor's own policy. Native mode is only for already self-funded
 * operation and must never be described as zero-initial-capital cold start.
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
      reason: 'Sponsored execution is ready; operator native-gas input is zero, while sponsor cost remains part of canonical economics/provenance',
    };
  }

  if (nativeBalance >= reserveFloor) {
    return {
      chain: chain.id,
      mode: 'native',
      nativeBalance,
      reserveFloor,
      reason: 'Self-funded native gas reserve is sufficient; actual receipt gas must be measured and subtracted before realized profit is accepted',
    };
  }

  return {
    chain: chain.id,
    mode: 'unavailable',
    nativeBalance,
    reserveFloor,
    reason: 'Neither verified sponsorship nor the required self-funded native gas reserve is available on this chain',
  };
}

/**
 * Returns all currently usable funding choices instead of turning one unavailable
 * provider into a global stop condition. Callers may prepare eligible candidates
 * in parallel and then serialize the actual submission boundary.
 */
export function rankGasFundingCandidates(
  chain: DynamicChainConfig,
  nativeBalance: bigint,
  sponsorReady: boolean,
): GasFundingCandidate[] {
  const decision = chooseGasFundingMode(chain, nativeBalance, sponsorReady);
  const learning = getCryptaraZeroInitialCapitalFundingLearning();
  const candidates: GasFundingCandidate[] = [];

  if (chain.sponsoredBootstrap && sponsorReady) {
    const laneId = `gas:${chain.id}:sponsored`;
    candidates.push({
      chain: chain.id,
      mode: 'sponsored',
      nativeBalance,
      reserveFloor: decision.reserveFloor,
      reason: 'Zero-initial-capital sponsored lane is independently available',
      laneId,
      operatorNativeGasInputRequired: false,
      bootstrapEligible: true,
      learningScore: learning.score(laneId),
    });
  }

  if (nativeBalance >= decision.reserveFloor) {
    const laneId = `gas:${chain.id}:native-self-funded`;
    candidates.push({
      chain: chain.id,
      mode: 'native',
      nativeBalance,
      reserveFloor: decision.reserveFloor,
      reason: 'Previously generated system capital can fund native gas without new operator capital',
      laneId,
      operatorNativeGasInputRequired: true,
      bootstrapEligible: false,
      learningScore: learning.score(laneId),
    });
  }

  return candidates.sort((left, right) => {
    if (left.bootstrapEligible !== right.bootstrapEligible) return left.bootstrapEligible ? -1 : 1;
    return right.learningScore - left.learningScore;
  });
}

export function gasReserveShareBps(): number {
  return Math.max(0, Math.min(5000, Number(process.env.DYNAMIC_GAS_PROFIT_RESERVE_BPS || 500)));
}
