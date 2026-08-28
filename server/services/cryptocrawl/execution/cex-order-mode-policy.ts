import type { CexFeeEvidence } from '../intelligence/cex-fee-resolver.js';

export type CexOrderMode = 'maker' | 'taker';
export type CexOrderModeCombination = 'maker_maker' | 'maker_taker' | 'taker_maker' | 'taker_taker';

export interface CexOrderModeDecision {
  mode: CexOrderModeCombination | null;
  buyMode: CexOrderMode | null;
  sellMode: CexOrderMode | null;
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
  if (evidence.makerFeeBps !== null && Number.isFinite(evidence.makerFeeBps)) return Math.max(0, evidence.makerFeeBps);
  if (evidence.makerRebateBps !== null && Number.isFinite(evidence.makerRebateBps)) return -Math.max(0, evidence.makerRebateBps);
  return null;
}

function authenticated(evidence: CexFeeEvidence | null): boolean {
  return Boolean(evidence && evidence.source !== 'configured_override');
}

function emptyDecision(stablecoinPair: boolean, reason: string): CexOrderModeDecision {
  return {
    mode: null,
    buyMode: null,
    sellMode: null,
    buyFeeBps: null,
    sellFeeBps: null,
    combinedFeeBps: null,
    projectedNetAfterExchangeFeesBps: null,
    stablecoinPair,
    reason,
    authority: 'authenticated_fee_mode_policy',
  };
}

/**
 * Chooses the strongest positive exchange-fee edge across all four leg-mode
 * combinations using authenticated account fee evidence only. It does not
 * fabricate maker discounts and does not silently convert an unfilled maker leg
 * into a taker leg. Fixed costs, depth, queue/fill evidence, inventory,
 * slippage, freshness and settlement remain downstream execution authorities.
 */
export function chooseCexOrderMode(input: {
  symbol: string;
  grossSpreadBps: number;
  buyFeeEvidence: CexFeeEvidence | null;
  sellFeeEvidence: CexFeeEvidence | null;
}): CexOrderModeDecision {
  const stablecoinPair = isStablecoinPair(input.symbol);
  const gross = Number(input.grossSpreadBps);
  if (!Number.isFinite(gross) || gross <= 0) return emptyDecision(stablecoinPair, 'non_positive_gross_spread');

  const buy = input.buyFeeEvidence;
  const sell = input.sellFeeEvidence;
  if (!authenticated(buy) || !authenticated(sell)) return emptyDecision(stablecoinPair, 'authenticated_fee_evidence_required');

  const makerBuy = effectiveMakerFeeBps(buy);
  const makerSell = effectiveMakerFeeBps(sell);
  const takerBuy = Number.isFinite(buy!.takerFeeBps) ? Math.max(0, buy!.takerFeeBps) : null;
  const takerSell = Number.isFinite(sell!.takerFeeBps) ? Math.max(0, sell!.takerFeeBps) : null;

  const candidates: Array<{
    mode: CexOrderModeCombination;
    buyMode: CexOrderMode;
    sellMode: CexOrderMode;
    buyFeeBps: number | null;
    sellFeeBps: number | null;
  }> = [
    { mode: 'maker_maker', buyMode: 'maker', sellMode: 'maker', buyFeeBps: makerBuy, sellFeeBps: makerSell },
    { mode: 'maker_taker', buyMode: 'maker', sellMode: 'taker', buyFeeBps: makerBuy, sellFeeBps: takerSell },
    { mode: 'taker_maker', buyMode: 'taker', sellMode: 'maker', buyFeeBps: takerBuy, sellFeeBps: makerSell },
    { mode: 'taker_taker', buyMode: 'taker', sellMode: 'taker', buyFeeBps: takerBuy, sellFeeBps: takerSell },
  ];

  const viable = candidates
    .filter(candidate => candidate.buyFeeBps !== null && candidate.sellFeeBps !== null)
    .map(candidate => {
      const combinedFeeBps = candidate.buyFeeBps! + candidate.sellFeeBps!;
      return { ...candidate, combinedFeeBps, netBps: gross - combinedFeeBps };
    })
    .filter(candidate => Number.isFinite(candidate.netBps) && candidate.netBps > 0)
    .sort((left, right) => {
      if (right.netBps !== left.netBps) return right.netBps - left.netBps;
      // At equal economics, prefer fewer market-taking legs.
      const leftTakers = Number(left.buyMode === 'taker') + Number(left.sellMode === 'taker');
      const rightTakers = Number(right.buyMode === 'taker') + Number(right.sellMode === 'taker');
      return leftTakers - rightTakers;
    });

  const best = viable[0];
  if (!best) {
    const availableCosts = candidates
      .filter(candidate => candidate.buyFeeBps !== null && candidate.sellFeeBps !== null)
      .map(candidate => candidate.buyFeeBps! + candidate.sellFeeBps!);
    const lowestCost = availableCosts.length > 0 ? Math.min(...availableCosts) : null;
    return {
      ...emptyDecision(stablecoinPair, 'fees_consume_gross_spread'),
      combinedFeeBps: lowestCost,
      projectedNetAfterExchangeFeesBps: lowestCost === null ? null : gross - lowestCost,
    };
  }

  return {
    mode: best.mode,
    buyMode: best.buyMode,
    sellMode: best.sellMode,
    buyFeeBps: best.buyFeeBps,
    sellFeeBps: best.sellFeeBps,
    combinedFeeBps: best.combinedFeeBps,
    projectedNetAfterExchangeFeesBps: best.netBps,
    stablecoinPair,
    reason: stablecoinPair ? `stablecoin_authenticated_${best.mode}_edge` : `authenticated_${best.mode}_edge`,
    authority: 'authenticated_fee_mode_policy',
  };
}
