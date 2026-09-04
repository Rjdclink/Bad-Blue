import { measuredCandidateRegistry } from '../../discovery/measured-candidate-registry.js';
import { getGasSponsorManager } from '../../strategies/gas-sponsorship.js';
import type { UnifiedExecutionDecision } from '../../execution/unified-execution-router.js';
import { prepareMeasuredTopologyNixGenBid, type NixGenPreparedBid } from './canonical-bid-adapters.js';
import { buildNixGenPortfolioView, type NixGenPortfolioView } from './portfolio-view.js';
import type { NixGenReplanSnapshot } from './replanner.js';

export interface NixGenMeasuredPortfolioSkip {
  opportunityId: string;
  reason:
    | 'candidate_missing'
    | 'candidate_expired'
    | 'decision_not_admitted'
    | 'unsupported_or_unsettled_topology'
    | 'canonical_bid_not_preparable';
}

export interface NixGenMeasuredPortfolioPreparation {
  generatedAt: number;
  authority: 'nix_gen_measured_portfolio_preparation';
  executionAuthority: false;
  settlementAuthority: false;
  resourceAuthority: false;
  mutatesCandidateState: false;
  fundingMode: 'sponsored' | 'native';
  prepared: NixGenPreparedBid[];
  skipped: NixGenMeasuredPortfolioSkip[];
  portfolio: NixGenPortfolioView | null;
}

export interface PrepareMeasuredPortfolioInput {
  decisions: readonly UnifiedExecutionDecision[];
  now?: number;
  dispatchCapacity?: number;
  previous?: NixGenReplanSnapshot;
}

/**
 * Builds a read-only Nix-Gen portfolio from measured candidates that already
 * possess a settlement-capable canonical execution path. This function never
 * dispatches, reserves resources, updates candidate status, or manufactures
 * economics/capability. Unsupported topologies remain outside Nix-Gen until an
 * authoritative executor/settlement path exists upstream.
 */
export function prepareSettlementCapableMeasuredPortfolio(
  input: PrepareMeasuredPortfolioInput,
): NixGenMeasuredPortfolioPreparation {
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const dispatchCapacity = Math.max(1, Math.min(32, Math.trunc(Number(input.dispatchCapacity) || 8)));
  const fundingMode: 'sponsored' | 'native' = getGasSponsorManager().getReadiness().ready ? 'sponsored' : 'native';
  const prepared: NixGenPreparedBid[] = [];
  const skipped: NixGenMeasuredPortfolioSkip[] = [];

  for (const decision of input.decisions) {
    const candidate = measuredCandidateRegistry.get(decision.opportunityId);
    if (!candidate) {
      skipped.push({ opportunityId: decision.opportunityId, reason: 'candidate_missing' });
      continue;
    }
    if (candidate.expiresAt <= now) {
      skipped.push({ opportunityId: decision.opportunityId, reason: 'candidate_expired' });
      continue;
    }
    if (!decision.admitted || candidate.status !== 'eligible' || !candidate.executableCapability) {
      skipped.push({ opportunityId: decision.opportunityId, reason: 'decision_not_admitted' });
      continue;
    }
    const supported =
      (decision.topology === 'DEX_ATOMIC' && decision.path === 'FLASH_LOAN')
      || (decision.topology === 'LIQUIDATION' && decision.path === 'FLASH_LOAN_LIQUIDATION');
    if (!supported) {
      skipped.push({ opportunityId: decision.opportunityId, reason: 'unsupported_or_unsettled_topology' });
      continue;
    }
    const bid = prepareMeasuredTopologyNixGenBid(candidate, decision, fundingMode);
    if (!bid) {
      skipped.push({ opportunityId: decision.opportunityId, reason: 'canonical_bid_not_preparable' });
      continue;
    }
    prepared.push(bid);
  }

  const portfolio = prepared.length > 0
    ? buildNixGenPortfolioView({ prepared, now, dispatchCapacity }, input.previous)
    : null;

  return {
    generatedAt: now,
    authority: 'nix_gen_measured_portfolio_preparation',
    executionAuthority: false,
    settlementAuthority: false,
    resourceAuthority: false,
    mutatesCandidateState: false,
    fundingMode,
    prepared,
    skipped,
    portfolio,
  };
}
