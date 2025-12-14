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
import { FEE_CONSTANTS, calculateAllInCost, calculateMinimumBaseAmount } from './fee-constants';

const log = createLogger('DeterministicTestSignal');

// ============================================================================
// FIXED PARAMETERS (Stage 5 - Unified Fee Model)
// ============================================================================

const STAGE_5_FIXED_CONFIG = {
  exchange: 'uniswap-v3',
  pair: 'LINK/USDT', // High liquidity, wider spread
  size: 'dust' as const,
  baseAmount: 0.001, // Increased to eliminate dust (will be calculated dynamically)
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
 * Unified fee model, all-in cost calculation, hard acceptance threshold
 */
export function generateDeterministicTestSignal(): DeterministicTestSignalResult {
  log.info('Generating deterministic test signal (Stage 5)', STAGE_5_FIXED_CONFIG);

  // Start with base amount
  let baseAmount = STAGE_5_FIXED_CONFIG.baseAmount;
  let profitPercent = 0.01; // Start with 1% profit margin
  
  // ENFORCE: grossEdge >= allInCost * 1.30 (30% buffer)
  // ENFORCE: fees+slippage <= 15% of grossEdge (no dust, ever)
  // Iterate to find baseAmount and profitPercent that satisfy both constraints
  
  let grossEdge = baseAmount * profitPercent;
  let costAnalysis = calculateAllInCost(baseAmount, grossEdge);
  let allInCost = costAnalysis.allInCost;
  let iterations = 0;
  const maxIterations = 100;
  
  while (iterations < maxIterations) {
    // Calculate all-in cost
    costAnalysis = calculateAllInCost(baseAmount, grossEdge);
    allInCost = costAnalysis.allInCost;
    
    // Constraint 1: grossEdge >= allInCost * ACCEPTANCE_THRESHOLD_MULTIPLIER (1.30)
    const minRequiredGrossEdge = allInCost * FEE_CONSTANTS.ACCEPTANCE_THRESHOLD_MULTIPLIER;
    
    // Constraint 2: fees+slippage <= 15% of grossEdge
    const feesAndSlippage = costAnalysis.exchangeFees + costAnalysis.slippageCost;
    const maxFeesAndSlippage = grossEdge * FEE_CONSTANTS.MAX_GAS_TO_GROSS_EDGE_RATIO;
    
    // Check if both constraints are satisfied
    const constraint1Satisfied = grossEdge >= minRequiredGrossEdge;
    const constraint2Satisfied = feesAndSlippage <= maxFeesAndSlippage;
    
    if (constraint1Satisfied && constraint2Satisfied) {
      break; // Both constraints satisfied
    }
    
    // Adjust parameters to satisfy constraints
    if (!constraint1Satisfied) {
      // Increase grossEdge to meet threshold
      grossEdge = minRequiredGrossEdge * 1.1; // Add 10% buffer
      profitPercent = grossEdge / baseAmount;
    }
    
    if (!constraint2Satisfied) {
      // Increase baseAmount to reduce fees+slippage ratio
      baseAmount *= 1.1; // Increase by 10%
      grossEdge = baseAmount * profitPercent; // Recalculate grossEdge
    }
    
    iterations++;
  }
  
  if (iterations >= maxIterations) {
    return {
      signal: null,
      passed: false,
      reason: `Failed to satisfy constraints after ${maxIterations} iterations. Cannot eliminate dust or meet acceptance threshold.`,
      requiresHumanPermission: true,
      permissionRequest: {
        parameter: 'baseAmount',
        currentValue: STAGE_5_FIXED_CONFIG.baseAmount,
        proposedValue: baseAmount * 1.5,
        reason: 'Increase baseAmount to satisfy constraints',
      },
    };
  }
  
  // Final validation: ensure all constraints are met
  const finalCostAnalysis = calculateAllInCost(baseAmount, grossEdge);
  const finalAllInCost = finalCostAnalysis.allInCost;
  const finalMinGrossEdge = finalAllInCost * FEE_CONSTANTS.ACCEPTANCE_THRESHOLD_MULTIPLIER;
  const finalFeesAndSlippage = finalCostAnalysis.exchangeFees + finalCostAnalysis.slippageCost;
  const finalMaxFeesAndSlippage = grossEdge * FEE_CONSTANTS.MAX_GAS_TO_GROSS_EDGE_RATIO;
  
  if (grossEdge < finalMinGrossEdge) {
    return {
      signal: null,
      passed: false,
      reason: `Final validation failed: grossEdge ${grossEdge.toFixed(6)} < required ${finalMinGrossEdge.toFixed(6)} (allInCost * ${FEE_CONSTANTS.ACCEPTANCE_THRESHOLD_MULTIPLIER})`,
      requiresHumanPermission: false,
    };
  }
  
  if (finalFeesAndSlippage > finalMaxFeesAndSlippage) {
    return {
      signal: null,
      passed: false,
      reason: `Final validation failed: fees+slippage ${finalFeesAndSlippage.toFixed(6)} > max ${finalMaxFeesAndSlippage.toFixed(6)} (15% of grossEdge)`,
      requiresHumanPermission: false,
    };
  }

  // Profit estimate = grossEdge
  const profitEstimate = grossEdge;
  
  // Calculate net edge
  const netEdge = grossEdge - allInCost;

  // Diagnostics logging
  log.info('Deterministic test signal generated', {
    pair: STAGE_5_FIXED_CONFIG.pair,
    baseAmount,
    grossEdge,
    allInCost,
    netEdge,
    exchangeFees: calculateAllInCost(baseAmount, grossEdge).exchangeFees,
    gasFees: calculateAllInCost(baseAmount, grossEdge).gasFees,
    slippageCost: calculateAllInCost(baseAmount, grossEdge).slippageCost,
    acceptanceThreshold: allInCost * FEE_CONSTANTS.TEST_SIGNAL_SPREAD_MULTIPLIER,
    gasToGrossRatio: FEE_CONSTANTS.GAS_FEE_BOTH_LEGS / grossEdge,
    passThreshold: grossEdge >= allInCost * FEE_CONSTANTS.TEST_SIGNAL_SPREAD_MULTIPLIER,
  });

  // Create signal opportunity (one candidate)
  const opportunity = {
    asset: 'LINK',
    pair: STAGE_5_FIXED_CONFIG.pair,
    chain: 'ethereum',
    profitEstimate,
    confidence: 0.78, // Fixed confidence
    timestamp: Date.now(),
  };

  const marketData = {
    volatility: STAGE_5_FIXED_CONFIG.volatility,
    liquidityScore: STAGE_5_FIXED_CONFIG.liquidityScore,
    gasVolatility: 0.1, // Fixed
    competitorDensity: 0.2, // Fixed
    networkCongestion: 0.3, // Fixed
  };

  const metadata = {
    exchange: STAGE_5_FIXED_CONFIG.exchange,
    size: STAGE_5_FIXED_CONFIG.size,
    baseAmount, // Store actual baseAmount used
    testSignal: true,
    useMakerOnlyFees: false, // Using blended fees now
    spreadMultiplier: FEE_CONSTANTS.TEST_SIGNAL_SPREAD_MULTIPLIER,
    deterministic: true,
    // Store diagnostics
    grossEdge,
    allInCost,
    netEdge,
  };

  // Generate 2 signals with same opportunity (for signal fusion gate requirement)
  // This represents "one candidate" opportunity from multiple sources
  const signal: SignalInput = {
    sourceId: 'deterministic-test-signal-generator-1',
    sourceType: 'cryptocrawl',
    signal: {
      opportunity,
      marketData,
    },
    metadata,
  };

  // Return single signal (caller can duplicate if needed for signal fusion)
  return {
    signal,
    passed: true,
    reason: 'Deterministic test signal generated with unified fee model and hard acceptance threshold',
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
