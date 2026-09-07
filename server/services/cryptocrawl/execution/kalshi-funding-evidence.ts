import logger from '../../../logger.js';
import { getSpotProductConstraints, type SpotProductConstraints } from './cex-spot-product-policy.js';
import { cexOrderBookStreams, type CexStreamVenue, type StreamOrderBookLevel } from '../intelligence/cex-order-book-stream.js';
import { resolveCexFeeEvidence, type CexFeeEvidence } from '../intelligence/cex-fee-resolver.js';
import {
  getKalshiMarginAccountReadiness,
  getKalshiMarginExchangeStatus,
  getKalshiNotionalRiskLimit,
  getKalshiPerpExecutionEvidence,
  kalshiPerpBaseAsset,
  type KalshiOrderbookLevel,
} from '../intelligence/kalshi-perps-market-authority.js';

export type KalshiFundingHedgeVenue = 'kraken' | 'okx';

export interface KalshiFundingExecutionEvidence {
  ticker: string;
  baseAsset: string;
  quoteAsset: 'USD';
  hedgeVenue: KalshiFundingHedgeVenue;
  hedgeSymbol: string;
  contracts: number;
  contractSize: number;
  baseQuantity: number;
  targetNotionalUsd: number;
  measuredNotionalUsd: number;
  kalshiEntryVwap: number;
  kalshiEntryLimit: number;
  kalshiExitReferenceVwap: number;
  kalshiExitLimit: number;
  spotEntryVwap: number;
  spotEntryLimit: number;
  spotExitReferenceVwap: number;
  spotExitLimit: number;
  kalshiTakerFeeBps: number;
  hedgeTakerFeeBps: number;
  expectedTradingFeesUsd: number;
  entryBasisBps: number;
  exitBasisReserveBps: number;
  expectedSlippageBps: number;
  fundingRate: number;
  nextFundingTime: number;
  fundingRateLocked: false;
  marketTradingActive: boolean;
  notionalRiskLimitUsd: number | null;
  authenticatedMarginAvailableUsd: number | null;
  authenticatedMarginAvailableComputed: boolean;
  measuredAt: number;
  expiresAt: number;
  provenance: string[];
}

type WalkResult = {
  filled: number;
  vwap: number;
  worstPrice: number;
  topPrice: number;
};

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function floorTo(value: number, increment: number): number {
  if (!(value > 0) || !(increment > 0)) return 0;
  const units = Math.floor((value + increment * 1e-9) / increment);
  const result = units * increment;
  return Number(result.toFixed(Math.min(12, Math.max(0, Math.ceil(-Math.log10(increment)) + 2))));
}

function walk(levels: readonly { price: number; quantity: number }[], requestedQuantity: number): WalkResult | null {
  if (!(requestedQuantity > 0)) return null;
  let remaining = requestedQuantity;
  let filled = 0;
  let total = 0;
  let worstPrice = 0;
  let topPrice = 0;
  for (const level of levels) {
    if (!(level.price > 0) || !(level.quantity > 0)) continue;
    if (topPrice === 0) topPrice = level.price;
    const take = Math.min(remaining, level.quantity);
    total += take * level.price;
    filled += take;
    remaining -= take;
    worstPrice = level.price;
    if (remaining <= Math.max(1e-12, requestedQuantity * 1e-10)) break;
  }
  if (remaining > Math.max(1e-10, requestedQuantity * 1e-8) || !(filled > 0) || !(worstPrice > 0) || !(topPrice > 0)) return null;
  return { filled, vwap: total / filled, worstPrice, topPrice };
}

function slippageBps(walked: WalkResult): number {
  if (!(walked.topPrice > 0)) return 0;
  return Math.abs(walked.vwap - walked.topPrice) / walked.topPrice * 10_000;
}

function underlyingPrice(contractPrice: number, contractSize: number): number {
  return contractPrice / contractSize;
}

function contractIncrement(fractionalTradingEnabled: boolean): number {
  return fractionalTradingEnabled ? 0.01 : 1;
}

function directUsdSymbol(baseAsset: string): string {
  return `${baseAsset}USD`;
}

function compatibleSpotBase(constraints: SpotProductConstraints, baseAsset: string): boolean {
  return constraints.baseAsset.toUpperCase() === baseAsset.toUpperCase() && constraints.quoteAsset.toUpperCase() === 'USD';
}

function exactAuthenticatedFee(evidence: CexFeeEvidence | null): evidence is CexFeeEvidence {
  return !!evidence && evidence.source !== 'configured_override' && Number.isFinite(evidence.takerFeeBps) && evidence.takerFeeBps >= 0;
}

async function hedgeSurface(
  venue: KalshiFundingHedgeVenue,
  baseAsset: string,
  maxAgeMs: number,
): Promise<{ venue: KalshiFundingHedgeVenue; symbol: string; constraints: SpotProductConstraints; fee: CexFeeEvidence; asks: StreamOrderBookLevel[]; bids: StreamOrderBookLevel[]; observedAt: number } | null> {
  const symbol = directUsdSymbol(baseAsset);
  try {
    const [constraints, quote, fee] = await Promise.all([
      getSpotProductConstraints(venue, symbol),
      cexOrderBookStreams.getQuote(venue as CexStreamVenue, symbol, maxAgeMs),
      resolveCexFeeEvidence(venue, symbol, { maxAgeMs }),
    ]);
    if (!compatibleSpotBase(constraints, baseAsset) || !quote || !exactAuthenticatedFee(fee)) return null;
    if (quote.depth.asks.length === 0 || quote.depth.bids.length === 0) return null;
    return {
      venue,
      symbol,
      constraints,
      fee,
      asks: quote.depth.asks,
      bids: quote.depth.bids,
      observedAt: quote.depth.observedAt,
    };
  } catch {
    return null;
  }
}

function candidateContracts(input: {
  targetNotionalUsd: number;
  contractSize: number;
  kalshiBids: readonly KalshiOrderbookLevel[];
  fractionalTradingEnabled: boolean;
  spotConstraints: SpotProductConstraints;
}): { contracts: number; baseQuantity: number } | null {
  const bestBid = input.kalshiBids.find(level => level.price > 0 && level.quantity > 0);
  if (!bestBid) return null;
  const availableContracts = input.kalshiBids.reduce((sum, level) => sum + (level.quantity > 0 ? level.quantity : 0), 0);
  const requestedContracts = Math.min(availableContracts, input.targetNotionalUsd / bestBid.price);
  const contractStep = contractIncrement(input.fractionalTradingEnabled);
  let contracts = floorTo(requestedContracts, contractStep);
  if (!(contracts > 0)) return null;

  // Quantize both legs until they represent the same underlying base exposure.
  let baseQuantity = floorTo(contracts * input.contractSize, input.spotConstraints.baseIncrement);
  if (!(baseQuantity >= input.spotConstraints.baseMinSize)) return null;
  contracts = floorTo(baseQuantity / input.contractSize, contractStep);
  baseQuantity = floorTo(contracts * input.contractSize, input.spotConstraints.baseIncrement);
  if (!(contracts > 0) || !(baseQuantity >= input.spotConstraints.baseMinSize)) return null;

  const hedgeMismatch = Math.abs(baseQuantity - contracts * input.contractSize);
  const tolerance = Math.max(input.spotConstraints.baseIncrement / 2, baseQuantity * 1e-8);
  if (hedgeMismatch > tolerance) return null;
  if (input.spotConstraints.baseMaxSize !== null && baseQuantity > input.spotConstraints.baseMaxSize + tolerance) return null;
  return { contracts, baseQuantity };
}

async function measureHedgeCandidate(input: {
  venueSurface: NonNullable<Awaited<ReturnType<typeof hedgeSurface>>>;
  ticker: string;
  baseAsset: string;
  contractSize: number;
  fractionalTradingEnabled: boolean;
  kalshiBids: readonly KalshiOrderbookLevel[];
  kalshiAsks: readonly KalshiOrderbookLevel[];
  kalshiTakerFeeBps: number;
  fundingRate: number;
  nextFundingTime: number;
  targetNotionalUsd: number;
  kalshiObservedAt: number;
  maxAgeMs: number;
}): Promise<KalshiFundingExecutionEvidence | null> {
  const quantity = candidateContracts({
    targetNotionalUsd: input.targetNotionalUsd,
    contractSize: input.contractSize,
    kalshiBids: input.kalshiBids,
    fractionalTradingEnabled: input.fractionalTradingEnabled,
    spotConstraints: input.venueSurface.constraints,
  });
  if (!quantity) return null;

  // Positive funding: short Kalshi perp by crossing bids; long USD spot by crossing asks.
  const perpEntry = walk(input.kalshiBids, quantity.contracts);
  const perpExitReference = walk(input.kalshiAsks, quantity.contracts);
  const spotEntry = walk(input.venueSurface.asks, quantity.baseQuantity);
  const spotExitReference = walk(input.venueSurface.bids, quantity.baseQuantity);
  if (!perpEntry || !perpExitReference || !spotEntry || !spotExitReference) return null;

  const perpEntryUnderlying = underlyingPrice(perpEntry.vwap, input.contractSize);
  const perpExitUnderlying = underlyingPrice(perpExitReference.vwap, input.contractSize);
  const entryBasisBps = Math.abs(perpEntryUnderlying - spotEntry.vwap) / spotEntry.vwap * 10_000;
  const exitBasisReserveBps = Math.abs(perpExitUnderlying - spotExitReference.vwap) / spotExitReference.vwap * 10_000;
  const expectedSlippageBps = slippageBps(perpEntry) + slippageBps(perpExitReference) + slippageBps(spotEntry) + slippageBps(spotExitReference);
  const measuredNotionalUsd = Math.max(perpEntry.vwap * quantity.contracts, spotEntry.vwap * quantity.baseQuantity);
  if (!(measuredNotionalUsd > 0)) return null;

  const expectedTradingFeesUsd = measuredNotionalUsd * (
    2 * input.kalshiTakerFeeBps + 2 * input.venueSurface.fee.takerFeeBps
  ) / 10_000;
  const measuredAt = Math.min(input.kalshiObservedAt, input.venueSurface.observedAt, input.venueSurface.fee.observedAt, Date.now());
  const expiresAt = measuredAt + input.maxAgeMs;

  const [exchangeStatus, riskLimit] = await Promise.all([
    getKalshiMarginExchangeStatus().catch(() => null),
    getKalshiNotionalRiskLimit().catch(() => ({ observedAt: Date.now(), defaultNotionalUsd: null, byTicker: {}, authenticated: false })),
  ]);
  if (!exchangeStatus?.exchangeActive || !exchangeStatus.tradingActive) return null;
  const notionalRiskLimitUsd = finite(riskLimit.byTicker[input.ticker] ?? riskLimit.defaultNotionalUsd);
  if (riskLimit.authenticated && notionalRiskLimitUsd !== null && measuredNotionalUsd > notionalRiskLimitUsd) return null;

  return {
    ticker: input.ticker,
    baseAsset: input.baseAsset,
    quoteAsset: 'USD',
    hedgeVenue: input.venueSurface.venue,
    hedgeSymbol: input.venueSurface.symbol,
    contracts: quantity.contracts,
    contractSize: input.contractSize,
    baseQuantity: quantity.baseQuantity,
    targetNotionalUsd: input.targetNotionalUsd,
    measuredNotionalUsd,
    kalshiEntryVwap: perpEntry.vwap,
    kalshiEntryLimit: perpEntry.worstPrice,
    kalshiExitReferenceVwap: perpExitReference.vwap,
    kalshiExitLimit: perpExitReference.worstPrice,
    spotEntryVwap: spotEntry.vwap,
    spotEntryLimit: spotEntry.worstPrice,
    spotExitReferenceVwap: spotExitReference.vwap,
    spotExitLimit: spotExitReference.worstPrice,
    kalshiTakerFeeBps: input.kalshiTakerFeeBps,
    hedgeTakerFeeBps: input.venueSurface.fee.takerFeeBps,
    expectedTradingFeesUsd,
    entryBasisBps,
    exitBasisReserveBps,
    expectedSlippageBps,
    fundingRate: input.fundingRate,
    nextFundingTime: input.nextFundingTime,
    fundingRateLocked: false,
    marketTradingActive: true,
    notionalRiskLimitUsd,
    authenticatedMarginAvailableUsd: null,
    authenticatedMarginAvailableComputed: false,
    measuredAt,
    expiresAt,
    provenance: [
      'kalshi_margin_orderbook:public_exact_depth',
      'kalshi_margin_fee_tiers:authenticated_effective',
      'kalshi_margin_funding_rate:current_estimate_not_locked',
      'kalshi_margin_exchange_status:public_active',
      riskLimit.authenticated ? 'kalshi_notional_risk_limit:authenticated' : 'kalshi_notional_risk_limit:unavailable_nonpromoting',
      `${input.venueSurface.venue}_spot_orderbook:fresh_stream_depth`,
      `${input.venueSurface.venue}_spot_fee:authenticated`,
      'hedge_quote_currency:direct_usd_only',
      'entry_exit_depth:fully_walked',
      'basis_reserve:measured_current_absolute_conservative',
      'funding_projection:not_deterministic_profit',
      'system_owned_margin_capital:not_yet_proven_by_market_evidence',
    ],
  };
}

export async function measureKalshiFundingExecutionEvidence(input: {
  ticker: string;
  targetNotionalUsd: number;
  maxAgeMs?: number;
}): Promise<KalshiFundingExecutionEvidence | null> {
  const ticker = input.ticker.trim().toUpperCase();
  const baseAsset = kalshiPerpBaseAsset(ticker);
  const targetNotionalUsd = finite(input.targetNotionalUsd);
  const maxAgeMs = Math.max(500, Math.min(10_000, Number(input.maxAgeMs ?? process.env.CRYPTOCRAWL_KALSHI_FUNDING_EVIDENCE_TTL_MS ?? 3_000)));
  if (!baseAsset || targetNotionalUsd === null || !(targetNotionalUsd > 0)) return null;

  const kalshi = await getKalshiPerpExecutionEvidence(ticker, true).catch(() => null);
  if (!kalshi || !kalshi.funding || !(kalshi.funding.fundingRate > 0)) return null;
  if (Date.now() - kalshi.observedAt > maxAgeMs) return null;

  const surfaces = (await Promise.all((['kraken', 'okx'] as const).map(venue => hedgeSurface(venue, baseAsset, maxAgeMs))))
    .filter((value): value is NonNullable<typeof value> => value !== null);
  const measured = (await Promise.all(surfaces.map(venueSurface => measureHedgeCandidate({
    venueSurface,
    ticker,
    baseAsset,
    contractSize: kalshi.market.contractSize,
    fractionalTradingEnabled: kalshi.market.fractionalTradingEnabled,
    kalshiBids: kalshi.orderbook.bids,
    kalshiAsks: kalshi.orderbook.asks,
    kalshiTakerFeeBps: kalshi.fees.takerFeeBps,
    fundingRate: kalshi.funding!.fundingRate,
    nextFundingTime: kalshi.funding!.nextFundingTime,
    targetNotionalUsd,
    kalshiObservedAt: kalshi.observedAt,
    maxAgeMs,
  })))).filter((value): value is KalshiFundingExecutionEvidence => value !== null);

  if (measured.length === 0) return null;
  measured.sort((left, right) => {
    const leftCost = left.expectedTradingFeesUsd + left.measuredNotionalUsd * (left.entryBasisBps + left.exitBasisReserveBps + left.expectedSlippageBps) / 10_000;
    const rightCost = right.expectedTradingFeesUsd + right.measuredNotionalUsd * (right.entryBasisBps + right.exitBasisReserveBps + right.expectedSlippageBps) / 10_000;
    return leftCost - rightCost || right.measuredNotionalUsd - left.measuredNotionalUsd || left.hedgeVenue.localeCompare(right.hedgeVenue);
  });
  return measured[0];
}

/**
 * Expensive authenticated available-balance computation is deferred until a
 * projected-positive route already exists. This is capital readiness evidence,
 * never system-ownership provenance by itself.
 */
export async function hydrateKalshiFundingCapitalReadiness(
  evidence: KalshiFundingExecutionEvidence,
): Promise<KalshiFundingExecutionEvidence | null> {
  if (evidence.expiresAt <= Date.now()) return null;
  const readiness = await getKalshiMarginAccountReadiness(true, true);
  if (!readiness.authenticated || !readiness.marginEnabled || !readiness.availableBalanceComputed) return null;
  return {
    ...evidence,
    authenticatedMarginAvailableUsd: readiness.availableBalanceUsd,
    authenticatedMarginAvailableComputed: true,
    provenance: [
      ...evidence.provenance,
      'kalshi_margin_available_balance:authenticated_computed',
      'kalshi_margin_balance_is_capacity_only_not_system_ownership',
    ],
  };
}

export function kalshiFundingEvidenceProjectedCostUsd(evidence: KalshiFundingExecutionEvidence): number {
  const bpsCost = evidence.entryBasisBps + evidence.exitBasisReserveBps + evidence.expectedSlippageBps;
  return evidence.expectedTradingFeesUsd + evidence.measuredNotionalUsd * bpsCost / 10_000;
}

export function kalshiFundingEvidenceProjectedFundingUsd(evidence: KalshiFundingExecutionEvidence): number {
  return evidence.measuredNotionalUsd * evidence.fundingRate;
}

export function kalshiFundingEvidenceProjectedNetUsd(evidence: KalshiFundingExecutionEvidence): number {
  return kalshiFundingEvidenceProjectedFundingUsd(evidence) - kalshiFundingEvidenceProjectedCostUsd(evidence);
}
