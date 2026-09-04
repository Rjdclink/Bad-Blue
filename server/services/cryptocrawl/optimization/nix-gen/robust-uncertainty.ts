import type { NixGenStrategyBid } from './types.js';

const EPSILON = 1e-9;

export interface NixGenUncertaintyComponent {
  /** Independent measured downside envelope. This is not canonical economics. */
  label: string;
  maxAdverseUsd: number;
  measuredAt: number;
  validUntil: number;
  authority: string;
}

export interface NixGenRobustnessInput {
  bid: NixGenStrategyBid;
  components: readonly NixGenUncertaintyComponent[];
  /** Bertsimas-Sim-style budget of uncertainty. May be fractional. */
  uncertaintyBudget: number;
  now?: number;
}

export interface NixGenRobustnessSnapshot {
  generatedAt: number;
  authority: 'nix_gen_advisory_robustness';
  executionAuthority: false;
  canonicalEconomicsAuthority: false;
  filtersCanonicalCandidates: false;
  bidId: string;
  opportunityId: string;
  canonicalNetProfitUsd: number;
  uncertaintyBudget: number;
  componentsUsed: number;
  completeEvidence: boolean;
  invalidEvidence: string[];
  /** Advisory reserve only; null means evidence was insufficient or invalid. */
  reserveUsd: number | null;
  /** Canonical profit minus advisory reserve. Never written back into canonical economics. */
  robustAdvisoryValueUsd: number | null;
}

function boundedBudget(value: unknown, componentCount: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(componentCount, parsed));
}

function validateComponent(component: NixGenUncertaintyComponent, now: number): string | null {
  if (!component.label.trim()) return 'missing_label';
  if (!component.authority.trim()) return `missing_authority:${component.label}`;
  if (!Number.isFinite(component.maxAdverseUsd) || component.maxAdverseUsd < 0) {
    return `invalid_adverse_usd:${component.label}`;
  }
  if (!Number.isFinite(component.measuredAt) || component.measuredAt <= 0 || component.measuredAt > now) {
    return `invalid_measured_at:${component.label}`;
  }
  if (!Number.isFinite(component.validUntil) || component.validUntil <= now) {
    return `expired_evidence:${component.label}`;
  }
  return null;
}

function budgetedReserve(components: readonly NixGenUncertaintyComponent[], gamma: number): number {
  if (gamma <= EPSILON || components.length === 0) return 0;
  const ordered = [...components].sort((left, right) => right.maxAdverseUsd - left.maxAdverseUsd || left.label.localeCompare(right.label));
  const whole = Math.floor(gamma);
  const fractional = gamma - whole;
  let reserve = 0;
  for (let index = 0; index < Math.min(whole, ordered.length); index++) reserve += ordered[index].maxAdverseUsd;
  if (fractional > EPSILON && whole < ordered.length) reserve += fractional * ordered[whole].maxAdverseUsd;
  return Math.max(0, reserve);
}

/**
 * Pure advisory robust-value diagnostic.
 *
 * It consumes independent downside envelopes and applies a budgeted uncertainty
 * reserve. It never mutates canonical economics, eligibility, resource truth,
 * execution authority, settlement state, or candidate membership.
 */
export function evaluateNixGenRobustness(input: NixGenRobustnessInput): NixGenRobustnessSnapshot {
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const invalidEvidence = input.components
    .map(component => validateComponent(component, now))
    .filter((reason): reason is string => reason !== null);
  const completeEvidence = input.components.length > 0 && invalidEvidence.length === 0;
  const uncertaintyBudget = boundedBudget(input.uncertaintyBudget, input.components.length);
  const reserveUsd = completeEvidence ? budgetedReserve(input.components, uncertaintyBudget) : null;
  const robustAdvisoryValueUsd = reserveUsd === null ? null : input.bid.economics.netProfitUsd - reserveUsd;

  return {
    generatedAt: now,
    authority: 'nix_gen_advisory_robustness',
    executionAuthority: false,
    canonicalEconomicsAuthority: false,
    filtersCanonicalCandidates: false,
    bidId: input.bid.bidId,
    opportunityId: input.bid.opportunityId,
    canonicalNetProfitUsd: input.bid.economics.netProfitUsd,
    uncertaintyBudget,
    componentsUsed: completeEvidence ? input.components.length : 0,
    completeEvidence,
    invalidEvidence,
    reserveUsd,
    robustAdvisoryValueUsd,
  };
}
