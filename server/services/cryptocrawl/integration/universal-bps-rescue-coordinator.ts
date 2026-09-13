import logger from '../../../logger.js';
import { ensureDynamicRpcProviderWiring } from '../runtime/dynamic-rpc-provider-wiring.js';
import { fundingRateMonitor } from '../discovery/funding-rate-monitor.js';
import { discoverMeasuredCrossChainCandidates } from '../discovery/cross-chain-opportunity-generator.js';
import { discoverMeasuredDexCandidates } from '../discovery/dex-opportunity-generator.js';
import { discoverMeasuredLiquidationCandidates } from '../discovery/liquidation-opportunity-generator.js';
import { discoverMeasuredMakerCandidates } from '../discovery/maker-opportunity-generator.js';
import { discoverMeasuredMempoolCandidates } from '../discovery/mempool-opportunity-generator.js';
import { discoverPredictionMarketParityOpportunities } from '../discovery/prediction-market-opportunity-generator.js';
import {
  measuredCandidateRegistry,
  type MeasuredCandidate,
  type MeasuredOpportunityTopology,
} from '../discovery/measured-candidate-registry.js';
import { measuredOpportunityGraph } from '../discovery/opportunity-graph.js';
import { getAtomicZeroCapitalStrategyCoverage } from '../governance/atomic-zero-capital-strategy-coverage.js';
import { refreshKalshiSystemEvidenceNow } from './kalshi-system-wiring.js';

export type UniversalBpsRescueState =
  | 'bps_hydration_pending'
  | 'bps_reduction_owned'
  | 'atomic_rescue_owned'
  | 'target_achieved'
  | 'measured_impossibility'
  | 'evidence_expired';

export interface UniversalBpsRescueOwnership {
  opportunityId: string;
  topology: MeasuredOpportunityTopology;
  state: UniversalBpsRescueState;
  netBps: number | null;
  entryFloorBps: number;
  targetBps: number;
  observedAt: number;
  updatedAt: number;
  expiresAt: number;
  atomicity: ReturnType<typeof getAtomicZeroCapitalStrategyCoverage>['atomicity'];
  executionFamily: string;
  normalStrictPositiveExecutionMayProceed: boolean;
  topologySpecificExecutionPreserved: true;
  reason: string;
}

const ownership = new Map<string, UniversalBpsRescueOwnership>();
const reacquisitionInFlight = new Map<string, Promise<void>>();
const reacquisitionCooldownUntil = new Map<string, number>();
let installed = false;
let sweepTimer: NodeJS.Timeout | null = null;
let unsubscribeCandidateUpdates: (() => void) | null = null;
let ownershipTransitions = 0;
let rescueBandHandoffs = 0;
let targetAchievements = 0;
let reacquisitionRequests = 0;
let reacquisitionFailures = 0;
let stageTwoMeasuredReacquisitions = 0;
let stageTwoMeasuredImprovements = 0;
let stageTwoBoundaryCrossings = 0;
let stageTwoMeasurementMisses = 0;

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function entryFloorBps(): number {
  return bounded(process.env.ZERO_CAPITAL_ATOMIC_SURPLUS_ENTRY_FLOOR_BPS, -10, -100, 0);
}

function targetBps(): number {
  return bounded(process.env.ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS, 10, 10, 1_000);
}

function reacquisitionCooldownMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_UNIVERSAL_RESCUE_REACQUIRE_MS || 750);
  return Number.isFinite(parsed) ? Math.max(100, Math.min(10_000, Math.trunc(parsed))) : 750;
}

function sweepIntervalMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_UNIVERSAL_RESCUE_SWEEP_MS || 1_000);
  return Number.isFinite(parsed) ? Math.max(250, Math.min(10_000, Math.trunc(parsed))) : 1_000;
}

function finiteNetBps(candidate: MeasuredCandidate): number | null {
  const value = candidate.canonicalBps.netBps;
  return value !== null && Number.isFinite(value) ? Number(value) : null;
}

function explicitMeasuredImpossibility(candidate: MeasuredCandidate): boolean {
  const evidence = [
    candidate.executionCapabilityReason,
    ...candidate.provenance,
    ...candidate.missingInformation,
  ].join('|').toLowerCase();
  return /measured_impossibility|structural_impossibility|compatible_alternatives_exhausted|all_compatible_paths_exhausted/.test(evidence);
}

function candidateSymbol(candidate: MeasuredCandidate): string | null {
  const quoteSymbol = candidate.rawQuotes.find(quote => quote.symbol?.trim())?.symbol?.trim().toUpperCase();
  if (quoteSymbol) return quoteSymbol;
  const asset = candidate.assets.find(value => value.trim())?.trim().toUpperCase();
  return asset || null;
}

function normalizeOpportunityStem(opportunityId: string): string {
  return opportunityId.replace(/:\d{12,14}$/, '');
}

function normalizedValues(values: readonly string[]): string[] {
  return values
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
    .sort();
}

function sameNormalizedValues(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = normalizedValues(left);
  const normalizedRight = normalizedValues(right);
  if (normalizedLeft.length === 0 && normalizedRight.length === 0) return true;
  if (normalizedLeft.length === 0 || normalizedRight.length === 0) return false;
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function sameLogicalMarket(source: MeasuredCandidate, fresh: MeasuredCandidate): boolean {
  if (source.topology !== fresh.topology) return false;
  if (source.opportunityId === fresh.opportunityId) return true;
  if (normalizeOpportunityStem(source.opportunityId) === normalizeOpportunityStem(fresh.opportunityId)) return true;

  const sourceSymbol = candidateSymbol(source);
  const freshSymbol = candidateSymbol(fresh);
  if (!sourceSymbol || !freshSymbol || sourceSymbol !== freshSymbol) return false;
  if (!sameNormalizedValues(source.chains, fresh.chains)) return false;
  if (!sameNormalizedValues(source.assets, fresh.assets)) return false;
  if (!sameNormalizedValues(source.venues, fresh.venues)) return false;
  return true;
}

function findFreshMeasuredSuccessor(source: MeasuredCandidate, reacquisitionStartedAt: number): MeasuredCandidate | null {
  const sourceStem = normalizeOpportunityStem(source.opportunityId);
  const candidates = measuredCandidateRegistry
    .getRecentIncludingExpired(4096)
    .filter(candidate => candidate.topology === source.topology)
    .filter(candidate => candidate.status !== 'expired' && candidate.expiresAt > reacquisitionStartedAt)
    .filter(candidate => candidate.updatedAt >= reacquisitionStartedAt && candidate.updatedAt > source.updatedAt)
    .filter(candidate => finiteNetBps(candidate) !== null)
    .filter(candidate => sameLogicalMarket(source, candidate))
    .sort((left, right) => {
      const leftExactId = left.opportunityId === source.opportunityId ? 1 : 0;
      const rightExactId = right.opportunityId === source.opportunityId ? 1 : 0;
      if (leftExactId !== rightExactId) return rightExactId - leftExactId;
      const leftExactStem = normalizeOpportunityStem(left.opportunityId) === sourceStem ? 1 : 0;
      const rightExactStem = normalizeOpportunityStem(right.opportunityId) === sourceStem ? 1 : 0;
      if (leftExactStem !== rightExactStem) return rightExactStem - leftExactStem;
      return right.updatedAt - left.updatedAt;
    });
  return candidates[0] ?? null;
}

function classify(candidate: MeasuredCandidate, now = Date.now()): UniversalBpsRescueOwnership {
  const coverage = getAtomicZeroCapitalStrategyCoverage(candidate.topology);
  const entry = entryFloorBps();
  const target = targetBps();
  const netBps = finiteNetBps(candidate);
  let state: UniversalBpsRescueState;
  let reason: string;

  if (candidate.expiresAt <= now || candidate.status === 'expired') {
    state = 'evidence_expired';
    reason = 'Fresh measured evidence expired; reacquisition must create a new authoritative candidate.';
  } else if (explicitMeasuredImpossibility(candidate)) {
    state = 'measured_impossibility';
    reason = 'A topology-specific path explicitly proved structural impossibility or exhausted compatible alternatives.';
  } else if (netBps === null) {
    state = 'bps_hydration_pending';
    reason = 'Canonical net BPS is not yet fully measured; topology-specific evidence reacquisition retains ownership.';
  } else if (netBps <= entry) {
    state = 'bps_reduction_owned';
    reason = `Canonical net ${netBps} BPS is at or below the ${entry} BPS rescue-entry boundary; BPS reduction retains ownership until it is strictly above the boundary.`;
  } else if (netBps < target) {
    state = 'atomic_rescue_owned';
    reason = `Canonical net ${netBps} BPS is strictly above the ${entry} BPS rescue-entry boundary and remains owned by Atomic rescue until ${target} BPS, expiry, or explicit measured impossibility.`;
  } else {
    state = 'target_achieved';
    reason = `Canonical measured net ${netBps} BPS meets or exceeds the ${target} BPS rescue target.`;
  }

  return {
    opportunityId: candidate.opportunityId,
    topology: candidate.topology,
    state,
    netBps,
    entryFloorBps: entry,
    targetBps: target,
    observedAt: candidate.observedAt,
    updatedAt: candidate.updatedAt,
    expiresAt: candidate.expiresAt,
    atomicity: coverage.atomicity,
    executionFamily: coverage.executionFamily,
    normalStrictPositiveExecutionMayProceed: netBps !== null && netBps > 0,
    topologySpecificExecutionPreserved: true,
    reason,
  };
}

function reacquisitionKey(candidate: MeasuredCandidate): string {
  const symbol = candidateSymbol(candidate);
  return candidate.topology === 'CEX_CEX' && symbol
    ? `${candidate.topology}:${symbol}`
    : candidate.topology;
}

async function runTopologyReacquisition(candidate: MeasuredCandidate): Promise<void> {
  switch (candidate.topology) {
    case 'CEX_CEX': {
      const symbol = candidateSymbol(candidate);
      if (symbol) await measuredOpportunityGraph.revalidateSymbols([symbol]);
      else await measuredOpportunityGraph.scanOnce();
      return;
    }
    case 'DEX_ATOMIC':
      await ensureDynamicRpcProviderWiring();
      await discoverMeasuredDexCandidates();
      return;
    case 'ZERO_CAPITAL_ATOMIC':
      // CanonicalZeroCapitalDiscovery records the candidate before running the fair
      // rescue/provider/alternative-capital stages in that same recurring chain scan.
      // Do not create a second scanner or execution authority here.
      return;
    case 'CROSS_CHAIN':
      await ensureDynamicRpcProviderWiring();
      await discoverMeasuredCrossChainCandidates();
      return;
    case 'MEMPOOL_BACKRUN':
      await ensureDynamicRpcProviderWiring();
      await discoverMeasuredMempoolCandidates();
      return;
    case 'LIQUIDATION':
      await ensureDynamicRpcProviderWiring();
      await discoverMeasuredLiquidationCandidates();
      return;
    case 'MAKER_CEX':
      await discoverMeasuredMakerCandidates();
      return;
    case 'FUNDING_ARBITRAGE':
      await fundingRateMonitor.scanOnce();
      return;
    case 'PREDICTION_EVENT': {
      const venues = new Set(candidate.venues.map(value => value.trim().toLowerCase()).filter(Boolean));
      if (venues.has('polymarket')) await discoverPredictionMarketParityOpportunities();
      if (venues.has('kalshi') || !venues.has('polymarket')) await refreshKalshiSystemEvidenceNow();
      return;
    }
  }
}

function recordStageTwoOutcome(candidate: MeasuredCandidate, reacquisitionStartedAt: number): void {
  const beforeNetBps = finiteNetBps(candidate);
  if (beforeNetBps === null) return;

  const successor = findFreshMeasuredSuccessor(candidate, reacquisitionStartedAt);
  const afterNetBps = successor ? finiteNetBps(successor) : null;
  if (!successor || afterNetBps === null) {
    stageTwoMeasurementMisses++;
    logger.debug('[UniversalBpsRescue] Stage-2 reacquisition completed without a fresh same-market canonical BPS successor', {
      component: 'UniversalBpsRescueCoordinator',
      opportunityId: candidate.opportunityId,
      topology: candidate.topology,
      beforeNetBps,
      entryFloorBps: entryFloorBps(),
      canonicalBpsMutation: false,
      syntheticEconomicsAllowed: false,
      executionAuthority: false,
    });
    return;
  }

  const realizedImprovementBps = afterNetBps - beforeNetBps;
  const crossedStageTwoBoundary = beforeNetBps <= entryFloorBps() && afterNetBps > entryFloorBps();
  stageTwoMeasuredReacquisitions++;
  if (realizedImprovementBps > 0) stageTwoMeasuredImprovements++;
  if (crossedStageTwoBoundary) stageTwoBoundaryCrossings++;

  logger.info('[UniversalBpsRescue] Measured Stage-2 BPS reduction outcome', {
    component: 'UniversalBpsRescueCoordinator',
    sourceOpportunityId: candidate.opportunityId,
    successorOpportunityId: successor.opportunityId,
    topology: candidate.topology,
    symbol: candidateSymbol(candidate),
    beforeNetBps,
    afterNetBps,
    realizedImprovementBps,
    entryFloorBps: entryFloorBps(),
    crossedStageTwoBoundary,
    successorState: classify(successor).state,
    measurementAuthority: 'fresh_same_market_canonical_reacquisition_only',
    canonicalBpsMutation: false,
    syntheticEconomicsAllowed: false,
    executionAuthority: false,
  });
}

function requestTopologyReacquisition(candidate: MeasuredCandidate, state: UniversalBpsRescueState): void {
  if (state === 'target_achieved' || state === 'measured_impossibility' || state === 'evidence_expired') return;
  if (candidate.topology === 'ZERO_CAPITAL_ATOMIC') return;
  const key = reacquisitionKey(candidate);
  if (reacquisitionInFlight.has(key) || (reacquisitionCooldownUntil.get(key) || 0) > Date.now()) return;

  reacquisitionRequests++;
  const reacquisitionStartedAt = Date.now();
  const task = runTopologyReacquisition(candidate)
    .then(() => {
      if (state === 'bps_reduction_owned') recordStageTwoOutcome(candidate, reacquisitionStartedAt);
      logger.debug('[UniversalBpsRescue] Topology-specific evidence/route reacquisition completed', {
        component: 'UniversalBpsRescueCoordinator',
        opportunityId: candidate.opportunityId,
        topology: candidate.topology,
        rescueState: state,
        canonicalBpsMutation: false,
        executionAuthority: false,
      });
    })
    .catch(error => {
      reacquisitionFailures++;
      logger.warn('[UniversalBpsRescue] Topology-specific reacquisition degraded locally; ownership retained', {
        component: 'UniversalBpsRescueCoordinator',
        opportunityId: candidate.opportunityId,
        topology: candidate.topology,
        rescueState: state,
        error: error instanceof Error ? error.message : String(error),
        ownershipReleased: false,
        unrelatedTopologiesContinue: true,
        executionAuthority: false,
      });
    })
    .finally(() => {
      reacquisitionInFlight.delete(key);
      reacquisitionCooldownUntil.set(key, Date.now() + reacquisitionCooldownMs());
    });
  reacquisitionInFlight.set(key, task);
}

function acceptCandidate(candidate: MeasuredCandidate): void {
  const next = classify(candidate);
  const previous = ownership.get(candidate.opportunityId);
  const changed = !previous
    || previous.state !== next.state
    || previous.netBps !== next.netBps
    || previous.expiresAt !== next.expiresAt;

  ownership.set(candidate.opportunityId, next);
  if (changed) {
    ownershipTransitions++;
    if (previous?.state === 'bps_reduction_owned' && next.state === 'atomic_rescue_owned') rescueBandHandoffs++;
    if (previous?.state !== 'target_achieved' && next.state === 'target_achieved') targetAchievements++;
    logger.info('[UniversalBpsRescue] Canonical rescue ownership updated', {
      component: 'UniversalBpsRescueCoordinator',
      opportunityId: next.opportunityId,
      topology: next.topology,
      previousState: previous?.state ?? null,
      state: next.state,
      netBps: next.netBps,
      entryFloorBps: next.entryFloorBps,
      targetBps: next.targetBps,
      atomicity: next.atomicity,
      executionFamily: next.executionFamily,
      normalStrictPositiveExecutionMayProceed: next.normalStrictPositiveExecutionMayProceed,
      topologySpecificExecutionPreserved: true,
      canonicalBpsMutation: false,
      executionAuthority: false,
    });
  }

  requestTopologyReacquisition(candidate, next.state);
}

function sweep(): void {
  const now = Date.now();
  for (const candidate of measuredCandidateRegistry.getRecent(4096)) acceptCandidate(candidate);
  for (const [id, row] of ownership) {
    if (row.expiresAt <= now && row.state !== 'evidence_expired') {
      ownership.set(id, { ...row, state: 'evidence_expired', reason: 'Fresh measured evidence expired; reacquisition must create a new authoritative candidate.' });
      ownershipTransitions++;
    }
    if (row.expiresAt < now - 10 * 60_000) ownership.delete(id);
  }
}

export function getUniversalBpsRescueSnapshot() {
  const rows = [...ownership.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  const states = rows.reduce<Record<UniversalBpsRescueState, number>>((counts, row) => {
    counts[row.state]++;
    return counts;
  }, {
    bps_hydration_pending: 0,
    bps_reduction_owned: 0,
    atomic_rescue_owned: 0,
    target_achieved: 0,
    measured_impossibility: 0,
    evidence_expired: 0,
  });
  const byTopology = Object.fromEntries(([
    'CEX_CEX', 'DEX_ATOMIC', 'ZERO_CAPITAL_ATOMIC', 'CROSS_CHAIN', 'MEMPOOL_BACKRUN',
    'LIQUIDATION', 'MAKER_CEX', 'FUNDING_ARBITRAGE', 'PREDICTION_EVENT',
  ] as MeasuredOpportunityTopology[]).map(topology => [
    topology,
    {
      owned: rows.filter(row => row.topology === topology && !['target_achieved', 'measured_impossibility', 'evidence_expired'].includes(row.state)).length,
      hydrationPending: rows.filter(row => row.topology === topology && row.state === 'bps_hydration_pending').length,
      bpsReductionOwned: rows.filter(row => row.topology === topology && row.state === 'bps_reduction_owned').length,
      atomicRescueOwned: rows.filter(row => row.topology === topology && row.state === 'atomic_rescue_owned').length,
      targetAchieved: rows.filter(row => row.topology === topology && row.state === 'target_achieved').length,
    },
  ]));
  return {
    observedAt: Date.now(),
    entryFloorBps: entryFloorBps(),
    targetBps: targetBps(),
    totalTracked: rows.length,
    states,
    byTopology,
    ownershipTransitions,
    rescueBandHandoffs,
    targetAchievements,
    reacquisitionRequests,
    reacquisitionFailures,
    stageTwoMeasuredReacquisitions,
    stageTwoMeasuredImprovements,
    stageTwoBoundaryCrossings,
    stageTwoMeasurementMisses,
    reacquisitionInFlight: [...reacquisitionInFlight.keys()],
    lifecycle: 'bps_hydration_pending -> bps_reduction_owned (<= entry floor) -> atomic_rescue_owned (> entry floor) -> target_achieved | measured_impossibility | evidence_expired' as const,
    canonicalEconomicsAuthority: 'measured_candidate_registry.canonicalBps' as const,
    bpsReductionAuthority: 'existing_bps_reduction_super_engine' as const,
    stageTwoMeasurementAuthority: 'fresh_same_market_canonical_reacquisition_only' as const,
    universalAtomicAuthority: 'rescue_ownership_and_topology_specific_reacquisition_only' as const,
    strictPositiveExecutionFloorUnchanged: true as const,
    stageTwoRequiresStrictlyAboveEntryFloor: true as const,
    topologySpecificExecutionPreserved: true as const,
    syntheticEconomicsAllowed: false as const,
    canonicalBpsMutation: false as const,
    executionAuthority: false as const,
  };
}

export function ensureUniversalBpsRescueCoordinator(): void {
  if (installed || process.env.CRYPTOCRAWL_UNIVERSAL_BPS_RESCUE_ENABLED === 'false') return;
  installed = true;
  for (const candidate of measuredCandidateRegistry.getRecent(4096)) acceptCandidate(candidate);
  unsubscribeCandidateUpdates = measuredCandidateRegistry.onUpdate(acceptCandidate);
  if (process.env.NO_INTERVALS !== 'true') {
    sweepTimer = setInterval(sweep, sweepIntervalMs());
    sweepTimer.unref?.();
  }
  logger.info('[UniversalBpsRescue] Universal rescue ownership coordinator installed', {
    component: 'UniversalBpsRescueCoordinator',
    topologies: [
      'CEX_CEX', 'DEX_ATOMIC', 'ZERO_CAPITAL_ATOMIC', 'CROSS_CHAIN', 'MEMPOOL_BACKRUN',
      'LIQUIDATION', 'MAKER_CEX', 'FUNDING_ARBITRAGE', 'PREDICTION_EVENT',
    ],
    entryFloorBps: entryFloorBps(),
    targetBps: targetBps(),
    canonicalEconomicsAuthority: 'measured_candidate_registry.canonicalBps',
    bpsReductionAuthority: 'existing_bps_reduction_super_engine',
    stageTwoMeasurementAuthority: 'fresh_same_market_canonical_reacquisition_only',
    zeroCapitalAtomicPath: 'existing_canonical_zero_capital_discovery_same_cycle_rescue',
    nonAtomicTopologiesRemainTopologySpecific: true,
    strictPositiveExecutionFloorUnchanged: true,
    stageTwoRequiresStrictlyAboveEntryFloor: true,
    missingExecutionResourceDoesNotReleaseRescueOwnership: true,
    syntheticEconomicsAllowed: false,
    executionAuthority: false,
  });
}

export function stopUniversalBpsRescueCoordinator(): void {
  unsubscribeCandidateUpdates?.();
  unsubscribeCandidateUpdates = null;
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  installed = false;
}
