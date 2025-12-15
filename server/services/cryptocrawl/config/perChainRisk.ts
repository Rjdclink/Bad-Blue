import type { ChainId } from '../bridge/types.js';

export interface PerChainRiskParams {
  chain: ChainId;
  maxSlippageBps: number;
  maxLatencyMs: number;
  maxGasGwei: number;
  /** Exposure cap target (0..1). Canonical target ≈ 6%. */
  exposureTargetFraction: number;
  /** Absolute cap, never unbounded. */
  exposureMaxFraction: number;
}

export const PER_CHAIN_RISK: Record<ChainId, PerChainRiskParams> = {
  polygon: {
    chain: 'polygon',
    maxSlippageBps: 50,
    maxLatencyMs: 800,
    maxGasGwei: 200,
    exposureTargetFraction: 0.06,
    exposureMaxFraction: 0.06,
  },
  arbitrum: {
    chain: 'arbitrum',
    maxSlippageBps: 40,
    maxLatencyMs: 600,
    maxGasGwei: 150,
    exposureTargetFraction: 0.06,
    exposureMaxFraction: 0.06,
  },
  avalanche: {
    chain: 'avalanche',
    maxSlippageBps: 60,
    maxLatencyMs: 900,
    maxGasGwei: 200,
    exposureTargetFraction: 0.06,
    exposureMaxFraction: 0.06,
  },
  bsc: {
    chain: 'bsc',
    maxSlippageBps: 60,
    maxLatencyMs: 900,
    maxGasGwei: 150,
    exposureTargetFraction: 0.06,
    exposureMaxFraction: 0.06,
  },
};

