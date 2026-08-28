import logger from '../../../logger.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from './measured-candidate-registry.js';

export interface FundingBasisObservation {
  venue: string;
  symbol: string;
  observedAt: number;
  fundingRate: number;
  nextFundingAt: number;
  markPrice: number;
  indexPrice: number;
  lastPrice?: number;
  spotPrice: number;
  contractSize: number;
  tickSize: number;
  lotSize: number;
  minimumQuantity: number;
  notionalUsd: number;
  takerFeeUsd: number | null;
  makerFeeUsd: number | null;
  borrowCarryUsd: number | null;
  marginRequiredUsd: number | null;
  availableMarginUsd: number | null;
  estimatedSlippageUsd: number | null;
  liquidationRiskUsd: number | null;
  settlementRiskUsd: number | null;
  provenance: string[];
}

function validFinite(value: number): boolean { return Number.isFinite(value); }
function positive(value: number): boolean { return Number.isFinite(value) && value > 0; }
function idFor(input: FundingBasisObservation): string {
  return `funding:${input.venue}:${input.symbol}:${input.nextFundingAt}`;
}

export function evaluateFundingBasisObservation(input: FundingBasisObservation): MeasuredCandidate {
  if (!input.venue.trim() || !input.symbol.trim()) throw new Error('Funding observation requires venue and symbol');
  if (!positive(input.markPrice) || !positive(input.indexPrice) || !positive(input.spotPrice) || !positive(input.notionalUsd)) throw new Error('Funding observation requires positive measured price/notional evidence');
  if (!validFinite(input.fundingRate) || input.nextFundingAt <= input.observedAt) throw new Error('Funding observation requires a valid rate and future funding timestamp');
  const missing: string[] = [];
  for (const [name, value] of Object.entries({
    takerFeeUsd: input.takerFeeUsd,
    borrowCarryUsd: input.borrowCarryUsd,
    marginRequiredUsd: input.marginRequiredUsd,
    availableMarginUsd: input.availableMarginUsd,
    estimatedSlippageUsd: input.estimatedSlippageUsd,
    liquidationRiskUsd: input.liquidationRiskUsd,
    settlementRiskUsd: input.settlementRiskUsd,
  })) if (value === null || !Number.isFinite(value) || value < 0) missing.push(name);

  const fundingPaymentUsd = Math.abs(input.fundingRate) * input.notionalUsd;
  const basisPct = (input.markPrice - input.spotPrice) / input.spotPrice;
  const basisConvergenceUsd = Math.abs(basisPct) * input.notionalUsd;
  const grossProfitUsd = fundingPaymentUsd + basisConvergenceUsd;
  const costsKnown = missing.length === 0;
  const totalCostsUsd = costsKnown
    ? (input.takerFeeUsd! * 2) + input.borrowCarryUsd! + input.estimatedSlippageUsd! + input.liquidationRiskUsd! + input.settlementRiskUsd!
    : null;
  const netProfitUsd = totalCostsUsd === null ? null : grossProfitUsd - totalCostsUsd;
  const marginReady = input.marginRequiredUsd !== null && input.availableMarginUsd !== null && input.availableMarginUsd >= input.marginRequiredUsd;
  const deterministicPositive = netProfitUsd !== null && netProfitUsd > 0 && marginReady;

  return measuredCandidateRegistry.record({
    opportunityId: idFor(input),
    topology: 'FUNDING_ARBITRAGE',
    observedAt: input.observedAt,
    expiresAt: input.nextFundingAt,
    status: deterministicPositive ? 'deterministic_positive' : missing.length ? 'enriched' : 'blocked',
    assets: [input.symbol],
    venues: [input.venue],
    chains: [],
    rawQuotes: [
      { source: `${input.venue}:funding`, venue: input.venue, symbol: input.symbol, observedAt: input.observedAt, price: input.markPrice, provenance: input.provenance },
      { source: `${input.venue}:spot`, venue: input.venue, symbol: input.symbol, observedAt: input.observedAt, price: input.spotPrice, provenance: input.provenance },
    ],
    depth: { status: 'not_applicable', detail: 'funding/basis candidate requires venue-specific derivative and hedge inventory checks before execution' },
    economics: {
      grossProfitUsd,
      deterministicNetProfitUsd: netProfitUsd,
      feeUsd: totalCostsUsd === null ? null : input.takerFeeUsd! * 2,
      gasUsd: 0,
      bridgeUsd: 0,
      expectedSlippageBps: input.estimatedSlippageUsd === null ? null : input.estimatedSlippageUsd / input.notionalUsd * 10_000,
      expectedPriceImpactBps: null,
    },
    quoteAgeMs: Math.max(0, Date.now() - input.observedAt),
    executableCapability: false,
    executionCapabilityReason: deterministicPositive
      ? 'economically positive funding/basis observation exists, but no live derivative settlement adapter is authorized yet'
      : 'funding percentage alone is insufficient; exact all-in costs, margin, and risk must be measured',
    missingInformation: [...missing, ...(!marginReady ? ['hedge_margin_readiness'] : [])],
    provenance: [...new Set([...input.provenance, 'canonical_funding_basis_engine', 'high_funding_rate_not_execution_authority'])],
  });
}

export async function scanOkxPublicFunding(symbols: string[]): Promise<MeasuredCandidate[]> {
  const results: MeasuredCandidate[] = [];
  for (const symbol of symbols.slice(0, Math.max(1, Number(process.env.FUNDING_SCAN_SYMBOL_LIMIT || 12)))) {
    const base = symbol.toUpperCase().replace(/(?:USDT|USDC|USD)$/,'');
    const instId = `${base}-USDT-SWAP`;
    try {
      const response = await fetch(`https://www.okx.com/api/v5/public/funding-rate?instId=${encodeURIComponent(instId)}`, { headers: { accept: 'application/json' } });
      if (!response.ok) continue;
      const payload = await response.json() as any;
      const row = Array.isArray(payload?.data) ? payload.data[0] : null;
      if (!row) continue;
      const markPrice = Number(row.markPx || row.indexPx);
      const indexPrice = Number(row.indexPx || row.markPx);
      const rate = Number(row.fundingRate);
      const nextFundingAt = Number(row.nextFundingTime);
      if (!positive(markPrice) || !positive(indexPrice) || !Number.isFinite(rate) || !Number.isFinite(nextFundingAt)) continue;
      // Public funding data is useful discovery evidence, but authenticated fees,
      // hedge spot price, margin, carry, and liquidation risk are deliberately
      // left unknown so this observation cannot become executable by itself.
      results.push(evaluateFundingBasisObservation({
        venue: 'okx', symbol, observedAt: Date.now(), fundingRate: rate, nextFundingAt,
        markPrice, indexPrice, spotPrice: indexPrice, contractSize: 1, tickSize: 0, lotSize: 0,
        minimumQuantity: 0, notionalUsd: Math.max(1, Number(process.env.FUNDING_DISCOVERY_NOTIONAL_USD || 100)),
        takerFeeUsd: null, makerFeeUsd: null, borrowCarryUsd: null, marginRequiredUsd: null,
        availableMarginUsd: null, estimatedSlippageUsd: null, liquidationRiskUsd: null, settlementRiskUsd: null,
        provenance: ['okx_public_funding_rate','public_discovery_only'],
      }));
    } catch (error) {
      logger.debug('[FundingBasis] OKX public funding scan degraded', { symbol, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
