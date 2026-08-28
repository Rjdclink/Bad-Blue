import type { CexFeeEvidence } from '../intelligence/cex-fee-resolver.js';

export type CexOrderMode = 'maker' | 'taker';

export interface CexOrderModeDecision {
  mode: CexOrderMode | null;
  buyFeeBps: number | null;
  sellFeeBps: number | null;
  combinedFeeBps: number | null;
  projectedNetAfterExchangeFeesBps: number | null;
  stablecoinPair: boolean;
  reason: string;
  authority: 'authenticated_fee_mode_policy';
}

const STABLECOINS = new Set(['USDT', 'USDC', 'USD', 'USDG', 'DAI', 'RLUSD', 'USDP', 'PYUSD', 'FDUSD', 'TUSD']);

function splitSymbol(symbol: string): { base: string; quote: string } | null {
  const normalized = symbol.trim().toUpperCase();
  const quotes = [...STABLECOINS].sort((left, right) => right.length - left.length);
  const quote = quotes.find(candidate => normalized.endsWith(candidate));
  if (!quote) return null;
  const base = normalized.slice(0, -quote.length);
  return base ? { base, quote } : null;
}

export function isStablecoinPair(symbol: string): boolean {
  const pair = splitSymbol(symbol);
  return Boolean(pair && STABLECOINS.has(pair.base) && STABLECOINS.has(pair.quote));
}

function effectiveMakerFeeBps(evidence: CexFeeEvidence | null): number | null {
  if (!evidence) return null;
  if (evidence.makerFeeBps !== null && Number.isFinite(evidence.makerFeeBps)) {
    return Math.max(0, evidence.makerFeeBps);
  }
  if (evidence.makerRebateBps !== null && Number.isFinite(evidence.makerRebateBps)) {
    return -Math.max(0, evidence.makerRebateBps);
  }
  return null;
}

function authenticated(evidence: CexFeeEvidence | null): boolean {
  return Boolean(evidence && evidence.source !== 'configured_override');
}

/**
 * Chooses the lowest-cost execution mode only from measured/authenticated fee
 * evidence. This policy never fabricates a fee, never converts a maker timeout
 * into a taker order, and never makes a negative exchange-fee edge executable.
 * Fixed costs, slippage, inventory, queue/fill evidence and settlement remain
 * downstream authorities before live execution.
 */
export function chooseCexOrderMode(input: {
  symbol: string;
  grossSpreadBps: number;
  buyFeeEvidence: CexFeeEvidence | null;
  sellFeeEvidence: CexFeeEvidence | null;
}): CexOrderModeDecision {
  const stablecoinPair = isStablecoinPair(input.symbol);
  const gross = Number(input.grossSpreadBps);
  if (!Number.isFinite(gross) || gross <= 0) {
    return {
      mode: null,
      buyFeeBps: null,
      sellFeeBps: null,
      combinedFeeBps: null,
      projectedNetAfterExchangeFeesBps: null,
      stablecoinPair,
      reason: 'non_positive_gross_spread',
      authority: 'authenticated_fee_mode_policy',
    };
  }

  const buy = input.buyFeeEvidence;
  const sell = input.sellFeeEvidence;
  if (!authenticated(buy) || !authenticated(sell)) {
    return {
      mode: null,
      buyFeeBps: null,
      sellFeeBps: null,
      combinedFeeBps: null,
      projectedNetAfterExchangeFeesBps: null,
      stablecoinPair,
      reason: 'authenticated_fee_evidence_required',
      authority: 'authenticated_fee_mode_policy',
    };
  }

  const makerBuy = effectiveMakerFeeBps(buy);
  const makerSell = effectiveMakerFeeBps(sell);
  const takerBuy = Number.isFinite(buy!.takerFeeBps) ? Math.max(0, buy!.takerFeeBps) : null;
  const takerSell = Number.isFinite(sell!.takerFeeBps) ? Math.max(0, sell!.takerFeeBps) : null;

  const makerCombined = makerBuy !== null && makerSell !== null ? makerBuy + makerSell : null;
  const takerCombined = takerBuy !== null && takerSell !== null ? takerBuy + takerSell : null;
  const makerNet = makerCombined !== null ? gross - makerCombined : null;
  const takerNet = takerCombined !== null ? gross - takerCombined : null;

  // Maker is preferred whenever it creates the stronger positive exchange-fee
  // edge. Stablecoin pairs naturally benefit most because their measured maker
  // schedules can be materially cheaper; no hard-coded fee discount is assumed.
  if (makerNet !== null && makerNet > 0 && (takerNet === null || makerNet >= takerNet)) {
    return {
      mode: 'maker',
      buyFeeBps: makerBuy,
      sellFeeBps: makerSell,
      combinedFeeBps: makerCombined,
      projectedNetAfterExchangeFeesBps: makerNet,
      stablecoinPair,
      reason: stablecoinPair ? 'stablecoin_authenticated_maker_edge' : 'authenticated_maker_edge',
      authority: 'authenticated_fee_mode_policy',
    };
  }

  if (takerNet !== null && takerNet > 0) {
    return {
      mode: 'taker',
      buyFeeBps: takerBuy,
      sellFeeBps: takerSell,
      combinedFeeBps: takerCombined,
      projectedNetAfterExchangeFeesBps: takerNet,
      stablecoinPair,
      reason: 'authenticated_taker_edge',
      authority: 'authenticated_fee_mode_policy',
    };
  }

  return {
    mode: null,
    buyFeeBps: makerBuy ?? takerBuy,
    sellFeeBps: makerSell ?? takerSell,
    combinedFeeBps: makerCombined ?? takerCombined,
    projectedNetAfterExchangeFeesBps: Math.max(makerNet ?? Number.NEGATIVE_INFINITY, takerNet ?? Number.NEGATIVE_INFINITY),
    stablecoinPair,
    reason: 'fees_consume_gross_spread',
    authority: 'authenticated_fee_mode_policy',
  };
}
