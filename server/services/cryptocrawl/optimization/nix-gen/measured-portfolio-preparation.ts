import { measuredCandidateRegistry } from '../../discovery/measured-candidate-registry.js';
import { getGasSponsorManager } from '../../strategies/gas-sponsorship.js';
import type { UnifiedExecutionDecision } from '../../execution/unified-execution-router.js';
import { prepareMeasuredTopologyNixGenBid, type NixGenPreparedBid } from './canonical-bid-adapters.js';
import { clearNixGenLivePriority, publishNixGenLivePriority } from './live-priority-registry.js';
import { buildNixGenPortfolioView, type NixGenPortfolioView } from './portfolio-view.js';
import type { NixGenReplanSnapshot } from './replanner.js';
import { getNixGenTerminalCalibration } from './terminal-calibration.js';

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

export interface NixGenMeasuredOrderingResult {
  decisions: UnifiedExecutionDecision[];
  enabled: boolean;
  applied: boolean;
  preparation: NixGenMeasuredPortfolioPreparation | null;
  error: string | null;
}

let previousMeasuredReplan: NixGenReplanSnapshot | undefined;

function terminalStrategy(decision: UnifiedExecutionDecision): string {
  if (decision.topology === 'LIQUIDATION' && decision.path === 'FLASH_LOAN_LIQUIDATION') {
    return 'aave_v3_atomic_liquidation_0x_unwind';
  }
  return 'dex_0x_atomic_roundtrip';
}

function settlementCapableMeasuredDecision(decision: UnifiedExecutionDecision): boolean {
  return (decision.topology === 'DEX_ATOMIC' && decision.path === 'FLASH_LOAN')
    || (decision.topology === 'LIQUIDATION' && decision.path === 'FLASH_LOAN_LIQUIDATION');
}

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
    if (!settlementCapableMeasuredDecision(decision)) {
      skipped.push({ opportunityId: decision.opportunityId, reason: 'unsupported_or_unsettled_topology' });
      continue;
    }
    const bid = prepareMeasuredTopologyNixGenBid(candidate, decision, fundingMode);
    if (!bid) {
      skipped.push({ opportunityId: decision.opportunityId, reason: 'canonical_bid_not_preparable' });
      continue;
    }

    const calibration = getNixGenTerminalCalibration({
      chain: candidate.chains[0],
      symbol: candidate.assets.join('/'),
      strategy: terminalStrategy(decision),
      expectedNetProfitUsd: bid.bid.economics.netProfitUsd,
    });
    prepared.push({
      bid: {
        ...bid.bid,
        advisory: {
          ...bid.bid.advisory,
          terminalCalibrationFactor: calibration.factor,
        },
        metadata: {
          ...bid.bid.metadata,
          terminalCalibrationAuthority: calibration.authority,
          terminalCalibrationSamples: calibration.terminalSamples,
        },
      },
      budgets: bid.budgets,
    });
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

export function orderSettlementCapableMeasuredDecisionsWithNixGen(
  decisions: readonly UnifiedExecutionDecision[],
  dispatchCapacity = 8,
  now = Date.now(),
): NixGenMeasuredOrderingResult {
  const original = [...decisions];
  const enabled = process.env.CRYPTOCRAWL_NIX_GEN_ADVISORY_ORDERING !== 'false';
  if (!enabled) {
    previousMeasuredReplan = undefined;
    clearNixGenLivePriority('measured_atomic');
    return { decisions: original, enabled, applied: false, preparation: null, error: null };
  }
  if (original.length === 0) {
    clearNixGenLivePriority('measured_atomic');
    return { decisions: original, enabled, applied: false, preparation: null, error: null };
  }

  try {
    const preparation = prepareSettlementCapableMeasuredPortfolio({
      decisions: original,
      now,
      dispatchCapacity,
      previous: previousMeasuredReplan,
    });
    previousMeasuredReplan = preparation.portfolio?.replan;
    const live = publishNixGenLivePriority({
      source: 'measured_atomic',
      prepared: preparation.prepared,
      now,
      dispatchCapacity,
    });
    if (preparation.prepared.length === 0) {
      return { decisions: original, enabled, applied: false, preparation, error: null };
    }

    const localPriority = new Map((preparation.portfolio?.priority || []).map(entry => [entry.opportunityId, entry.priorityIndex]));
    const globalPriority = live.priorityIndexByOpportunityId;
    const movable = original
      .filter(decision => localPriority.has(decision.opportunityId))
      .sort((left, right) => {
        const leftGlobal = globalPriority[left.opportunityId];
        const rightGlobal = globalPriority[right.opportunityId];
        const leftGlobalKnown = Number.isInteger(leftGlobal) && leftGlobal >= 0;
        const rightGlobalKnown = Number.isInteger(rightGlobal) && rightGlobal >= 0;
        if (leftGlobalKnown && rightGlobalKnown && leftGlobal !== rightGlobal) return leftGlobal - rightGlobal;
        if (leftGlobalKnown !== rightGlobalKnown) return leftGlobalKnown ? -1 : 1;
        return (localPriority.get(left.opportunityId) ?? Number.MAX_SAFE_INTEGER)
          - (localPriority.get(right.opportunityId) ?? Number.MAX_SAFE_INTEGER);
      });
    let cursor = 0;
    const ordered = original.map(decision => localPriority.has(decision.opportunityId)
      ? movable[cursor++] ?? decision
      : decision);

    return {
      decisions: ordered,
      enabled,
      applied: ordered.some((decision, index) => decision.opportunityId !== original[index]?.opportunityId),
      preparation,
      error: null,
    };
  } catch (error) {
    return {
      decisions: original,
      enabled,
      applied: false,
      preparation: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
