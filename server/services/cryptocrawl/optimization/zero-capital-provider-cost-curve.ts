import {
  calculateMeasuredFlashLoanFee,
  type FlashLoanProviderEconomics,
  type FlashLoanProviderKind,
} from '../execution/adapters/flash-loan-provider-economics.js';

export interface ZeroCapitalProviderCostPoint {
  provider: FlashLoanProviderKind;
  amount: bigint;
  exactFee: bigint;
  exactFeeBps: number;
  liquidityHeadroom: bigint;
  evidence: FlashLoanProviderEconomics;
}

export function buildZeroCapitalProviderCostCurve(
  evidence: readonly FlashLoanProviderEconomics[],
  amount: bigint,
  allowedProviders: readonly FlashLoanProviderKind[] = ['balancer_v2', 'aave_v3'],
): ZeroCapitalProviderCostPoint[] {
  if (amount <= 0n) return [];
  const allowed = new Set(allowedProviders);
  const points: ZeroCapitalProviderCostPoint[] = [];
  for (const item of evidence) {
    if (!allowed.has(item.provider) || !item.executableEvidenceComplete) continue;
    if (item.availableLiquidity === null || item.availableLiquidity < amount) continue;
    const exactFee = calculateMeasuredFlashLoanFee(item, amount);
    if (exactFee === null) continue;
    points.push({
      provider: item.provider,
      amount,
      exactFee,
      exactFeeBps: Number((exactFee * 10_000n) / amount),
      liquidityHeadroom: item.availableLiquidity - amount,
      evidence: item,
    });
  }
  return points.sort((left, right) => {
    if (left.exactFee !== right.exactFee) return left.exactFee < right.exactFee ? -1 : 1;
    if (left.exactFeeBps !== right.exactFeeBps) return left.exactFeeBps - right.exactFeeBps;
    if (left.liquidityHeadroom !== right.liquidityHeadroom) return left.liquidityHeadroom > right.liquidityHeadroom ? -1 : 1;
    return left.provider.localeCompare(right.provider);
  });
}

export function selectLowestExactProviderCost(
  evidence: readonly FlashLoanProviderEconomics[],
  amount: bigint,
  allowedProviders: readonly FlashLoanProviderKind[] = ['balancer_v2', 'aave_v3'],
): ZeroCapitalProviderCostPoint | null {
  return buildZeroCapitalProviderCostCurve(evidence, amount, allowedProviders)[0] ?? null;
}
