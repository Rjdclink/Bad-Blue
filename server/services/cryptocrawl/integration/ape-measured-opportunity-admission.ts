import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import { clearsStageOneOutputFloorBps } from '../discovery/stage-one-candidate-policy.js';

export type ApeMeasuredEvidenceSource = 'measured_candidate_registry' | 'stage_one_exact_route' | 'none';

export interface ApeMeasuredAdmissionDecision {
  opportunityId: string;
  admitted: boolean;
  source: ApeMeasuredEvidenceSource;
  fresh: boolean;
  exactRouteMeasured: boolean;
  depthMeasured: boolean;
  canonicalNetBps: number | null;
  quoteAgeMs: number | null;
  reason:
    | 'admitted_registry_measurement'
    | 'admitted_stage_one_exact_route'
    | 'expired_evidence'
    | 'invalid_economics'
    | 'stage_one_output_floor_violation'
    | 'missing_exact_route_measurement'
    | 'registry_measurement_incomplete';
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function exactStageOneRouteMeasured(opportunity: ZeroCapitalOpportunity): boolean {
  if (opportunity.route.length === 0) return false;
  if (opportunity.flashLoanAmount <= 0n) return false;
  if (!Number.isFinite(opportunity.netProfitBps)) return false;
  if (!clearsStageOneOutputFloorBps(opportunity.netProfitBps)) return false;
  if (!Number.isFinite(opportunity.quoteLatencyMs) || opportunity.quoteLatencyMs < 0) return false;
  if (opportunity.estimatedExecutionCostInInputToken < 0n || opportunity.gasEstimate < 0n) return false;
  return opportunity.route.every(step =>
    Boolean(step.protocol)
    && Boolean(step.tokenIn)
    && Boolean(step.tokenOut)
    && step.amountIn > 0n
    && step.expectedAmountOut > 0n
    && Number.isFinite(step.fee)
    && step.fee >= 0,
  );
}

function candidateHasExactMeasuredQuote(candidate: MeasuredCandidate, now: number): boolean {
  return candidate.rawQuotes.some(quote => {
    if (!Number.isFinite(quote.observedAt) || quote.observedAt <= 0 || quote.observedAt > now) return false;
    if (quote.executable === false) return false;
    const amountIn = quote.amountIn?.trim();
    const amountOut = quote.amountOut?.trim();
    return Boolean(amountIn && amountOut);
  });
}

function registryMeasurementDecision(
  opportunity: ZeroCapitalOpportunity,
  candidate: MeasuredCandidate,
  now: number,
): ApeMeasuredAdmissionDecision | null {
  if (candidate.topology !== 'ZERO_CAPITAL_ATOMIC') return null;
  if (!candidate.chains.includes(opportunity.chain)) return null;
  if (candidate.expiresAt <= now || opportunity.expiresAt <= now) {
    return {
      opportunityId: opportunity.id,
      admitted: false,
      source: 'measured_candidate_registry',
      fresh: false,
      exactRouteMeasured: candidateHasExactMeasuredQuote(candidate, now),
      depthMeasured: candidate.depth.status === 'measured',
      canonicalNetBps: finite(candidate.canonicalBps.netBps),
      quoteAgeMs: candidate.quoteAgeMs ?? Math.max(0, now - candidate.updatedAt),
      reason: 'expired_evidence',
    };
  }

  const canonicalNetBps = finite(candidate.canonicalBps.netBps);
  const exactRouteMeasured = candidateHasExactMeasuredQuote(candidate, now);
  const depthMeasured = candidate.depth.status !== 'unavailable';
  if (canonicalNetBps !== null && !clearsStageOneOutputFloorBps(canonicalNetBps)) {
    return {
      opportunityId: opportunity.id,
      admitted: false,
      source: 'measured_candidate_registry',
      fresh: true,
      exactRouteMeasured,
      depthMeasured,
      canonicalNetBps,
      quoteAgeMs: candidate.quoteAgeMs ?? Math.max(0, now - candidate.updatedAt),
      reason: 'stage_one_output_floor_violation',
    };
  }
  const activeStatus = ['observed', 'enriched', 'deterministic_positive', 'eligible'].includes(candidate.status);
  const admitted = activeStatus && canonicalNetBps !== null && exactRouteMeasured && depthMeasured;
  return {
    opportunityId: opportunity.id,
    admitted,
    source: 'measured_candidate_registry',
    fresh: true,
    exactRouteMeasured,
    depthMeasured,
    canonicalNetBps,
    quoteAgeMs: candidate.quoteAgeMs ?? Math.max(0, now - candidate.updatedAt),
    reason: admitted ? 'admitted_registry_measurement' : 'registry_measurement_incomplete',
  };
}

/**
 * APE may optimize only fresh measured Stage-One output. Stage One supplies the exact
 * route/depth/economics evidence; APE independently rejects any candidate whose signed
 * all-in net spread is not strictly greater than -10 BPS. Missing evidence never kills
 * discovery: it prevents APE work until Stage One reacquires and republishes it.
 */
export function assessApeMeasuredAdmission(
  opportunity: ZeroCapitalOpportunity,
  now = Date.now(),
): ApeMeasuredAdmissionDecision {
  if (opportunity.expiresAt <= now) {
    return {
      opportunityId: opportunity.id,
      admitted: false,
      source: 'none',
      fresh: false,
      exactRouteMeasured: false,
      depthMeasured: false,
      canonicalNetBps: finite(opportunity.netProfitBps),
      quoteAgeMs: null,
      reason: 'expired_evidence',
    };
  }
  if (opportunity.flashLoanAmount <= 0n || !Number.isFinite(opportunity.netProfitBps)) {
    return {
      opportunityId: opportunity.id,
      admitted: false,
      source: 'none',
      fresh: true,
      exactRouteMeasured: false,
      depthMeasured: false,
      canonicalNetBps: null,
      quoteAgeMs: null,
      reason: 'invalid_economics',
    };
  }
  if (!clearsStageOneOutputFloorBps(opportunity.netProfitBps)) {
    return {
      opportunityId: opportunity.id,
      admitted: false,
      source: 'none',
      fresh: true,
      exactRouteMeasured: false,
      depthMeasured: false,
      canonicalNetBps: opportunity.netProfitBps,
      quoteAgeMs: Math.max(0, now - opportunity.timestamp),
      reason: 'stage_one_output_floor_violation',
    };
  }

  const registered = measuredCandidateRegistry.get(opportunity.id);
  if (registered) {
    const registryDecision = registryMeasurementDecision(opportunity, registered, now);
    if (registryDecision?.admitted) return registryDecision;
    // Stage-1 exact evidence remains a compatible fallback only when the registry entry
    // is incomplete, not when it violates freshness or the locked Stage-One BPS floor.
    if (registryDecision?.reason === 'expired_evidence'
      || registryDecision?.reason === 'stage_one_output_floor_violation') return registryDecision;
  }

  if (exactStageOneRouteMeasured(opportunity)) {
    return {
      opportunityId: opportunity.id,
      admitted: true,
      source: 'stage_one_exact_route',
      fresh: true,
      exactRouteMeasured: true,
      depthMeasured: true,
      canonicalNetBps: opportunity.netProfitBps,
      quoteAgeMs: Math.max(0, now - opportunity.timestamp),
      reason: 'admitted_stage_one_exact_route',
    };
  }

  return {
    opportunityId: opportunity.id,
    admitted: false,
    source: registered ? 'measured_candidate_registry' : 'none',
    fresh: true,
    exactRouteMeasured: false,
    depthMeasured: registered ? registered.depth.status !== 'unavailable' : false,
    canonicalNetBps: registered ? finite(registered.canonicalBps.netBps) : finite(opportunity.netProfitBps),
    quoteAgeMs: registered?.quoteAgeMs ?? null,
    reason: registered ? 'registry_measurement_incomplete' : 'missing_exact_route_measurement',
  };
}

export function isApeMeasuredAdmitted(opportunity: ZeroCapitalOpportunity, now = Date.now()): boolean {
  return assessApeMeasuredAdmission(opportunity, now).admitted;
}

function compareExactNetRatio(left: ZeroCapitalOpportunity, right: ZeroCapitalOpportunity): number {
  if (left.flashLoanAmount <= 0n || right.flashLoanAmount <= 0n) return 0;
  const leftRatio = left.expectedProfit * right.flashLoanAmount;
  const rightRatio = right.expectedProfit * left.flashLoanAmount;
  if (leftRatio === rightRatio) return 0;
  return leftRatio > rightRatio ? -1 : 1;
}

/**
 * Economic priority is deterministic: proven positive first, then the highest exact
 * signed net-BPS ratio (therefore the negative candidate closest to zero), then the
 * freshest/lower-latency evidence. Learning/advisory state is intentionally absent.
 */
export function compareApeEconomicPriority(left: ZeroCapitalOpportunity, right: ZeroCapitalOpportunity): number {
  const leftPositive = left.expectedProfit > 0n;
  const rightPositive = right.expectedProfit > 0n;
  if (leftPositive !== rightPositive) return leftPositive ? -1 : 1;
  const exact = compareExactNetRatio(left, right);
  if (exact !== 0) return exact;
  if (left.expiresAt !== right.expiresAt) return right.expiresAt - left.expiresAt;
  if (left.quoteLatencyMs !== right.quoteLatencyMs) return left.quoteLatencyMs - right.quoteLatencyMs;
  return left.id.localeCompare(right.id);
}

export function rankApeEconomicPriority(
  opportunities: readonly ZeroCapitalOpportunity[],
): ZeroCapitalOpportunity[] {
  return [...opportunities].sort(compareApeEconomicPriority);
}

export function summarizeApeMeasuredAdmission(
  opportunities: readonly ZeroCapitalOpportunity[],
  now = Date.now(),
): {
  admitted: number;
  deferredForMeasurement: number;
  registryMeasurements: number;
  stageOneMeasurements: number;
  reasons: Record<string, number>;
} {
  const reasons: Record<string, number> = {};
  let admitted = 0;
  let registryMeasurements = 0;
  let stageOneMeasurements = 0;
  for (const opportunity of opportunities) {
    const decision = assessApeMeasuredAdmission(opportunity, now);
    reasons[decision.reason] = (reasons[decision.reason] ?? 0) + 1;
    if (!decision.admitted) continue;
    admitted += 1;
    if (decision.source === 'measured_candidate_registry') registryMeasurements += 1;
    else if (decision.source === 'stage_one_exact_route') stageOneMeasurements += 1;
  }
  return {
    admitted,
    deferredForMeasurement: opportunities.length - admitted,
    registryMeasurements,
    stageOneMeasurements,
    reasons,
  };
}
