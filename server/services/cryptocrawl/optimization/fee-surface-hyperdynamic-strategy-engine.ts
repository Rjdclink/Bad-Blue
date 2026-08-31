import type { CexFeeVenue } from '../intelligence/cex-fee-resolver.js';

export type FeeSurfaceStrategyKey =
  | 'authenticated_maker_rebate_capture'
  | 'stablecoin_zero_maker_lane'
  | 'maker_taker_fee_inversion'
  | 'taker_maker_fee_inversion'
  | 'dual_maker_fee_compression'
  | 'rpi_authenticated_fee_compression'
  | 'positive_edge_fee_deepening'
  | 'near_edge_fee_rescue'
  | 'spread_plus_rebate_stack'
  | 'lowest_taker_surface_routing'
  | 'lowest_maker_surface_routing'
  | 'fee_freshness_prewarm'
  | 'account_fee_surface_refresh'
  | 'zero_capital_fee_gas_compression'
  | 'cross_topology_fee_budget_switching';

export type ProhibitedFeeSurfaceBehavior =
  | 'wash_volume'
  | 'self_trade'
  | 'unverified_rebate_assumption'
  | 'front_run_other_orders'
  | 'artificial_tier_volume';

export interface FeeSurfaceModeInput {
  symbol: string;
  buyVenue: CexFeeVenue;
  sellVenue: CexFeeVenue;
  mode: 'MM' | 'MT' | 'TM' | 'TT';
  netAfterExchangeFeesBps: number;
  expectedFeeAdjustedBps: number;
  bpsToBreakEven: number;
  combinedFeeBps: number;
  grossSpreadBps: number;
  economicallyPositive: boolean;
  feeFreshnessScore: number;
  buyMakerCostBps: number | null;
  sellMakerCostBps: number | null;
  buyTakerCostBps: number | null;
  sellTakerCostBps: number | null;
}

export interface FeeSurfaceRpiInput {
  symbol: string;
  rpiSavingsVsTakerBps: number;
  rpiSavingsVsStandardMakerBps: number | null;
}

export interface FeeSurfaceStrategyDecision {
  key: FeeSurfaceStrategyKey;
  active: boolean;
  measuredBpsBenefit: number | null;
  score: number;
  symbols: string[];
  reason: string;
}

export interface FeeSurfaceHyperdynamicStrategyPlan {
  observedAt: number;
  activeStrategies: FeeSurfaceStrategyDecision[];
  allStrategies: FeeSurfaceStrategyDecision[];
  bestMeasuredBpsBenefit: number | null;
  authenticatedRebateSymbols: string[];
  cexPriorityMultiplier: number;
  zeroCapitalPriorityMultiplier: number;
  objective: 'maximize_expected_realized_net_execution_quality_with_authenticated_fee_structure';
  authority: 'search_ranking_and_measurement_only';
  executionAuthority: false;
  syntheticFeeAuthority: false;
  prohibitedBehaviors: ProhibitedFeeSurfaceBehavior[];
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function stablecoinSymbol(symbol: string): boolean {
  const normalized = symbol.trim().toUpperCase();
  return normalized.endsWith('USD') || normalized.endsWith('USDT') || normalized.endsWith('USDC');
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function decision(
  key: FeeSurfaceStrategyKey,
  measuredBpsBenefit: number | null,
  symbols: string[],
  reason: string,
  scoreBoost = 0,
): FeeSurfaceStrategyDecision {
  const benefit = finite(measuredBpsBenefit);
  const active = symbols.length > 0 && benefit !== null && benefit > 0;
  return {
    key,
    active,
    measuredBpsBenefit: benefit,
    score: active ? clamp(benefit! / 10 + scoreBoost, 0.01, 10) : 0,
    symbols: unique(symbols),
    reason,
  };
}

function modeKey(mode: FeeSurfaceModeInput): string {
  return `${mode.symbol}:${mode.buyVenue}->${mode.sellVenue}`;
}

/**
 * Converts authenticated fee evidence into a hyperdynamic strategy surface.
 * This engine never manufactures a rebate, fill, spread or profit value and it
 * never submits an order. It only identifies measured fee structures worth
 * spending more discovery/verification budget on. Canonical execution remains
 * governed by the existing fresh all-in netProfitUsd > 0 path.
 *
 * Fee/rebate magnitude is never the sole routing objective: price, executable
 * depth, fill/queue probability, latency, adverse selection, inventory and
 * terminal settlement remain part of the canonical execution-quality decision.
 */
export function buildFeeSurfaceHyperdynamicStrategyPlan(input: {
  modes: FeeSurfaceModeInput[];
  rpi: FeeSurfaceRpiInput[];
  zeroCapitalGapBps: number | null;
  zeroCapitalGapImproving: boolean | null;
}): FeeSurfaceHyperdynamicStrategyPlan {
  const modes = input.modes.filter(mode => Number.isFinite(mode.combinedFeeBps));
  const byRoute = new Map<string, FeeSurfaceModeInput[]>();
  for (const mode of modes) {
    const current = byRoute.get(modeKey(mode)) || [];
    current.push(mode);
    byRoute.set(modeKey(mode), current);
  }

  const rebateModes = modes.filter(mode =>
    (mode.mode[0] === 'M' && mode.buyMakerCostBps !== null && mode.buyMakerCostBps < 0)
    || (mode.mode[1] === 'M' && mode.sellMakerCostBps !== null && mode.sellMakerCostBps < 0));
  const rebateBenefits = rebateModes.map(mode => Math.max(
    mode.mode[0] === 'M' ? Math.max(0, -(mode.buyMakerCostBps ?? 0)) : 0,
    mode.mode[1] === 'M' ? Math.max(0, -(mode.sellMakerCostBps ?? 0)) : 0,
  ));
  const bestRebate = rebateBenefits.length ? Math.max(...rebateBenefits) : null;

  const stableZeroMaker = modes.filter(mode => stablecoinSymbol(mode.symbol) && (
    (mode.mode[0] === 'M' && mode.buyMakerCostBps !== null && mode.buyMakerCostBps <= 0)
    || (mode.mode[1] === 'M' && mode.sellMakerCostBps !== null && mode.sellMakerCostBps <= 0)
  ));

  const mtSavings: Array<{ symbol: string; benefit: number }> = [];
  const tmSavings: Array<{ symbol: string; benefit: number }> = [];
  const mmSavings: Array<{ symbol: string; benefit: number }> = [];
  const positiveDeepening: Array<{ symbol: string; benefit: number }> = [];
  const nearEdgeRescue: Array<{ symbol: string; benefit: number }> = [];

  for (const routeModes of byRoute.values()) {
    const tt = routeModes.find(mode => mode.mode === 'TT');
    if (!tt) continue;
    for (const mode of routeModes) {
      if (mode.mode === 'TT') continue;
      const feeBenefit = tt.combinedFeeBps - mode.combinedFeeBps;
      if (!(feeBenefit > 0)) continue;
      if (mode.mode === 'MT') mtSavings.push({ symbol: mode.symbol, benefit: feeBenefit });
      if (mode.mode === 'TM') tmSavings.push({ symbol: mode.symbol, benefit: feeBenefit });
      if (mode.mode === 'MM') mmSavings.push({ symbol: mode.symbol, benefit: feeBenefit });
      if (mode.economicallyPositive && mode.netAfterExchangeFeesBps > tt.netAfterExchangeFeesBps) {
        positiveDeepening.push({ symbol: mode.symbol, benefit: mode.netAfterExchangeFeesBps - tt.netAfterExchangeFeesBps });
      }
      if (!tt.economicallyPositive && tt.bpsToBreakEven > 0 && feeBenefit >= tt.bpsToBreakEven * 0.50) {
        nearEdgeRescue.push({ symbol: mode.symbol, benefit: Math.min(feeBenefit, tt.bpsToBreakEven) });
      }
    }
  }

  const rpiPositive = input.rpi.filter(item => item.rpiSavingsVsTakerBps > 0);
  const bestRpi = rpiPositive.length ? Math.max(...rpiPositive.map(item => item.rpiSavingsVsTakerBps)) : null;

  const spreadRebate = rebateModes.filter(mode => mode.grossSpreadBps > 0);
  const spreadRebateBenefit = spreadRebate.length ? Math.max(...spreadRebate.map(mode => {
    const rebate = Math.max(
      mode.mode[0] === 'M' ? Math.max(0, -(mode.buyMakerCostBps ?? 0)) : 0,
      mode.mode[1] === 'M' ? Math.max(0, -(mode.sellMakerCostBps ?? 0)) : 0,
    );
    return Math.max(0, mode.grossSpreadBps + rebate);
  })) : null;

  const freshest = modes.filter(mode => mode.feeFreshnessScore >= 0.75);
  const stale = modes.filter(mode => mode.feeFreshnessScore < 0.75);

  const takerCandidates = modes.flatMap(mode => [
    mode.buyTakerCostBps === null ? null : { symbol: mode.symbol, venue: mode.buyVenue, fee: mode.buyTakerCostBps },
    mode.sellTakerCostBps === null ? null : { symbol: mode.symbol, venue: mode.sellVenue, fee: mode.sellTakerCostBps },
  ].filter((item): item is { symbol: string; venue: CexFeeVenue; fee: number } => item !== null));
  const makerCandidates = modes.flatMap(mode => [
    mode.buyMakerCostBps === null ? null : { symbol: mode.symbol, venue: mode.buyVenue, fee: mode.buyMakerCostBps },
    mode.sellMakerCostBps === null ? null : { symbol: mode.symbol, venue: mode.sellVenue, fee: mode.sellMakerCostBps },
  ].filter((item): item is { symbol: string; venue: CexFeeVenue; fee: number } => item !== null));
  const takerRange = takerCandidates.length ? Math.max(...takerCandidates.map(item => item.fee)) - Math.min(...takerCandidates.map(item => item.fee)) : null;
  const makerRange = makerCandidates.length ? Math.max(...makerCandidates.map(item => item.fee)) - Math.min(...makerCandidates.map(item => item.fee)) : null;

  const best = (values: Array<{ benefit: number }>) => values.length ? Math.max(...values.map(item => item.benefit)) : null;
  const decisions: FeeSurfaceStrategyDecision[] = [
    decision('authenticated_maker_rebate_capture', bestRebate, rebateModes.map(mode => mode.symbol), 'Use only authenticated negative maker-fee evidence; never assume a pair rebates or route solely to maximize rebate.'),
    decision('stablecoin_zero_maker_lane', stableZeroMaker.length ? 0.000001 : null, stableZeroMaker.map(mode => mode.symbol), 'Prioritize measured stablecoin lanes whose authenticated maker cost is zero or negative.'),
    decision('maker_taker_fee_inversion', best(mtSavings), mtSavings.map(item => item.symbol), 'Prefer MT only when its measured fee surface beats the same-route TT alternative; partial-fill-safe execution remains mandatory.'),
    decision('taker_maker_fee_inversion', best(tmSavings), tmSavings.map(item => item.symbol), 'Prefer TM only when its measured fee surface beats the same-route TT alternative; fresh hedge economics remain mandatory.'),
    decision('dual_maker_fee_compression', best(mmSavings), mmSavings.map(item => item.symbol), 'Use MM as a measured fee-compression surface while retaining queue/fill proof requirements.'),
    decision('rpi_authenticated_fee_compression', bestRpi, rpiPositive.map(item => item.symbol), 'Exploit RPI economics only when current OKX account/product permission, price spacing and authenticated fee evidence prove a positive saving.'),
    decision('positive_edge_fee_deepening', best(positiveDeepening), positiveDeepening.map(item => item.symbol), 'Continue reducing fees on already-positive opportunities instead of stopping optimization at break-even.'),
    decision('near_edge_fee_rescue', best(nearEdgeRescue), nearEdgeRescue.map(item => item.symbol), 'Spend extra measurement budget where authenticated fee-mode changes can materially close a measured break-even gap.'),
    decision('spread_plus_rebate_stack', spreadRebateBenefit, spreadRebate.map(mode => mode.symbol), 'Stack a real spread with a real authenticated rebate; neither component may be simulated into execution truth.'),
    decision('lowest_taker_surface_routing', takerRange, takerCandidates.map(item => item.symbol), 'Continuously compare authenticated taker surfaces across Coinbase/Kraken/OKX, but let canonical price/depth/latency economics choose the actual route.'),
    decision('lowest_maker_surface_routing', makerRange, makerCandidates.map(item => item.symbol), 'Continuously compare authenticated maker surfaces across Coinbase/Kraken/OKX, including zero and negative effective maker cost.'),
    decision('fee_freshness_prewarm', stale.length && freshest.length ? 1 : null, stale.map(mode => mode.symbol), 'Refresh stale authenticated fee evidence before promising routes consume canonical verification time.'),
    decision('account_fee_surface_refresh', modes.length ? Math.max(0.000001, takerRange ?? 0, makerRange ?? 0) : null, modes.map(mode => mode.symbol), 'Treat actual account-specific fee tiers as changing market state; refresh authenticated rates rather than hard-code public schedules or speculate about a future tier.'),
    decision('zero_capital_fee_gas_compression', input.zeroCapitalGapBps !== null && input.zeroCapitalGapBps > 0 ? 1 / (1 + input.zeroCapitalGapBps / 25) : null, input.zeroCapitalGapBps !== null ? ['ZERO_CAPITAL'] : [], 'Allocate zero-capital quote/gas work only from measured route economics; flash-loan principal never substitutes for unknown fees or gas.'),
    decision('cross_topology_fee_budget_switching', input.zeroCapitalGapImproving === true && modes.length > 0 ? 0.5 : null, input.zeroCapitalGapImproving === true ? ['CEX', 'ZERO_CAPITAL'] : [], 'Shift search budget between CEX fee surfaces and zero-capital routes using measured distance to profitability, preserving exploration floors.'),
  ];

  const activeStrategies = decisions.filter(item => item.active).sort((a, b) => b.score - a.score);
  const measuredBenefits = activeStrategies.map(item => item.measuredBpsBenefit).filter((value): value is number => value !== null && value > 0);
  const bestMeasuredBpsBenefit = measuredBenefits.length ? Math.max(...measuredBenefits) : null;
  const cexSignals = activeStrategies.filter(item => item.key !== 'zero_capital_fee_gas_compression').length;
  const zeroSignals = activeStrategies.filter(item => item.key === 'zero_capital_fee_gas_compression' || item.key === 'cross_topology_fee_budget_switching').length;

  return {
    observedAt: Date.now(),
    activeStrategies,
    allStrategies: decisions,
    bestMeasuredBpsBenefit,
    authenticatedRebateSymbols: unique(rebateModes.map(mode => mode.symbol)),
    cexPriorityMultiplier: clamp(1 + Math.min(0.35, cexSignals * 0.015 + (bestMeasuredBpsBenefit ?? 0) / 100), 0.85, 1.35),
    zeroCapitalPriorityMultiplier: clamp(1 + Math.min(0.20, zeroSignals * 0.04), 0.90, 1.20),
    objective: 'maximize_expected_realized_net_execution_quality_with_authenticated_fee_structure',
    authority: 'search_ranking_and_measurement_only',
    executionAuthority: false,
    syntheticFeeAuthority: false,
    prohibitedBehaviors: ['wash_volume', 'self_trade', 'unverified_rebate_assumption', 'front_run_other_orders', 'artificial_tier_volume'],
  };
}
