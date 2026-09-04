import type { CanonicalOpportunitySnapshot } from '../../intelligence/canonical-opportunity-state.js';
import type { UnifiedExecutionDecision } from '../../execution/unified-execution-router.js';
import { prepareCexNixGenBid, type NixGenPreparedBid } from './canonical-bid-adapters.js';
import { prepareSettlementCapableMeasuredPortfolio, type NixGenMeasuredPortfolioPreparation } from './measured-portfolio-preparation.js';
import { buildNixGenPortfolioView, type NixGenPortfolioView } from './portfolio-view.js';
import type { NixGenReplanSnapshot } from './replanner.js';

export type NixGenCexLiveCandidate = CanonicalOpportunitySnapshot & {
  plan: NonNullable<CanonicalOpportunitySnapshot['plan']>;
};

export interface NixGenGlobalLivePortfolioInput<T extends NixGenCexLiveCandidate> {
  cexCandidates: readonly T[];
  measuredDecisions: readonly UnifiedExecutionDecision[];
  /**
   * Optional already-prepared bids from independently authoritative lanes such as
   * the existing zero-capital engine. Supplying them does not transfer execution,
   * settlement or resource authority to this read-only helper.
   */
  additionalPrepared?: readonly NixGenPreparedBid[];
  now?: number;
  maxQuoteAgeMs: number;
  dispatchCapacity: number;
  terminalCalibrationFactor: (candidate: T) => number;
  decayUrgencyFactor: (candidate: T) => number;
  previous?: NixGenReplanSnapshot;
}

export interface NixGenGlobalLivePortfolio {
  generatedAt: number;
  authority: 'nix_gen_global_live_portfolio';
  executionAuthority: false;
  settlementAuthority: false;
  resourceAuthority: false;
  canonicalEconomicsAuthority: false;
  filtersCanonicalCandidates: false;
  cexPreparedCount: number;
  measuredPreparedCount: number;
  additionalPreparedCount: number;
  prepared: NixGenPreparedBid[];
  measuredPreparation: NixGenMeasuredPortfolioPreparation;
  portfolio: NixGenPortfolioView | null;
}

function cexFreshnessExpiry(candidate: NixGenCexLiveCandidate, now: number, maxQuoteAgeMs: number): number {
  const quoteAgeMs = Math.max(0, Number(candidate.plan.quoteAgeMs) || 0);
  const quoteRemainingMs = Math.max(1, maxQuoteAgeMs - quoteAgeMs);
  const observationRemainingMs = Math.max(1, candidate.observedAt + maxQuoteAgeMs - now);
  return now + Math.min(quoteRemainingMs, observationRemainingMs);
}

/**
 * Pure read-only portfolio builder across currently settlement-capable live
 * surfaces. CEX/maker and measured atomic bids are prepared here; independently
 * authoritative lanes (for example zero-capital) may contribute their already-
 * prepared bids through additionalPrepared. The live runtime's cross-lane rolling
 * surface is maintained by live-priority-registry.ts.
 */
export function buildNixGenGlobalLivePortfolio<T extends NixGenCexLiveCandidate>(
  input: NixGenGlobalLivePortfolioInput<T>,
): NixGenGlobalLivePortfolio {
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const maxQuoteAgeMs = Math.max(1, Number(input.maxQuoteAgeMs) || 1);
  const dispatchCapacity = Math.max(1, Math.min(64, Math.trunc(Number(input.dispatchCapacity) || 1)));

  const cexPrepared = input.cexCandidates
    .map(candidate => prepareCexNixGenBid(candidate, {
      now,
      expiresAt: cexFreshnessExpiry(candidate, now, maxQuoteAgeMs),
      probabilityOfProfitableExecution: candidate.assessment?.probabilityOfProfitableExecution,
      terminalCalibrationFactor: input.terminalCalibrationFactor(candidate),
      decayUrgencyFactor: input.decayUrgencyFactor(candidate),
      rankScore: candidate.assessment?.rankScore,
    }))
    .filter((prepared): prepared is NonNullable<typeof prepared> => prepared !== null);

  const measuredPreparation = prepareSettlementCapableMeasuredPortfolio({
    decisions: input.measuredDecisions,
    now,
    dispatchCapacity,
  });
  const additionalPrepared = (input.additionalPrepared || [])
    .filter(item => item.bid.expiresAt > now)
    .map(item => ({
      bid: {
        ...item.bid,
        economics: { ...item.bid.economics },
        execution: { ...item.bid.execution },
        advisory: item.bid.advisory ? { ...item.bid.advisory } : undefined,
        resources: item.bid.resources.map(resource => ({ ...resource })),
        metadata: item.bid.metadata ? { ...item.bid.metadata } : undefined,
      },
      budgets: item.budgets.map(budget => ({ ...budget })),
    }));
  const prepared = [...cexPrepared, ...measuredPreparation.prepared, ...additionalPrepared];
  const portfolio = prepared.length > 0
    ? buildNixGenPortfolioView({ prepared, now, dispatchCapacity }, input.previous)
    : null;

  return {
    generatedAt: now,
    authority: 'nix_gen_global_live_portfolio',
    executionAuthority: false,
    settlementAuthority: false,
    resourceAuthority: false,
    canonicalEconomicsAuthority: false,
    filtersCanonicalCandidates: false,
    cexPreparedCount: cexPrepared.length,
    measuredPreparedCount: measuredPreparation.prepared.length,
    additionalPreparedCount: additionalPrepared.length,
    prepared,
    measuredPreparation,
    portfolio,
  };
}
