import {
  calculateMeasuredFlashLoanFee,
  type FlashLoanProviderEconomics,
  type FlashLoanProviderKind,
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
  bestSingleProviderFee: bigint | null;
  measuredFeeSavingsVsBestSingle: bigint | null;
  reason: 'combined_liquidity_unlocks_exact_size' | 'fee_split_beats_single_provider';
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
 * Evaluates Aave+Balancer as a true provider mesh. The lower-fee provider is
 * filled first and the second provider supplies only the exact remainder.
 * The dual path is returned when either:
 * 1) no execution-ready single provider can fund the exact size, or
 * 2) the measured split fee is strictly lower than the best execution-ready
 *    single-provider fee for that same exact size.
 * Exact dual eth_call/estimateGas remains mandatory before broadcast.
 */
export function selectMeasuredDualFlashLoanAllocation(
  evidence: readonly FlashLoanProviderEconomics[],
  requestedAmount: bigint,
  executableSingleProviders: readonly FlashLoanProviderKind[] = ['balancer_v2', 'aave_v3'],
): MeasuredDualFlashLoanAllocation | null {
  if (requestedAmount <= 0n) return null;
  const balancer = evidence.find(item => item.provider === 'balancer_v2');
  const aave = evidence.find(item => item.provider === 'aave_v3');
  if (!complete(balancer) || !complete(aave)) return null;
  const balancerLiquidity = balancer.availableLiquidity!;
  const aaveLiquidity = aave.availableLiquidity!;
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

  // If the cheaper provider can fund the whole trade, nesting the second provider
  // cannot improve linear flash-loan fees and only adds callback/gas complexity.
  if (balancerAmount <= 0n || aaveAmount <= 0n) return null;
  if (balancerAmount > balancerLiquidity || aaveAmount > aaveLiquidity) return null;

  const balancerFee = calculateMeasuredFlashLoanFee(balancer, balancerAmount);
  const aaveFee = calculateMeasuredFlashLoanFee(aave, aaveAmount);
  if (balancerFee === null || aaveFee === null) return null;
  const totalFee = balancerFee + aaveFee;

  const executableSingles = evidence.filter(item =>
    executableSingleProviders.includes(item.provider) &&
    complete(item) &&
    item.availableLiquidity! >= requestedAmount,
  );
  let bestSingleProviderFee: bigint | null = null;
  for (const item of executableSingles) {
    const fee = calculateMeasuredFlashLoanFee(item, requestedAmount);
    if (fee === null) continue;
    if (bestSingleProviderFee === null || fee < bestSingleProviderFee) bestSingleProviderFee = fee;
  }

  if (bestSingleProviderFee !== null && totalFee >= bestSingleProviderFee) return null;
  const measuredFeeSavingsVsBestSingle = bestSingleProviderFee === null
    ? null
    : bestSingleProviderFee - totalFee;

  return {
    balancer,
    aave,
    balancerAmount,
    aaveAmount,
    totalAmount: requestedAmount,
    balancerFee,
    aaveFee,
    totalFee,
    bestSingleProviderFee,
    measuredFeeSavingsVsBestSingle,
    reason: bestSingleProviderFee === null
      ? 'combined_liquidity_unlocks_exact_size'
      : 'fee_split_beats_single_provider',
  };
}
