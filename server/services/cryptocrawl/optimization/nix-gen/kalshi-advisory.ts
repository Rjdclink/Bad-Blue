import { getKalshiBpsOptimizationSnapshot, getKalshiBpsRowForAsset } from '../../integration/kalshi-bps-optimization-wiring.js';
import { getKalshiPredictionSignalsForAsset } from '../../intelligence/kalshi-prediction-market-authority.js';
import type { NixGenPreparedBid } from './canonical-bid-adapters.js';

export interface NixGenKalshiOpportunityAdvisory {
  opportunityId: string;
  symbol: string;
  asset: string;
  kalshiPerpTicker: string | null;
  authenticatedMakerFeeBps: number | null;
  authenticatedTakerFeeBps: number | null;
  makerVsTakerSavingsBpsRoundTrip: number | null;
  currentFundingRateBps: number | null;
  predictionSignalCount: number;
  predictionLiquidityUsd: number;
  predictionVolume24h: number;
  directRankingAdjustmentApplied: false;
  canonicalEconomicsChanged: false;
  executionAuthority: false;
}

export interface NixGenKalshiAdvisorySnapshot {
  generatedAt: number;
  authority: 'nix_gen_kalshi_advisory_only';
  marginEnabled: boolean;
  activePredictionIncentivePrograms: number;
  collateralReturnPotential: boolean;
  opportunities: NixGenKalshiOpportunityAdvisory[];
  directRankingAdjustmentApplied: false;
  canonicalEconomicsChanged: false;
  filtersCanonicalCandidates: false;
  executionAuthority: false;
}

function symbolFromBid(item: NixGenPreparedBid): string | null {
  const raw = item.bid.metadata?.symbol;
  return typeof raw === 'string' && raw.trim() ? raw.trim().toUpperCase() : null;
}

function assetFromSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/(USDT|USDC|USD)$/, '');
}

/**
 * Exposes Kalshi's measured fee/funding/prediction context to Nix-Gen without
 * feeding uncalibrated prediction-market probabilities back into ranking utility.
 * Once a Kalshi route is canonical, executable and settlement-capable, its true
 * all-in net economics enter Nix-Gen through the normal canonical bid adapters.
 */
export function buildNixGenKalshiAdvisory(prepared: readonly NixGenPreparedBid[]): NixGenKalshiAdvisorySnapshot {
  const bps = getKalshiBpsOptimizationSnapshot();
  const opportunities: NixGenKalshiOpportunityAdvisory[] = [];
  for (const item of prepared) {
    const symbol = symbolFromBid(item);
    if (!symbol) continue;
    const asset = assetFromSymbol(symbol);
    if (!asset) continue;
    const perp = getKalshiBpsRowForAsset(asset);
    const prediction = getKalshiPredictionSignalsForAsset(asset);
    if (!perp && prediction.length === 0) continue;
    opportunities.push({
      opportunityId: item.bid.opportunityId,
      symbol,
      asset,
      kalshiPerpTicker: perp?.ticker ?? null,
      authenticatedMakerFeeBps: perp?.makerFeeBps ?? null,
      authenticatedTakerFeeBps: perp?.takerFeeBps ?? null,
      makerVsTakerSavingsBpsRoundTrip: perp?.makerVsTakerSavingsBpsRoundTrip ?? null,
      currentFundingRateBps: perp?.fundingRateBps ?? null,
      predictionSignalCount: prediction.length,
      predictionLiquidityUsd: prediction.reduce((sum, signal) => sum + Math.max(0, signal.liquidityUsd ?? 0), 0),
      predictionVolume24h: prediction.reduce((sum, signal) => sum + Math.max(0, signal.volume24h ?? 0), 0),
      directRankingAdjustmentApplied: false,
      canonicalEconomicsChanged: false,
      executionAuthority: false,
    });
  }
  return {
    generatedAt: Date.now(),
    authority: 'nix_gen_kalshi_advisory_only',
    marginEnabled: bps.marginEnabled,
    activePredictionIncentivePrograms: bps.activePredictionIncentivePrograms,
    collateralReturnPotential: bps.capitalEfficiency?.collateralReturnPotential ?? false,
    opportunities,
    directRankingAdjustmentApplied: false,
    canonicalEconomicsChanged: false,
    filtersCanonicalCandidates: false,
    executionAuthority: false,
  };
}
