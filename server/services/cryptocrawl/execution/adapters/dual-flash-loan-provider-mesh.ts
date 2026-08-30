import {
  calculateMeasuredFlashLoanFee,
  type FlashLoanProviderEconomics,
} from './flash-loan-provider-economics.js';

export interface MeasuredDualFlashLoanAllocation {
  balancer: FlashLoanProviderEconomics;
  aave: FlashLoanProviderEconomics;
  balancerAmount: bigint;
  aaveAmount: bigint;
  totalAmount: bigint;
  balancerFee: bigint;
  aaveFee: bigint;
  totalFee: bigint;
  reason: 'combined_liquidity_unlocks_exact_size';
}

function complete(item: FlashLoanProviderEconomics | undefined): item is FlashLoanProviderEconomics {
  return Boolean(
    item &&
    item.executableEvidenceComplete &&
    item.availableLiquidity !== null &&
    item.availableLiquidity > 0n &&
    item.feeBps !== null &&
    item.feeRateNumerator !== null &&
    item.feeRateDenominator !== null,
  );
}

/**
 * Dual borrowing is a liquidity-rescue topology, not a default. If either
 * provider can fund the requested exact size alone, the existing single-provider
 * selector remains authoritative because nesting another flash loan adds gas and
 * callback complexity without improving linear fee economics. The dual path is
 * considered only when neither can fund the size alone but measured combined
 * liquidity can.
 */
export function selectMeasuredDualFlashLoanAllocation(
  evidence: readonly FlashLoanProviderEconomics[],
  requestedAmount: bigint,
): MeasuredDualFlashLoanAllocation | null {
  if (requestedAmount <= 0n) return null;
  const balancer = evidence.find(item => item.provider === 'balancer_v2');
  const aave = evidence.find(item => item.provider === 'aave_v3');
  if (!complete(balancer) || !complete(aave)) return null;
  const balancerLiquidity = balancer.availableLiquidity!;
  const aaveLiquidity = aave.availableLiquidity!;
  if (balancerLiquidity >= requestedAmount || aaveLiquidity >= requestedAmount) return null;
  if (balancerLiquidity + aaveLiquidity < requestedAmount) return null;

  const balancerCheaper = (balancer.feeBps ?? Number.POSITIVE_INFINITY) <= (aave.feeBps ?? Number.POSITIVE_INFINITY);
  let balancerAmount: bigint;
  let aaveAmount: bigint;
  if (balancerCheaper) {
    balancerAmount = balancerLiquidity < requestedAmount ? balancerLiquidity : requestedAmount;
    aaveAmount = requestedAmount - balancerAmount;
  } else {
    aaveAmount = aaveLiquidity < requestedAmount ? aaveLiquidity : requestedAmount;
    balancerAmount = requestedAmount - aaveAmount;
  }
  if (balancerAmount <= 0n || aaveAmount <= 0n) return null;
  if (balancerAmount > balancerLiquidity || aaveAmount > aaveLiquidity) return null;

  const balancerFee = calculateMeasuredFlashLoanFee(balancer, balancerAmount);
  const aaveFee = calculateMeasuredFlashLoanFee(aave, aaveAmount);
  if (balancerFee === null || aaveFee === null) return null;

  return {
    balancer,
    aave,
    balancerAmount,
    aaveAmount,
    totalAmount: requestedAmount,
    balancerFee,
    aaveFee,
    totalFee: balancerFee + aaveFee,
    reason: 'combined_liquidity_unlocks_exact_size',
  };
}
