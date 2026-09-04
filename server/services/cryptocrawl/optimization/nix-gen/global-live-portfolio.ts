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
 * One read-only portfolio across the currently settlement-capable live topology
 * surface. The coordinator applies the shared scheduler dispatch resource in
 * addition to topology-specific read-only budgets, so the portfolio can compare
 * scarce capacity globally without acquiring a lease or suppressing an upstream
 * canonical candidate.
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
  const prepared = [...cexPrepared, ...measuredPreparation.prepared];
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
    prepared,
    measuredPreparation,
    portfolio,
  };
}
