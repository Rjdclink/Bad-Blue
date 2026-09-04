import { measuredCandidateRegistry } from '../../discovery/measured-candidate-registry.js';
import { getGasSponsorManager } from '../../strategies/gas-sponsorship.js';
import type { UnifiedExecutionDecision } from '../../execution/unified-execution-router.js';
import { prepareMeasuredTopologyNixGenBid, type NixGenPreparedBid } from './canonical-bid-adapters.js';
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

/**
 * Opt-in fail-open measured-topology scheduling order. Only already-admitted,
 * settlement-capable DEX/liquidation decisions can move relative to one another.
 * Unsupported/non-admitted decisions retain their original positions and Nix-Gen
 * never changes admission, economics, resource ownership, or execution authority.
 */
export function orderSettlementCapableMeasuredDecisionsWithNixGen(
  decisions: readonly UnifiedExecutionDecision[],
  dispatchCapacity = 8,
  now = Date.now(),
): NixGenMeasuredOrderingResult {
  const original = [...decisions];
  const enabled = process.env.CRYPTOCRAWL_NIX_GEN_ADVISORY_ORDERING === 'true';
  if (!enabled || original.length < 2) {
    if (!enabled) previousMeasuredReplan = undefined;
    return { decisions: original, enabled, applied: false, preparation: null, error: null };
  }

  try {
    const preparation = prepareSettlementCapableMeasuredPortfolio({
      decisions: original,
      now,
      dispatchCapacity,
      previous: previousMeasuredReplan,
    });
    if (!preparation.portfolio || preparation.portfolio.priority.length < 2) {
      previousMeasuredReplan = preparation.portfolio?.replan;
      return { decisions: original, enabled, applied: false, preparation, error: null };
    }
    previousMeasuredReplan = preparation.portfolio.replan;

    const priority = new Map(preparation.portfolio.priority.map(entry => [entry.opportunityId, entry.priorityIndex]));
    const movable = original
      .filter(decision => priority.has(decision.opportunityId))
      .sort((left, right) =>
        (priority.get(left.opportunityId) ?? Number.MAX_SAFE_INTEGER)
        - (priority.get(right.opportunityId) ?? Number.MAX_SAFE_INTEGER),
      );
    let cursor = 0;
    const ordered = original.map(decision => priority.has(decision.opportunityId)
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
