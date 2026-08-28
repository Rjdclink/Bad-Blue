export type FundingArbitrageDirection = 'long_spot_short_perp' | 'long_perp_short_spot';

export interface FundingArbitragePolicyInput {
  fundingRate: number;
  notionalUsd: number;
  spotEntryFeeBps: number | null;
  spotExitFeeBps: number | null;
  perpEntryFeeBps: number | null;
  perpExitFeeBps: number | null;
  entryBasisBps: number | null;
  exitBasisReserveBps: number | null;
  expectedSlippageBps: number | null;
  borrowCostUsd?: number | null;
  fundingRateLocked: boolean;
  shortSpotCapability: boolean;
}

export interface FundingArbitragePolicyDecision {
  direction: FundingArbitrageDirection | null;
  supportedDirection: boolean;
  expectedFundingUsd: number | null;
  expectedTradingFeesUsd: number | null;
  expectedBasisAndSlippageUsd: number | null;
  expectedAllInCostsUsd: number | null;
  projectedNetProfitUsd: number | null;
  deterministicNetProfitUsd: number | null;
  deterministicPositive: boolean;
  missingInformation: string[];
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegative(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function feeUsd(notionalUsd: number, feeBps: number): number {
  return notionalUsd * feeBps / 10_000;
}

/**
 * Funding is a carry cashflow, not an instant arbitrage spread. A displayed or
 * predicted funding rate can change before settlement, so it is projected profit
 * only until the venue proves the applicable rate is fixed for the position's
 * settlement window. Monte Carlo may model uncertainty, but it may not convert a
 * projected funding payment into deterministic execution evidence.
 */
export function evaluateFundingArbitrage(
  input: FundingArbitragePolicyInput,
): FundingArbitragePolicyDecision {
  const missingInformation: string[] = [];
  const fundingRate = finite(input.fundingRate);
  const notionalUsd = finite(input.notionalUsd);
  const direction: FundingArbitrageDirection | null = fundingRate === null || fundingRate === 0
    ? null
    : fundingRate > 0
      ? 'long_spot_short_perp'
      : 'long_perp_short_spot';
  const supportedDirection = direction === 'long_spot_short_perp' ||
    (direction === 'long_perp_short_spot' && input.shortSpotCapability);

  if (fundingRate === null) missingInformation.push('funding_rate');
  if (notionalUsd === null || notionalUsd <= 0) missingInformation.push('positive_notional_usd');
  if (!supportedDirection && direction === 'long_perp_short_spot') missingInformation.push('short_spot_execution_capability');
  if (direction === null) missingInformation.push('nonzero_funding_rate');

  const feeInputs = [
    ['spot_entry_fee_bps', input.spotEntryFeeBps],
    ['spot_exit_fee_bps', input.spotExitFeeBps],
    ['perp_entry_fee_bps', input.perpEntryFeeBps],
    ['perp_exit_fee_bps', input.perpExitFeeBps],
  ] as const;
  for (const [name, raw] of feeInputs) if (nonNegative(raw) === null) missingInformation.push(name);
  if (nonNegative(input.entryBasisBps) === null) missingInformation.push('entry_basis_bps');
  if (nonNegative(input.exitBasisReserveBps) === null) missingInformation.push('exit_basis_reserve_bps');
  if (nonNegative(input.expectedSlippageBps) === null) missingInformation.push('expected_slippage_bps');
  if (input.borrowCostUsd !== undefined && input.borrowCostUsd !== null && nonNegative(input.borrowCostUsd) === null) {
    missingInformation.push('borrow_cost_usd');
  }
  if (!input.fundingRateLocked) missingInformation.push('locked_applicable_funding_rate');

  const economicsComplete = missingInformation.every(item =>
    item === 'locked_applicable_funding_rate' || item === 'short_spot_execution_capability',
  );
  if (!economicsComplete || fundingRate === null || notionalUsd === null || notionalUsd <= 0 || direction === null) {
    return {
      direction,
      supportedDirection,
      expectedFundingUsd: fundingRate !== null && notionalUsd !== null && notionalUsd > 0
        ? Math.abs(fundingRate) * notionalUsd
        : null,
      expectedTradingFeesUsd: null,
      expectedBasisAndSlippageUsd: null,
      expectedAllInCostsUsd: null,
      projectedNetProfitUsd: null,
      deterministicNetProfitUsd: null,
      deterministicPositive: false,
      missingInformation: [...new Set(missingInformation)],
    };
  }

  const spotEntryFeeBps = nonNegative(input.spotEntryFeeBps)!;
  const spotExitFeeBps = nonNegative(input.spotExitFeeBps)!;
  const perpEntryFeeBps = nonNegative(input.perpEntryFeeBps)!;
  const perpExitFeeBps = nonNegative(input.perpExitFeeBps)!;
  const entryBasisBps = nonNegative(input.entryBasisBps)!;
  const exitBasisReserveBps = nonNegative(input.exitBasisReserveBps)!;
  const expectedSlippageBps = nonNegative(input.expectedSlippageBps)!;
  const borrowCostUsd = nonNegative(input.borrowCostUsd ?? 0)!;

  const expectedFundingUsd = Math.abs(fundingRate) * notionalUsd;
  const expectedTradingFeesUsd = [spotEntryFeeBps, spotExitFeeBps, perpEntryFeeBps, perpExitFeeBps]
    .reduce((sum, bps) => sum + feeUsd(notionalUsd, bps), 0);
  const expectedBasisAndSlippageUsd = feeUsd(
    notionalUsd,
    entryBasisBps + exitBasisReserveBps + expectedSlippageBps,
  );
  const expectedAllInCostsUsd = expectedTradingFeesUsd + expectedBasisAndSlippageUsd + borrowCostUsd;
  const projectedNetProfitUsd = expectedFundingUsd - expectedAllInCostsUsd;
  const deterministicNetProfitUsd = input.fundingRateLocked && supportedDirection ? projectedNetProfitUsd : null;

  return {
    direction,
    supportedDirection,
    expectedFundingUsd,
    expectedTradingFeesUsd,
    expectedBasisAndSlippageUsd,
    expectedAllInCostsUsd,
    projectedNetProfitUsd,
    deterministicNetProfitUsd,
    deterministicPositive: deterministicNetProfitUsd !== null && deterministicNetProfitUsd > 0,
    missingInformation: [...new Set(missingInformation)],
  };
}
