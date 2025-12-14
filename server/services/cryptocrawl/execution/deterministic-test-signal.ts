/**
 * DETERMINISTIC TEST SIGNAL GENERATOR (Stage 5)
 * 
 * Outputs exactly one candidate with:
 * - Single exchange
 * - Single pair (high liquidity)
 * - Maker-only assumption
 * - Spread floor that clears fees
 * - Dust size
 * 
 * Cannot be optimized into chaos.
 * If fails faucet mesh → stop and ask human for permission to adjust one parameter only.
 */

import { createLogger } from '../../../logger';
import type { SignalInput } from '../decision-engine';
import { getExecutionChokePoint } from './execution-choke-point';

const log = createLogger('DeterministicTestSignal');

// ============================================================================
// FIXED PARAMETERS (Stage 5 - No Optimization)
// ============================================================================

const STAGE_5_FIXED_CONFIG = {
  exchange: 'uniswap-v3',
  pair: 'LINK/USDT', // High liquidity, wider spread
  size: 'dust' as const,
  baseAmount: 0.0005, // Dust size (0.0005 ETH)
  makerFeeRate: 0.0008, // 0.08% maker fee (fixed)
  estimatedGasFee: 0.0001, // Fixed gas estimate
  spreadMultiplier: 2.0, // Spread must be ≥ fees × 2.0 (fixed)
  volatility: 0.3, // Low volatility (fixed)
  liquidityScore: 0.92, // High liquidity (fixed)
};

// ============================================================================
// DETERMINISTIC TEST SIGNAL GENERATOR
// ============================================================================

export interface DeterministicTestSignalResult {
  signal: SignalInput | null;
  passed: boolean;
  reason: string;
  requiresHumanPermission: boolean;
  permissionRequest?: {
    parameter: string;
    currentValue: unknown;
    proposedValue: unknown;
    reason: string;
  };
}

/**
 * Generate exactly one deterministic test signal (Stage 5)
 * No optimization, no chaos, fixed parameters only
 */
export function generateDeterministicTestSignal(): DeterministicTestSignalResult {
  log.info('Generating deterministic test signal (Stage 5)', STAGE_5_FIXED_CONFIG);

  // Calculate required spread (fixed calculation)
  const estimatedExchangeFee = STAGE_5_FIXED_CONFIG.baseAmount * STAGE_5_FIXED_CONFIG.makerFeeRate;
  const totalFees = STAGE_5_FIXED_CONFIG.estimatedGasFee + estimatedExchangeFee;
  const minRequiredSpread = totalFees * STAGE_5_FIXED_CONFIG.spreadMultiplier;
  const profitEstimate = minRequiredSpread * 1.1; // 10% buffer (fixed)

  // Create exactly one signal
  const signal: SignalInput = {
    sourceId: 'deterministic-test-signal-generator',
    sourceType: 'cryptocrawl',
    signal: {
      opportunity: {
        asset: 'LINK',
        pair: STAGE_5_FIXED_CONFIG.pair,
        chain: 'ethereum',
        profitEstimate,
        confidence: 0.78, // Fixed confidence
        timestamp: Date.now(),
      },
      marketData: {
        volatility: STAGE_5_FIXED_CONFIG.volatility,
        liquidityScore: STAGE_5_FIXED_CONFIG.liquidityScore,
        gasVolatility: 0.1, // Fixed
        competitorDensity: 0.2, // Fixed
        networkCongestion: 0.3, // Fixed
      },
    },
    metadata: {
      exchange: STAGE_5_FIXED_CONFIG.exchange,
      size: STAGE_5_FIXED_CONFIG.size,
      testSignal: true,
      useMakerOnlyFees: true,
      spreadMultiplier: STAGE_5_FIXED_CONFIG.spreadMultiplier,
      deterministic: true, // Mark as deterministic
    },
  };

  log.info('Deterministic test signal generated', {
    pair: STAGE_5_FIXED_CONFIG.pair,
    profitEstimate,
    totalFees,
    spreadMultiplier: profitEstimate / totalFees,
  });

  return {
    signal,
    passed: true,
    reason: 'Deterministic test signal generated with fixed parameters',
    requiresHumanPermission: false,
  };
}

/**
 * Check if signal failed faucet mesh and request human permission for one parameter adjustment
 */
export function checkFaucetMeshFailure(
  signal: SignalInput,
  failureReason: string
): DeterministicTestSignalResult {
  log.warn('Faucet mesh failure detected - requesting human permission', {
    failureReason,
    signal: signal.signal.opportunity,
  });

  // Determine which parameter to request adjustment for
  let parameter: string;
  let currentValue: unknown;
  let proposedValue: unknown;
  let reason: string;

  if (failureReason.includes('spread')) {
    parameter = 'spreadMultiplier';
    currentValue = STAGE_5_FIXED_CONFIG.spreadMultiplier;
    proposedValue = STAGE_5_FIXED_CONFIG.spreadMultiplier * 1.5; // Increase by 50%
    reason = 'Spread insufficient - request permission to increase spread multiplier';
  } else if (failureReason.includes('liquidity')) {
    parameter = 'liquidityScore';
    currentValue = STAGE_5_FIXED_CONFIG.liquidityScore;
    proposedValue = 0.95; // Increase liquidity requirement
    reason = 'Liquidity insufficient - request permission to increase liquidity score';
  } else if (failureReason.includes('volatility')) {
    parameter = 'volatility';
    currentValue = STAGE_5_FIXED_CONFIG.volatility;
    proposedValue = 0.25; // Decrease volatility
    reason = 'Volatility too high - request permission to decrease volatility threshold';
  } else {
    parameter = 'baseAmount';
    currentValue = STAGE_5_FIXED_CONFIG.baseAmount;
    proposedValue = STAGE_5_FIXED_CONFIG.baseAmount * 0.8; // Decrease size
    reason = 'Size issue - request permission to adjust base amount';
  }

  return {
    signal: null,
    passed: false,
    reason: `Faucet mesh failed: ${failureReason}. Human permission required for parameter adjustment.`,
    requiresHumanPermission: true,
    permissionRequest: {
      parameter,
      currentValue,
      proposedValue,
      reason,
    },
  };
}
