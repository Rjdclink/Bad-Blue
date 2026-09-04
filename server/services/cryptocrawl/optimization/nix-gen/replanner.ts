import { createHash } from 'node:crypto';
import type { NixGenPreparedBid } from './canonical-bid-adapters.js';
import { coordinateNixGenAllocation, type NixGenAllocationSnapshot } from './coordinator.js';
import { deriveNixGenScarcitySnapshot, type NixGenScarcitySnapshot } from './scarcity-pricing.js';

const DEFAULT_MAX_PLAN_AGE_MS = 250;
const MAX_PLAN_AGE_MS = 5_000;
const DEFAULT_EXPIRY_SAFETY_MARGIN_MS = 50;

export type NixGenReplanReason =
  | 'initial'
  | 'forced'
  | 'input_changed'
  | 'plan_age'
  | 'temporal_boundary'
  | 'unchanged';

export interface NixGenReplanSnapshot {
  evaluatedAt: number;
  planGeneratedAt: number;
  planMaxAgeAt: number;
  temporalBoundaryAt: number;
  validUntil: number;
  fingerprint: string;
  reason: NixGenReplanReason;
  reusedPrevious: boolean;
  authority: 'nix_gen_advisory_replanner';
  executionAuthority: false;
  resourceAuthority: false;
  filtersCanonicalCandidates: false;
  allocation: NixGenAllocationSnapshot;
  scarcity: NixGenScarcitySnapshot;
}

export interface NixGenReplanInput {
  prepared: readonly NixGenPreparedBid[];
  now: number;
  dispatchCapacity: number;
  exactBidLimit?: number;
  maxPlanAgeMs?: number;
  expirySafetyMarginMs?: number;
  force?: boolean;
}

function boundedInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed))) : fallback;
}

function stablePreparedTruth(prepared: readonly NixGenPreparedBid[]) {
  return [...prepared]
    .sort((left, right) => left.bid.bidId.localeCompare(right.bid.bidId))
    .map(item => ({
      bidId: item.bid.bidId,
      opportunityId: item.bid.opportunityId,
      strategyId: item.bid.strategyId,
      strategyClass: item.bid.strategyClass,
      observedAt: item.bid.observedAt,
      expiresAt: item.bid.expiresAt,
      economics: {
        netProfitUsd: item.bid.economics.netProfitUsd,
        notionalUsd: item.bid.economics.notionalUsd,
        netBps: item.bid.economics.netBps,
        measuredAt: item.bid.economics.measuredAt,
        authority: item.bid.economics.authority,
      },
      execution: {
        eligible: item.bid.execution.eligible,
        executable: item.bid.execution.executable,
        settlementCapable: item.bid.execution.settlementCapable,
        authoritativePath: item.bid.execution.authoritativePath,
      },
      advisory: {
        probabilityOfProfitableExecution: item.bid.advisory?.probabilityOfProfitableExecution ?? null,
        terminalCalibrationFactor: item.bid.advisory?.terminalCalibrationFactor ?? null,
        decayUrgencyFactor: item.bid.advisory?.decayUrgencyFactor ?? null,
        rankScore: item.bid.advisory?.rankScore ?? null,
      },
      resources: [...item.bid.resources]
        .map(resource => ({ resourceKey: resource.resourceKey, units: resource.units }))
        .sort((left, right) => left.resourceKey.localeCompare(right.resourceKey) || left.units - right.units),
      mutualExclusionGroup: item.bid.mutualExclusionGroup ?? null,
      budgets: [...item.budgets]
        .map(budget => ({ resourceKey: budget.resourceKey, capacity: budget.capacity }))
        .sort((left, right) => left.resourceKey.localeCompare(right.resourceKey) || left.capacity - right.capacity),
    }));
}

export function fingerprintNixGenPlanningInput(input: NixGenReplanInput): string {
  const maxPlanAgeMs = boundedInt(input.maxPlanAgeMs, DEFAULT_MAX_PLAN_AGE_MS, 25, MAX_PLAN_AGE_MS);
  const expirySafetyMarginMs = boundedInt(input.expirySafetyMarginMs, DEFAULT_EXPIRY_SAFETY_MARGIN_MS, 0, maxPlanAgeMs);
  const payload = JSON.stringify({
    dispatchCapacity: Number.isFinite(input.dispatchCapacity) ? Math.max(1, Math.floor(input.dispatchCapacity)) : 1,
    exactBidLimit: input.exactBidLimit ?? null,
    maxPlanAgeMs,
    expirySafetyMarginMs,
    prepared: stablePreparedTruth(input.prepared),
  });
  return createHash('sha256').update(payload).digest('hex');
}

function earliestTemporalBoundary(
  prepared: readonly NixGenPreparedBid[],
  now: number,
  expirySafetyMarginMs: number,
): number {
  let boundary = Number.POSITIVE_INFINITY;
  for (const item of prepared) {
    const bid = item.bid;
    if (Number.isFinite(bid.expiresAt) && bid.expiresAt > now) {
      boundary = Math.min(boundary, Math.max(now, bid.expiresAt - expirySafetyMarginMs));
    }
    // A future-dated observation/economics sample is invalid at the current
    // evaluation instant. Replan exactly when that temporal truth can change.
    if (Number.isFinite(bid.observedAt) && bid.observedAt > now) boundary = Math.min(boundary, bid.observedAt);
    if (Number.isFinite(bid.economics.measuredAt) && bid.economics.measuredAt > now) {
      boundary = Math.min(boundary, bid.economics.measuredAt);
    }
  }
  return boundary;
}

function reasonForFreshPlan(
  input: NixGenReplanInput,
  fingerprint: string,
  previous?: NixGenReplanSnapshot,
): NixGenReplanReason {
  if (!previous) return 'initial';
  if (input.force) return 'forced';
  if (previous.fingerprint !== fingerprint) return 'input_changed';
  if (input.now >= previous.temporalBoundaryAt) return 'temporal_boundary';
  if (input.now >= previous.planMaxAgeAt) return 'plan_age';
  return 'unchanged';
}

export function replanNixGenAllocation(
  input: NixGenReplanInput,
  previous?: NixGenReplanSnapshot,
): NixGenReplanSnapshot {
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const normalizedInput = { ...input, now };
  const fingerprint = fingerprintNixGenPlanningInput(normalizedInput);
  const reason = reasonForFreshPlan(normalizedInput, fingerprint, previous);

  if (previous && reason === 'unchanged' && now < previous.validUntil) {
    return {
      ...previous,
      evaluatedAt: now,
      reason: 'unchanged',
      reusedPrevious: true,
    };
  }

  const maxPlanAgeMs = boundedInt(input.maxPlanAgeMs, DEFAULT_MAX_PLAN_AGE_MS, 25, MAX_PLAN_AGE_MS);
  const expirySafetyMarginMs = boundedInt(input.expirySafetyMarginMs, DEFAULT_EXPIRY_SAFETY_MARGIN_MS, 0, maxPlanAgeMs);
  const planMaxAgeAt = now + maxPlanAgeMs;
  const rawTemporalBoundaryAt = earliestTemporalBoundary(input.prepared, now, expirySafetyMarginMs);
  // Keep snapshot telemetry JSON-safe while ensuring plan age wins when there
  // is no earlier opportunity/evidence temporal boundary.
  const temporalBoundaryAt = Number.isFinite(rawTemporalBoundaryAt)
    ? rawTemporalBoundaryAt
    : planMaxAgeAt + 1;
  const validUntil = Math.max(now, Math.min(planMaxAgeAt, temporalBoundaryAt));
  const allocation = coordinateNixGenAllocation(input.prepared, {
    now,
    dispatchCapacity: input.dispatchCapacity,
    exactBidLimit: input.exactBidLimit,
  });
  const scarcity = deriveNixGenScarcitySnapshot(allocation.result);

  return {
    evaluatedAt: now,
    planGeneratedAt: now,
    planMaxAgeAt,
    temporalBoundaryAt,
    validUntil,
    fingerprint,
    reason,
    reusedPrevious: false,
    authority: 'nix_gen_advisory_replanner',
    executionAuthority: false,
    resourceAuthority: false,
    filtersCanonicalCandidates: false,
    allocation,
    scarcity,
  };
}
