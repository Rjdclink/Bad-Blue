import {
  HYPERDYNAMIC_BPS_SOLUTIONS,
  type BpsLever,
  type HyperdynamicBpsInput,
  type HyperdynamicBpsPlan,
} from './hyperdynamic-bps-solution-engine.js';

export interface MarginalBpsPriority {
  lever: BpsLever;
  estimatedRecoverableBps: number;
  scarcityUnits: number;
  bpsPerScarcityUnit: number;
  activeSolutions: number[];
}

export interface MarginalBpsAllocation {
  ranked: MarginalBpsPriority[];
  topLever: BpsLever | null;
  estimatedAggregateRecoverableBps: number | null;
  cexEfficiencyMultiplier: number;
  zeroCapitalEfficiencyMultiplier: number;
  authority: 'measured_search_allocation_only';
  executionAuthority: false;
  syntheticEconomicsAllowed: false;
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegative(value: unknown): number {
  const parsed = finite(value);
  return parsed === null ? 0 : Math.max(0, parsed);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function activeSolutionIdsByLever(plan: HyperdynamicBpsPlan): Map<BpsLever, number[]> {
  const active = new Set(plan.activeSolutionIds);
  const map = new Map<BpsLever, number[]>();
  for (const solution of HYPERDYNAMIC_BPS_SOLUTIONS) {
    if (!active.has(solution.id)) continue;
    const ids = map.get(solution.lever) || [];
    ids.push(solution.id);
    map.set(solution.lever, ids);
  }
  return map;
}

function estimatedBenefitBps(input: HyperdynamicBpsInput, lever: BpsLever): number {
  const feeGap = nonNegative(input.closestFeeGapBps);
  const riskGap = nonNegative(input.closestRiskGapBps);
  const targetGap = riskGap > 0 ? riskGap : feeGap;
  const makerSavings = nonNegative(input.makerSavingsBps);
  const rpiSavings = nonNegative(input.rpiSavingsBps);
  const feeFloor = nonNegative(input.lowestCombinedFeeBps);
  const grossSpread = nonNegative(input.bestGrossSpreadBps);
  const freshness = finite(input.feeFreshnessShare);
  const freshnessDeficit = freshness === null ? 0 : clamp(1 - freshness, 0, 1);
  const recovery = clamp(nonNegative(input.bestRecoveryEfficiency), 0, 2);
  const zeroGap = nonNegative(input.zeroCapitalGapBps);

  const capAtGap = (value: number, fraction = 1): number => targetGap > 0
    ? Math.min(targetGap * fraction, Math.max(0, value))
    : Math.max(0, value);

  switch (lever) {
    case 'makerFocus':
      return capAtGap(Math.max(makerSavings, rpiSavings));
    case 'hybridQuota':
      return capAtGap(Math.max(makerSavings * 0.75, rpiSavings * 0.65) * Math.max(0.35, Math.min(1, recovery)));
    case 'recoveryQuota':
      return capAtGap(Math.max(makerSavings, rpiSavings) * Math.max(0.25, Math.min(1, recovery)));
    case 'feeRefresh':
    case 'evidenceRefresh':
      return capAtGap(feeFloor * freshnessDeficit);
    case 'sizeRefinement':
      return capAtGap(grossSpread * 0.18 * Math.max(0.35, Math.min(1, recovery)));
    case 'liquidityFocus':
      return capAtGap(grossSpread * 0.14 * Math.max(0.35, Math.min(1, recovery)));
    case 'latencyFocus':
      return capAtGap(grossSpread * 0.10);
    case 'venueDiversity':
      return capAtGap(Math.max(rpiSavings, makerSavings * 0.55));
    case 'cexPriority':
      return capAtGap(Math.max(0.5, targetGap * 0.18));
    case 'cadence':
      return capAtGap(Math.max(0.25, targetGap * 0.12));
    case 'breadth':
      return capAtGap(Math.max(0.25, targetGap * 0.08));
    case 'switchHysteresis':
      return capAtGap(Math.max(0.15, targetGap * 0.06));
    case 'mcSearch':
      return capAtGap(Math.max(0.15, targetGap * 0.05));
    case 'quoteBudget':
      return capAtGap(Math.max(0.15, targetGap * 0.05));
    case 'zeroCapitalPriority':
    case 'gasSensitivity':
      return zeroGap > 0 ? Math.min(zeroGap, Math.max(0.25, zeroGap * 0.15)) : 0;
    default:
      return 0;
  }
}

function scarcityUnits(input: HyperdynamicBpsInput, lever: BpsLever): number {
  const heat = clamp(nonNegative(input.heatPressure), 0, 1);
  const providerQuality = finite(input.providerQuality);
  const providerPenalty = providerQuality === null ? 1 : 1 + clamp(0.65 - providerQuality, 0, 0.65);
  const heatPenalty = 1 + heat * 1.5;

  const base: Partial<Record<BpsLever, number>> = {
    cexPriority: 0.50,
    cadence: 0.75,
    breadth: 1.00,
    switchHysteresis: 0.50,
    feeRefresh: 1.60,
    evidenceRefresh: 1.35,
    makerFocus: 1.60,
    hybridQuota: 1.80,
    recoveryQuota: 1.65,
    sizeRefinement: 2.00,
    liquidityFocus: 2.25,
    latencyFocus: 1.50,
    venueDiversity: 1.75,
    mcSearch: 2.50,
    quoteBudget: 1.75,
    zeroCapitalPriority: 1.25,
    gasSensitivity: 1.25,
  };

  const units = base[lever] ?? 3;
  const providerSensitive = lever === 'latencyFocus' || lever === 'evidenceRefresh' || lever === 'quoteBudget';
  return units * heatPenalty * (providerSensitive ? providerPenalty : 1);
}

/**
 * Ranks already-active Hyperdynamic levers by measured marginal BPS recovery per
 * scarce resource unit. This is a search/compute allocation policy only; it does
 * not alter measured prices/fees, deterministic profitability, governance,
 * execution or settlement authority.
 */
export function buildMarginalBpsAllocation(
  input: HyperdynamicBpsInput,
  plan: HyperdynamicBpsPlan,
): MarginalBpsAllocation {
  const activeByLever = activeSolutionIdsByLever(plan);
  const ranked = [...activeByLever.entries()]
    .map(([lever, ids]) => {
      const estimatedRecoverableBps = estimatedBenefitBps(input, lever);
      const units = scarcityUnits(input, lever);
      return {
        lever,
        estimatedRecoverableBps: Number(estimatedRecoverableBps.toFixed(6)),
        scarcityUnits: Number(units.toFixed(6)),
        bpsPerScarcityUnit: Number((units > 0 ? estimatedRecoverableBps / units : 0).toFixed(6)),
        activeSolutions: [...ids],
      } satisfies MarginalBpsPriority;
    })
    .sort((left, right) => right.bpsPerScarcityUnit - left.bpsPerScarcityUnit
      || right.estimatedRecoverableBps - left.estimatedRecoverableBps
      || left.lever.localeCompare(right.lever));

  const feeGap = nonNegative(input.closestRiskGapBps) || nonNegative(input.closestFeeGapBps);
  const weightedRecovery = ranked.length === 0
    ? 0
    : ranked[0].estimatedRecoverableBps
      + (ranked[1]?.estimatedRecoverableBps || 0) * 0.35
      + (ranked[2]?.estimatedRecoverableBps || 0) * 0.15;
  const estimatedAggregateRecoverableBps = feeGap > 0
    ? Math.min(feeGap, weightedRecovery)
    : weightedRecovery > 0 ? weightedRecovery : null;

  const topScore = ranked[0]?.bpsPerScarcityUnit || 0;
  const cexEfficiencyMultiplier = clamp(1 + Math.min(0.40, topScore / 25), 0.75, 1.40);
  const relativeCexAdvantage = finite(input.relativeCexAdvantageBps);
  const zeroCapitalEfficiencyMultiplier = relativeCexAdvantage === null
    ? 1
    : clamp(1 - relativeCexAdvantage / 100, 0.75, 1.25);

  return {
    ranked,
    topLever: ranked[0]?.lever || null,
    estimatedAggregateRecoverableBps: estimatedAggregateRecoverableBps === null
      ? null
      : Number(estimatedAggregateRecoverableBps.toFixed(6)),
    cexEfficiencyMultiplier: Number(cexEfficiencyMultiplier.toFixed(6)),
    zeroCapitalEfficiencyMultiplier: Number(zeroCapitalEfficiencyMultiplier.toFixed(6)),
    authority: 'measured_search_allocation_only',
    executionAuthority: false,
    syntheticEconomicsAllowed: false,
  };
}
