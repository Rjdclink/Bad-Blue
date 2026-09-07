import logger from '../../../logger.js';
import { getKalshiMarginFeeMap } from '../intelligence/kalshi-margin-fee-authority.js';
import {
  getKalshiMarginAccountReadiness,
  getKalshiMarginMarkets,
  getKalshiPerpFundingEvidence,
} from '../intelligence/kalshi-perps-market-authority.js';
import { getKalshiPredictionIntelligenceSnapshot } from '../intelligence/kalshi-prediction-market-authority.js';
import {
  getKalshiApiCapacityEvidence,
  getKalshiCapitalEfficiencyEvidence,
  type KalshiApiCapacityEvidence,
  type KalshiCapitalEfficiencyEvidence,
} from '../intelligence/kalshi-capital-efficiency-authority.js';

export interface KalshiBpsOptimizationRow {
  ticker: string;
  baseAsset: string | null;
  observedAt: number;
  makerFeeBps: number;
  takerFeeBps: number;
  makerVsTakerSavingsBpsPerLeg: number;
  makerVsTakerSavingsBpsRoundTrip: number;
  quotedSpreadBps: number | null;
  fundingRateBps: number | null;
  fundingDirectionBenefit: 'short_receives' | 'long_receives' | 'none' | 'unknown';
  marketOpen: boolean;
  authenticatedEffectiveFees: true;
  synthetic: false;
  executionAuthority: false;
  provenance: string[];
}

export interface KalshiBpsOptimizationSnapshot {
  observedAt: number | null;
  cycles: number;
  errors: number;
  marginEnabled: boolean;
  rows: KalshiBpsOptimizationRow[];
  bestMakerSavingsBpsRoundTrip: number | null;
  lowestMakerFeeBps: number | null;
  lowestTakerFeeBps: number | null;
  activePredictionIncentivePrograms: number;
  marketsWithFeeWaiverMetadata: number;
  scheduledSeriesFeeChanges: number;
  capitalEfficiency: KalshiCapitalEfficiencyEvidence | null;
  apiCapacity: KalshiApiCapacityEvidence | null;
  exactFeeAuthority: 'kalshi_authenticated_effective_margin_fee_tiers';
  makerSavingsCounterfactualUntilFill: true;
  fundingEstimateCreditedAsRealizedBps: false;
  predictionIncentiveRewardCreditedAsBpsBeforePayment: false;
  feeWaiverMetadataCreditedAsZeroFeeWithoutFeeProof: false;
  collateralReturnCreditedAsProfit: false;
  interestProgramCreditedWithoutPaidEvidence: false;
  apiTierCreditedAsEconomicProfit: false;
  theoreticalSavingsCreditedAsRealized: false;
  executionAuthority: false;
}

let installed = false;
let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;
let cycles = 0;
let errors = 0;
let observedAt: number | null = null;
let marginEnabled = false;
let rows: KalshiBpsOptimizationRow[] = [];
let capitalEfficiency: KalshiCapitalEfficiencyEvidence | null = null;
let apiCapacity: KalshiApiCapacityEvidence | null = null;
let activePredictionIncentivePrograms = 0;
let marketsWithFeeWaiverMetadata = 0;
let scheduledSeriesFeeChanges = 0;

function intervalMs(): number {
  const configured = Number(process.env.KALSHI_BPS_SCAN_INTERVAL_MS || 30_000);
  return Number.isFinite(configured) ? Math.max(10_000, Math.min(300_000, Math.trunc(configured))) : 30_000;
}

function baseFromTicker(ticker: string): string | null {
  const match = ticker.trim().toUpperCase().match(/^([A-Z0-9]+)PERP$/);
  return match ? match[1] : null;
}

function spreadBps(bid: number | null, ask: number | null): number | null {
  if (bid === null || ask === null || !(bid > 0) || !(ask >= bid)) return null;
  const mid = (bid + ask) / 2;
  return mid > 0 ? (ask - bid) / mid * 10_000 : null;
}

async function scan(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const [markets, fees, account, capital, capacity] = await Promise.all([
      getKalshiMarginMarkets(true),
      getKalshiMarginFeeMap(true),
      getKalshiMarginAccountReadiness(),
      getKalshiCapitalEfficiencyEvidence(),
      getKalshiApiCapacityEvidence().catch(() => null),
    ]);
    marginEnabled = account.marginEnabled && account.authenticated;
    capitalEfficiency = capital;
    apiCapacity = capacity;
    const prediction = getKalshiPredictionIntelligenceSnapshot();
    activePredictionIncentivePrograms = prediction.incentives.filter(program => {
      const now = Date.now();
      return (program.startAt === null || program.startAt <= now)
        && (program.endAt === null || program.endAt > now)
        && !program.paidOut;
    }).length;
    marketsWithFeeWaiverMetadata = prediction.markets.filter(market =>
      market.feeWaiverExpirationAt !== null && market.feeWaiverExpirationAt > Date.now(),
    ).length;
    scheduledSeriesFeeChanges = prediction.feeChanges.length;

    const active = markets.filter(market => market.status === 'active');
    const fundingLimit = Math.max(1, Math.min(32, Number(process.env.KALSHI_BPS_FUNDING_SCAN_LIMIT || 16)));
    const fundingPairs = await Promise.all(active.slice(0, fundingLimit).map(async market => [
      market.ticker,
      await getKalshiPerpFundingEvidence(market.ticker).catch(() => null),
    ] as const));
    const fundingByTicker = new Map(fundingPairs);
    const now = Date.now();
    const nextRows: KalshiBpsOptimizationRow[] = [];

    for (const market of active) {
      const fee = fees.get(market.ticker);
      if (!fee) continue;
      const funding = fundingByTicker.get(market.ticker) || null;
      const fundingRateBps = funding && Number.isFinite(funding.fundingRate) ? funding.fundingRate * 10_000 : null;
      const makerSavings = Math.max(0, fee.takerFeeBps - fee.makerFeeBps);
      nextRows.push({
        ticker: market.ticker,
        baseAsset: baseFromTicker(market.ticker),
        observedAt: Math.min(now, fee.observedAt, market.observedAt),
        makerFeeBps: fee.makerFeeBps,
        takerFeeBps: fee.takerFeeBps,
        makerVsTakerSavingsBpsPerLeg: makerSavings,
        makerVsTakerSavingsBpsRoundTrip: makerSavings * 2,
        quotedSpreadBps: spreadBps(market.bid, market.ask),
        fundingRateBps,
        fundingDirectionBenefit: fundingRateBps === null ? 'unknown' : fundingRateBps > 0 ? 'short_receives' : fundingRateBps < 0 ? 'long_receives' : 'none',
        marketOpen: market.isOpen,
        authenticatedEffectiveFees: true,
        synthetic: false,
        executionAuthority: false,
        provenance: [
          'kalshi_margin_markets_public',
          'kalshi_authenticated_effective_margin_fee_tiers',
          funding ? 'kalshi_current_in_progress_funding_estimate' : 'kalshi_funding_estimate_unavailable',
          'maker_savings_is_counterfactual_until_fill',
          'realized_bps_requires_terminal_fill_fee_and_settlement',
        ],
      });
    }
    rows = nextRows.sort((left, right) =>
      right.makerVsTakerSavingsBpsRoundTrip - left.makerVsTakerSavingsBpsRoundTrip
      || left.makerFeeBps - right.makerFeeBps
      || left.ticker.localeCompare(right.ticker));
    observedAt = now;
    cycles += 1;
    logger.info('[KalshiBPS] Measured Kalshi BPS frontier refreshed', {
      component: 'KalshiBpsOptimizationWiring',
      markets: active.length,
      authenticatedFeeMarkets: rows.length,
      marginEnabled,
      bestMakerSavingsBpsRoundTrip: rows[0]?.makerVsTakerSavingsBpsRoundTrip ?? null,
      activePredictionIncentivePrograms,
      marketsWithFeeWaiverMetadata,
      scheduledSeriesFeeChanges,
      collateralReturnPotential: capitalEfficiency?.collateralReturnPotential ?? false,
      apiUsageTier: apiCapacity?.usageTier ?? null,
      theoreticalSavingsCreditedAsRealized: false,
      executionAuthority: false,
    });
  })().catch(error => {
    errors += 1;
    rows = [];
    observedAt = Date.now();
    marginEnabled = false;
    capitalEfficiency = null;
    apiCapacity = null;
    activePredictionIncentivePrograms = 0;
    marketsWithFeeWaiverMetadata = 0;
    scheduledSeriesFeeChanges = 0;
    logger.warn('[KalshiBPS] Kalshi BPS frontier failed closed', {
      component: 'KalshiBpsOptimizationWiring',
      error: error instanceof Error ? error.message : String(error),
      staleRowsRetained: false,
      zeroFeeAssumed: false,
      incentiveRewardsAssumed: false,
      collateralReturnAssumedProfit: false,
      executionAuthority: false,
    });
  }).finally(() => { inFlight = null; });
  return inFlight;
}

export function getKalshiBpsOptimizationSnapshot(): KalshiBpsOptimizationSnapshot {
  const copy = rows.map(row => ({ ...row, provenance: [...row.provenance] }));
  return {
    observedAt,
    cycles,
    errors,
    marginEnabled,
    rows: copy,
    bestMakerSavingsBpsRoundTrip: copy.length ? Math.max(...copy.map(row => row.makerVsTakerSavingsBpsRoundTrip)) : null,
    lowestMakerFeeBps: copy.length ? Math.min(...copy.map(row => row.makerFeeBps)) : null,
    lowestTakerFeeBps: copy.length ? Math.min(...copy.map(row => row.takerFeeBps)) : null,
    activePredictionIncentivePrograms,
    marketsWithFeeWaiverMetadata,
    scheduledSeriesFeeChanges,
    capitalEfficiency: capitalEfficiency ? structuredClone(capitalEfficiency) : null,
    apiCapacity: apiCapacity ? structuredClone(apiCapacity) : null,
    exactFeeAuthority: 'kalshi_authenticated_effective_margin_fee_tiers',
    makerSavingsCounterfactualUntilFill: true,
    fundingEstimateCreditedAsRealizedBps: false,
    predictionIncentiveRewardCreditedAsBpsBeforePayment: false,
    feeWaiverMetadataCreditedAsZeroFeeWithoutFeeProof: false,
    collateralReturnCreditedAsProfit: false,
    interestProgramCreditedWithoutPaidEvidence: false,
    apiTierCreditedAsEconomicProfit: false,
    theoreticalSavingsCreditedAsRealized: false,
    executionAuthority: false,
  };
}

export function getKalshiBpsRowForAsset(assetInput: string): KalshiBpsOptimizationRow | null {
  const asset = assetInput.trim().toUpperCase().replace(/(USDT|USDC|USD)$/, '');
  if (!asset) return null;
  const match = rows.find(row => row.baseAsset === asset && row.marketOpen);
  return match ? { ...match, provenance: [...match.provenance] } : null;
}

export function ensureKalshiBpsOptimizationWiring(): void {
  if (installed || process.env.KALSHI_BPS_OPTIMIZATION_ENABLED === 'false') return;
  installed = true;
  void scan();
  if (process.env.NO_INTERVALS !== 'true') {
    timer = setInterval(() => void scan(), intervalMs());
    timer.unref?.();
  }
  logger.info('[KalshiBPS] Kalshi BPS optimization wiring installed', {
    component: 'KalshiBpsOptimizationWiring',
    intervalMs: intervalMs(),
    authenticatedEffectiveFeeAuthority: true,
    makerTakerModeComparison: true,
    fundingDirectionMeasurement: true,
    predictionIncentiveDiscovery: true,
    feeWaiverMetadataDiscovery: true,
    collateralNettingEvidence: true,
    apiCapacityEvidence: true,
    realizedBpsAuthorityChanged: false,
    executionAuthority: false,
  });
}
