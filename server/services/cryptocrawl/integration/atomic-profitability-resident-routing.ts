import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import { apeDirectionKey, apeDirectionalMarketKey } from './ape-directional-market.js';

export type ApeResidentRole = 'active' | 'hedge' | 'reserve';

export interface ApeResidentPlacement {
  opportunityId: string;
  competitionKey: string;
  directionKey: string;
  contextKey: string;
  cohort: number;
  role: ApeResidentRole;
  slot: 0 | 1 | 2 | 3 | 4;
  exactNetBps: number;
  residentProviderProfile: string;
  residentBuilderProfile: string;
  residentHintObservedAt: number | null;
  observedAt: number;
  expiresAt: number;
}

interface ApeResidentContextHint {
  key: string;
  provider: string;
  builder: string;
  providerAdjustedNetBps: number | null;
  observedAt: number;
  expiresAt: number;
}

const placements = new Map<string, ApeResidentPlacement>();
const residentContextHints = new Map<string, ApeResidentContextHint>();
let primes = 0;
let candidatesPrimed = 0;
let activePlacements = 0;
let hedgePlacements = 0;
let reservePlacements = 0;
let residentHintUpdates = 0;
let residentHintHits = 0;
let residentHintMisses = 0;

const BPS_PRECISION_SCALE = 1_000_000n;
const ANY_COMPATIBLE = 'any_compatible';

function exactNetBps(opportunity: ZeroCapitalOpportunity): number {
  if (opportunity.flashLoanAmount <= 0n) return Number.NEGATIVE_INFINITY;
  return Number(
    (opportunity.expectedProfit * 10_000n * BPS_PRECISION_SCALE) / opportunity.flashLoanAmount,
  ) / Number(BPS_PRECISION_SCALE);
}

/**
 * Exact ratio ordering for already-arrived evidence. Cross multiplication keeps
 * every base-unit distinction and avoids turning sub-micro-BPS differences into a
 * floating-point tie. This performs no measurement and allocates no economics.
 */
function compareExactNetBps(left: ZeroCapitalOpportunity, right: ZeroCapitalOpportunity): number {
  if (left.flashLoanAmount <= 0n || right.flashLoanAmount <= 0n) return 0;
  const leftRatio = left.expectedProfit * right.flashLoanAmount;
  const rightRatio = right.expectedProfit * left.flashLoanAmount;
  if (leftRatio === rightRatio) return 0;
  return leftRatio > rightRatio ? -1 : 1;
}

function venuePath(opportunity: ZeroCapitalOpportunity): string {
  return opportunity.route.map(step => step.protocol).join('>') || 'unknown';
}

function venueProfile(opportunity: ZeroCapitalOpportunity): string {
  return [...new Set(opportunity.route.map(step => step.protocol))].join('>') || 'unknown';
}

/**
 * Same-market identity deliberately ignores venue/provider/builder AND direction.
 * Direction remains attached metadata on each candidate, allowing both sides of one
 * discovered market to compete in the same resident cohort without collapsing their
 * independently measured economics.
 */
function competitionKey(opportunity: ZeroCapitalOpportunity): string {
  return apeDirectionalMarketKey(opportunity);
}

function hintKeyForOpportunity(opportunity: ZeroCapitalOpportunity): string {
  return [opportunity.chain, opportunity.inputAssetSymbol, venueProfile(opportunity)].join('|');
}

function hintKeyForCandidate(candidate: MeasuredCandidate): string | null {
  const chain = candidate.chains[0]?.trim();
  const asset = candidate.assets[0]?.trim();
  const venues = candidate.venues.map(value => value.trim()).filter(Boolean).join('>');
  if (!chain || !asset || !venues) return null;
  return [chain, asset, venues].join('|');
}

function providerProfile(candidate: MeasuredCandidate): string | null {
  const providers = candidate.provenance
    .filter(value => value.startsWith('flash_loan_provider:'))
    .map(value => value.slice('flash_loan_provider:'.length).trim())
    .filter(Boolean);
  if (providers.includes('aave_balancer_dual')) return 'aave_balancer_dual';
  return providers.length > 0 ? providers[providers.length - 1] : null;
}

function builderProfile(candidate: MeasuredCandidate): string {
  if (candidate.provenance.some(value =>
    value === 'builder_payment_transport:titan_or_quasar'
    || value === 'builder_native_prefund:titan_or_quasar_sponsored_bundle'
    || value === 'builder_sponsored_exact_repayment_plan'
  )) return 'titan_or_quasar';
  return ANY_COMPATIBLE;
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Canonical provider/builder proof occurs downstream of APE. Its already-measured
 * outcome is mirrored here only as resident advisory context for the next fresh
 * opportunity. The candidate registry dispatches this listener off the caller's
 * publication stack, so APE itself never performs a provider/builder lookup or I/O.
 */
function observeResidentContext(candidate: MeasuredCandidate): void {
  if (candidate.topology !== 'ZERO_CAPITAL_ATOMIC' || candidate.expiresAt <= Date.now()) return;
  const provider = providerProfile(candidate);
  if (!provider) return;
  const key = hintKeyForCandidate(candidate);
  if (!key) return;
  const next: ApeResidentContextHint = {
    key,
    provider,
    builder: builderProfile(candidate),
    providerAdjustedNetBps: finite(candidate.canonicalBps.netBps),
    observedAt: candidate.updatedAt,
    expiresAt: candidate.expiresAt,
  };
  const previous = residentContextHints.get(key);
  if (!previous || next.observedAt >= previous.observedAt) {
    residentContextHints.set(key, next);
    residentHintUpdates += 1;
  }
}

measuredCandidateRegistry.onUpdate(observeResidentContext);

function residentHint(opportunity: ZeroCapitalOpportunity, now = Date.now()): ApeResidentContextHint | null {
  const key = hintKeyForOpportunity(opportunity);
  const hint = residentContextHints.get(key);
  if (!hint || hint.expiresAt <= now || hint.observedAt > now) {
    if (hint?.expiresAt && hint.expiresAt <= now) residentContextHints.delete(key);
    residentHintMisses += 1;
    return null;
  }
  residentHintHits += 1;
  return hint;
}

function contextKey(opportunity: ZeroCapitalOpportunity, hint: ApeResidentContextHint | null): string {
  return [
    competitionKey(opportunity),
    `direction:${apeDirectionKey(opportunity)}`,
    `size:${opportunity.flashLoanAmount.toString()}`,
    `venue:${venuePath(opportunity)}`,
    `provider:${hint?.provider ?? ANY_COMPATIBLE}`,
    `builder:${hint?.builder ?? ANY_COMPATIBLE}`,
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
  for (const [key, hint] of residentContextHints) {
    if (hint.expiresAt <= now) residentContextHints.delete(key);
  }
}

/**
 * Prepares the contextual 2-active + 1-hedge + 2-reserve layout before APE starts.
 * It stores metadata only and retains the caller's opportunity objects by reference;
 * no route/economics object is copied, serialized, persisted, or looked up remotely.
 * Same-market variants are grouped by a direction-neutral canonical token path. Each
 * candidate keeps its direction key and measured economics, while venue/provider/
 * builder remain alternative realization dimensions rather than opportunity identities.
 * Provider/builder context comes only from an already-resident advisory hint. Missing
 * context stays wildcard-compatible instead of causing measurement or a wait.
 * Larger candidate sets form additional five-wide cohorts so Stage-1 coverage is
 * never reduced by the lane width.
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
    const hints = new Map<string, ApeResidentContextHint | null>();
    for (const opportunity of group) hints.set(opportunity.id, residentHint(opportunity));

    group.sort((left, right) => {
      const exactOrder = compareExactNetBps(left, right);
      if (exactOrder !== 0) return exactOrder;

      const leftBps = exactNetBps(left);
      const rightBps = exactNetBps(right);
      if (rightBps !== leftBps) return rightBps - leftBps;

      // Historical provider/builder intelligence is advisory only and can break an
      // exact-BPS tie; it can never overrule current deterministic economics.
      const leftHintBps = hints.get(left.id)?.providerAdjustedNetBps;
      const rightHintBps = hints.get(right.id)?.providerAdjustedNetBps;
      if (leftHintBps !== null && leftHintBps !== undefined && rightHintBps !== null && rightHintBps !== undefined && rightHintBps !== leftHintBps) {
        return rightHintBps - leftHintBps;
      }
      if (right.expectedProfit !== left.expectedProfit) return right.expectedProfit > left.expectedProfit ? 1 : -1;
      if (right.confidence !== left.confidence) return right.confidence - left.confidence;
      if (left.quoteLatencyMs !== right.quoteLatencyMs) return left.quoteLatencyMs - right.quoteLatencyMs;
      return left.id.localeCompare(right.id);
    });

    for (let index = 0; index < group.length; index += 1) {
      const opportunity = group[index];
      const hint = hints.get(opportunity.id) ?? null;
      const slot = (index % 5) as 0 | 1 | 2 | 3 | 4;
      const role = roleForSlot(slot);
      placements.set(opportunity.id, {
        opportunityId: opportunity.id,
        competitionKey: key,
        directionKey: apeDirectionKey(opportunity),
        contextKey: contextKey(opportunity, hint),
        cohort: Math.floor(index / 5),
        role,
        slot,
        exactNetBps: exactNetBps(opportunity),
        residentProviderProfile: hint?.provider ?? ANY_COMPATIBLE,
        residentBuilderProfile: hint?.builder ?? ANY_COMPATIBLE,
        residentHintObservedAt: hint?.observedAt ?? null,
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
 * No candidate is dropped. Active/hedge/reserve ordering governs comparison order,
 * but APE never wakes a reserve or starts work for any lane. A reserve result that
 * already arrived may still win when it has better exact BPS because comparing an
 * existing in-memory value introduces no wait and honors winner-first semantics.
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
  const residentMarkets = new Set([...placements.values()].map(placement => placement.competitionKey));
  const residentDirections = new Set([...placements.values()].map(placement => `${placement.competitionKey}|${placement.directionKey}`));
  return {
    observedAt: Date.now(),
    residentEntries: placements.size,
    residentMarkets: residentMarkets.size,
    residentDirections: residentDirections.size,
    residentContextHints: residentContextHints.size,
    primes,
    candidatesPrimed,
    activePlacements,
    hedgePlacements,
    reservePlacements,
    residentHintUpdates,
    residentHintHits,
    residentHintMisses,
    activePerCohort: 2 as const,
    maximumHedgePerCohort: 1 as const,
    dormantReservesPerCohort: 2 as const,
    competitionScope: 'same_chain_direction_neutral_canonical_token_path' as const,
    sameMarketDirectionsCompeteInMemory: true as const,
    directionEconomicsRemainIndependent: true as const,
    exactBpsComparison: 'base_unit_cross_ratio' as const,
    providerDimension: 'resident_measured_or_any_compatible' as const,
    builderDimension: 'resident_measured_or_any_compatible' as const,
    residentHintsAdvisoryOnly: true as const,
    exactCurrentBpsRemainsPrimary: true as const,
    reservesWakeLiveWork: false as const,
    alreadyArrivedReserveMayWinWithoutWaiting: true as const,
    additionalCandidatesFormAdditionalCohorts: true as const,
    stageOneObjectsCopied: false as const,
    externalIo: false as const,
    persistence: false as const,
    executionAuthority: false as const,
    economicAuthority: false as const,
  };
}
