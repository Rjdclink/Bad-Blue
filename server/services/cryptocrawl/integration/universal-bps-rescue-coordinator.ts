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

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function entryFloorBps(): number {
  return bounded(process.env.ZERO_CAPITAL_ATOMIC_SURPLUS_ENTRY_FLOOR_BPS, -10, -100, 0);
}

function targetBps(): number {
  return bounded(process.env.ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS, 10, 0.000001, 1_000);
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
  } else if (netBps < entry) {
    state = 'bps_reduction_owned';
    reason = `Canonical net ${netBps} BPS is below the ${entry} BPS rescue-entry boundary; BPS reduction retains ownership.`;
  } else if (netBps < target) {
    state = 'atomic_rescue_owned';
    reason = `Canonical net ${netBps} BPS is inside the rescue search range and remains owned until ${target} BPS, expiry, or explicit measured impossibility.`;
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

function requestTopologyReacquisition(candidate: MeasuredCandidate, state: UniversalBpsRescueState): void {
  // Expiry is a reacquisition trigger, not a terminal state. The stale candidate
  // itself never regains authority; the topology scanner must publish a new fresh
  // candidate. Structural impossibility and target achievement remain terminal.
  if (state === 'target_achieved' || state === 'measured_impossibility') return;
  if (candidate.topology === 'ZERO_CAPITAL_ATOMIC') return;
  const key = reacquisitionKey(candidate);
  if (reacquisitionInFlight.has(key) || (reacquisitionCooldownUntil.get(key) || 0) > Date.now()) return;

  reacquisitionRequests++;
  const task = runTopologyReacquisition(candidate)
    .then(() => {
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
    reacquisitionInFlight: [...reacquisitionInFlight.keys()],
    lifecycle: 'bps_hydration_pending -> bps_reduction_owned -> atomic_rescue_owned -> target_achieved | measured_impossibility | evidence_expired' as const,
    canonicalEconomicsAuthority: 'measured_candidate_registry.canonicalBps' as const,
    bpsReductionAuthority: 'existing_bps_reduction_super_engine' as const,
    universalAtomicAuthority: 'rescue_ownership_and_topology_specific_reacquisition_only' as const,
    strictPositiveExecutionFloorUnchanged: true as const,
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
    zeroCapitalAtomicPath: 'existing_canonical_zero_capital_discovery_same_cycle_rescue',
    nonAtomicTopologiesRemainTopologySpecific: true,
    strictPositiveExecutionFloorUnchanged: true,
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