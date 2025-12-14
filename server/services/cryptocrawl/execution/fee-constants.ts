/**
 * FEE CONSTANTS - Single Source of Truth
 * 
 * Shared constants for signal generator and faucet mesh filter.
 * No duplicated math.
 */

// ============================================================================
// FEE RATES
// ============================================================================

export const FEE_CONSTANTS = {
  // Blended exchange fee (both legs)
  BLENDED_EXCHANGE_FEE_RATE: 0.003, // 0.30% (replaces maker-only assumption)
  
  // Gas fees (both legs)
  GAS_FEE_PER_LEG: 0.0001, // ETH (~$0.10 per leg)
  GAS_FEE_BOTH_LEGS: 0.0002, // ETH (both legs)
  
  // Slippage
  P95_SLIPPAGE_RATE: 0.005, // 0.5% (95th percentile slippage)
  
  // Spread multipliers
  MIN_SPREAD_MULTIPLIER: 1.5, // Production requirement
  TEST_SIGNAL_SPREAD_MULTIPLIER: 2.0, // Test signal override
  ACCEPTANCE_THRESHOLD_MULTIPLIER: 1.30, // 30% buffer for acceptance
  
  // Gas cost limits
  MAX_GAS_TO_GROSS_EDGE_RATIO: 0.15, // Gas must be <= 15% of grossEdge
  
  // Order book depth
  MIN_ORDER_BOOK_DEPTH_MULTIPLIER: 10, // Order book depth ≥ size × 10
  
  // Volatility
  VOLATILITY_SPIKE_THRESHOLD: 2.0, // Standard deviations
  VOLATILITY_LOOKBACK_PERIODS: 20,
  
  // Latency
  MAX_LATENCY_VARIANCE: 50, // ms
  LATENCY_LOOKBACK_COUNT: 10,
} as const;

/**
 * Calculate all-in cost for a trade
 * Includes: blended fees (both legs), gas (both legs), p95 slippage
 */
export function calculateAllInCost(
  baseAmount: number,
  grossEdge: number
): {
  exchangeFees: number;      // Blended fees for both legs
  gasFees: number;          // Gas for both legs
  slippageCost: number;     // P95 slippage cost
  allInCost: number;        // Total all-in cost
} {
  // Exchange fees (both legs) - blended fee rate
  const exchangeFees = baseAmount * FEE_CONSTANTS.BLENDED_EXCHANGE_FEE_RATE * 2; // Both legs
  
  // Gas fees (both legs)
  const gasFees = FEE_CONSTANTS.GAS_FEE_BOTH_LEGS;
  
  // Slippage cost (p95)
  const slippageCost = baseAmount * FEE_CONSTANTS.P95_SLIPPAGE_RATE;
  
  // Total all-in cost
  const allInCost = exchangeFees + gasFees + slippageCost;
  
  return {
    exchangeFees,
    gasFees,
    slippageCost,
    allInCost,
  };
}

/**
 * Calculate minimum base amount to eliminate dust
 * Requires: gas <= 15% of grossEdge
 */
export function calculateMinimumBaseAmount(grossEdge: number): number {
  // gas <= 15% of grossEdge
  // gas = GAS_FEE_BOTH_LEGS
  // GAS_FEE_BOTH_LEGS <= grossEdge * 0.15
  // grossEdge >= GAS_FEE_BOTH_LEGS / 0.15
  
  const minGrossEdge = FEE_CONSTANTS.GAS_FEE_BOTH_LEGS / FEE_CONSTANTS.MAX_GAS_TO_GROSS_EDGE_RATIO;
  
  // For a given grossEdge, we need to find baseAmount such that:
  // grossEdge = baseAmount * profitPercent
  // But we need to solve backwards - if grossEdge is known, what baseAmount gives us that?
  // Actually, we need: baseAmount such that gas <= 15% of (baseAmount * profitPercent)
  // This is circular - we need profitPercent or grossEdge first
  
  // Simplified: assume minimum baseAmount that ensures gas is reasonable
  // If grossEdge = baseAmount * 0.01 (1% profit), then:
  // gas <= baseAmount * 0.01 * 0.15
  // baseAmount >= gas / (0.01 * 0.15) = gas / 0.0015
  
  const minBaseAmount = FEE_CONSTANTS.GAS_FEE_BOTH_LEGS / (0.01 * FEE_CONSTANTS.MAX_GAS_TO_GROSS_EDGE_RATIO);
  
  return minBaseAmount;
}
