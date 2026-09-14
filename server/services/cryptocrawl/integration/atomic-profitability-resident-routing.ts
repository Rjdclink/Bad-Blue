import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';

export type ApeResidentRole = 'active' | 'hedge' | 'reserve';

export interface ApeResidentPlacement {
  opportunityId: string;
  competitionKey: string;
  contextKey: string;
  cohort: number;
  role: ApeResidentRole;
  slot: 0 | 1 | 2 | 3 | 4;
  exactNetBps: number;
  observedAt: number;
  expiresAt: number;
}

const placements = new Map<string, ApeResidentPlacement>();
let primes = 0;
let candidatesPrimed = 0;
let activePlacements = 0;
let hedgePlacements = 0;
let reservePlacements = 0;

const BPS_PRECISION_SCALE = 1_000_000n;

function exactNetBps(opportunity: ZeroCapitalOpportunity): number {
  if (opportunity.flashLoanAmount <= 0n) return Number.NEGATIVE_INFINITY;
  return Number(
    (opportunity.expectedProfit * 10_000n * BPS_PRECISION_SCALE) / opportunity.flashLoanAmount,
  ) / Number(BPS_PRECISION_SCALE);
}

function venuePath(opportunity: ZeroCapitalOpportunity): string {
  return opportunity.route.map(step => step.protocol).join('>') || 'unknown';
}

function competitionKey(opportunity: ZeroCapitalOpportunity): string {
  return [
    opportunity.chain,
    opportunity.inputToken.toLowerCase(),
    opportunity.outputToken.toLowerCase(),
    `${opportunity.inputToken.toLowerCase()}>${opportunity.outputToken.toLowerCase()}`,
  ].join('|');
}

function contextKey(opportunity: ZeroCapitalOpportunity): string {
  return [
    competitionKey(opportunity),
    `size:${opportunity.flashLoanAmount.toString()}`,
    `venue:${venuePath(opportunity)}`,
    'provider:canonical_pending',
    'builder:canonical_pending',
  ].join('|');
}

function roleForSlot(slot: number): ApeResidentRole {
  if (slot <= 1) return 'active';
  if (slot === 2) return 'hedge';
  return 'reserve';
}

function prune(now = Date.now()): void {
  for (const [id, placement] of placements) {
    if (placement.expiresAt <= now) placements.delete(id);
  }
}

/**
 * Prepares the contextual 2-active + 1-hedge + 2-reserve layout before APE starts.
 * It stores metadata only and retains the caller's opportunity objects by reference;
 * no route/economics object is copied, serialized, persisted, or looked up remotely.
 * Larger candidate sets are split into additional five-wide cohorts so Stage-1
 * coverage is never reduced by the lane width.
 */
export function primeApeResidentRouting(opportunities: readonly ZeroCapitalOpportunity[]): void {
  primes += 1;
  candidatesPrimed += opportunities.length;
  prune();

  const groups = new Map<string, ZeroCapitalOpportunity[]>();
  for (const opportunity of opportunities) {
    const key = competitionKey(opportunity);
    const group = groups.get(key);
    if (group) group.push(opportunity);
    else groups.set(key, [opportunity]);
  }

  for (const [key, group] of groups) {
    group.sort((left, right) => {
      const leftBps = exactNetBps(left);
      const rightBps = exactNetBps(right);
      if (rightBps !== leftBps) return rightBps - leftBps;
      if (right.expectedProfit !== left.expectedProfit) return right.expectedProfit > left.expectedProfit ? 1 : -1;
      if (right.confidence !== left.confidence) return right.confidence - left.confidence;
      if (left.quoteLatencyMs !== right.quoteLatencyMs) return left.quoteLatencyMs - right.quoteLatencyMs;
      return left.id.localeCompare(right.id);
    });

    for (let index = 0; index < group.length; index += 1) {
      const opportunity = group[index];
      const slot = (index % 5) as 0 | 1 | 2 | 3 | 4;
      const role = roleForSlot(slot);
      placements.set(opportunity.id, {
        opportunityId: opportunity.id,
        competitionKey: key,
        contextKey: contextKey(opportunity),
        cohort: Math.floor(index / 5),
        role,
        slot,
        exactNetBps: exactNetBps(opportunity),
        observedAt: opportunity.timestamp,
        expiresAt: opportunity.expiresAt,
      });
      if (role === 'active') activePlacements += 1;
      else if (role === 'hedge') hedgePlacements += 1;
      else reservePlacements += 1;
    }
  }
}

export function hasApeResidentPlacement(opportunityId: string): boolean {
  const placement = placements.get(opportunityId);
  return Boolean(placement && placement.expiresAt > Date.now());
}

export function getApeResidentPlacement(opportunityId: string): ApeResidentPlacement | null {
  const placement = placements.get(opportunityId);
  if (!placement || placement.expiresAt <= Date.now()) return null;
  return placement;
}

/**
 * Returns a new array only; every element is the exact Stage-1 object reference.
 * No candidate is dropped. The ordering is contextual BPS-first, then 2+1+2 lane
 * order within each five-wide cohort.
 */
export function orderApeResidentOpportunities(
  opportunities: readonly ZeroCapitalOpportunity[],
): ZeroCapitalOpportunity[] {
  return [...opportunities].sort((left, right) => {
    const leftPlacement = placements.get(left.id);
    const rightPlacement = placements.get(right.id);
    if (!leftPlacement && !rightPlacement) return 0;
    if (!leftPlacement) return 1;
    if (!rightPlacement) return -1;
    if (leftPlacement.cohort !== rightPlacement.cohort) return leftPlacement.cohort - rightPlacement.cohort;
    if (leftPlacement.slot !== rightPlacement.slot) return leftPlacement.slot - rightPlacement.slot;
    if (rightPlacement.exactNetBps !== leftPlacement.exactNetBps) {
      return rightPlacement.exactNetBps - leftPlacement.exactNetBps;
    }
    return left.id.localeCompare(right.id);
  });
}

export function getApeResidentRoutingSnapshot() {
  prune();
  return {
    observedAt: Date.now(),
    residentEntries: placements.size,
    primes,
    candidatesPrimed,
    activePlacements,
    hedgePlacements,
    reservePlacements,
    activePerCohort: 2 as const,
    maximumHedgePerCohort: 1 as const,
    dormantReservesPerCohort: 2 as const,
    additionalCandidatesFormAdditionalCohorts: true as const,
    stageOneObjectsCopied: false as const,
    externalIo: false as const,
    persistence: false as const,
    executionAuthority: false as const,
    economicAuthority: false as const,
  };
}
