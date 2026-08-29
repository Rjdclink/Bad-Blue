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
  liquidityUtilization: number;
  evidenceAgeMs: number;
  evidence: FlashLoanProviderEconomics;
}

function providerEvidenceMaxAgeMs(): number {
  const parsed = Number(process.env.ZERO_CAPITAL_FLASH_PROVIDER_EVIDENCE_TTL_MS || 2_500);
  return Number.isFinite(parsed) ? Math.max(250, Math.min(15_000, Math.trunc(parsed))) : 2_500;
}

export function buildZeroCapitalProviderCostCurve(
  evidence: readonly FlashLoanProviderEconomics[],
  amount: bigint,
  allowedProviders: readonly FlashLoanProviderKind[] = ['balancer_v2', 'aave_v3'],
): ZeroCapitalProviderCostPoint[] {
  if (amount <= 0n) return [];
  const allowed = new Set(allowedProviders);
  const points: ZeroCapitalProviderCostPoint[] = [];
  const now = Date.now();
  const maxAgeMs = providerEvidenceMaxAgeMs();
  for (const item of evidence) {
    if (!allowed.has(item.provider) || !item.executableEvidenceComplete) continue;
    const evidenceAgeMs = Math.max(0, now - item.observedAt);
    if (evidenceAgeMs > maxAgeMs) continue;
    if (item.availableLiquidity === null || item.availableLiquidity < amount || item.availableLiquidity <= 0n) continue;
    const exactFee = calculateMeasuredFlashLoanFee(item, amount);
    if (exactFee === null) continue;
    const utilization = Number(amount) / Number(item.availableLiquidity);
    const liquidityUtilization = Number.isFinite(utilization)
      ? Math.max(0, Math.min(1, utilization))
      : 1;
    points.push({
      provider: item.provider,
      amount,
      exactFee,
      exactFeeBps: Number((exactFee * 10_000n) / amount),
      liquidityHeadroom: item.availableLiquidity - amount,
      liquidityUtilization,
      evidenceAgeMs,
      evidence: item,
    });
  }
  return points.sort((left, right) => {
    if (left.exactFee !== right.exactFee) return left.exactFee < right.exactFee ? -1 : 1;
    if (left.exactFeeBps !== right.exactFeeBps) return left.exactFeeBps - right.exactFeeBps;
    if (left.liquidityUtilization !== right.liquidityUtilization) return left.liquidityUtilization - right.liquidityUtilization;
    if (left.evidenceAgeMs !== right.evidenceAgeMs) return left.evidenceAgeMs - right.evidenceAgeMs;
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
