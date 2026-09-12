import logger from '../../../logger.js';
import { ensureStageOneDexMempoolRepair, getStageOneDexMempoolRepairSnapshot } from '../discovery/stage-one-dex-mempool-repair.js';
import { ensureStageOneMeasurementRecovery, getStageOneMeasurementRecoverySnapshot } from '../discovery/stage-one-measurement-recovery.js';
import {
  measuredCandidateRegistry,
  type MeasuredCandidate,
  type MeasuredOpportunityTopology,
} from '../discovery/measured-candidate-registry.js';
import { getCexFourModeSnapshot } from './cex-four-mode-observability-wiring.js';

const TOPOLOGIES: readonly MeasuredOpportunityTopology[] = [
  'CEX_CEX',
  'DEX_ATOMIC',
  'ZERO_CAPITAL_ATOMIC',
  'CROSS_CHAIN',
  'MEMPOOL_BACKRUN',
  'LIQUIDATION',
  'MAKER_CEX',
  'FUNDING_ARBITRAGE',
  'PREDICTION_EVENT',
];

// These seven families were production-proven before the final DEX/Mempool
// repair. Their measured Stage-1 visibility is a regression invariant: once a
// real measured spread has been observed, the last-known measurement remains
// visible even after freshness expiry. Freshness is reported separately and
// locked history can never grant execution or economic authority.
const LOCKED_BASELINE_TOPOLOGIES: readonly MeasuredOpportunityTopology[] = [
  'CEX_CEX',
  'MAKER_CEX',
  'ZERO_CAPITAL_ATOMIC',
  'CROSS_CHAIN',
  'FUNDING_ARBITRAGE',
  'LIQUIDATION',
  'PREDICTION_EVENT',
];

type SpreadSource =
  | 'canonical_gross_bps'
  | 'measured_gross_profit_usd_over_notional'
  | 'canonical_net_bps_fallback'
  | 'cex_four_mode_measured_net_after_exchange_fees_bps'
  | 'locked_last_known_measured_bps';

interface MeasuredSpreadPoint {
  topology: MeasuredOpportunityTopology;
  opportunityId: string;
  spreadBps: number;
  observedAt: number;
  expiresAt: number | null;
  source: Exclude<SpreadSource, 'locked_last_known_measured_bps'>;
  current: boolean;
}

interface LockedMeasuredSpread {
  spreadBps: number;
  observedAt: number;
  source: Exclude<SpreadSource, 'locked_last_known_measured_bps'>;
}

export interface StageOneTopologySpreadSnapshot {
  topology: MeasuredOpportunityTopology;
  observationsInRetentionWindow: number;
  measuredSpreadCount: number;
  currentMeasuredSpreadCount: number;
  stageOneSpreadVisible: boolean;
  bestMeasuredSpreadBps: number | null;
  closestToZeroSpreadBps: number | null;
  latestMeasuredSpreadBps: number | null;
  latestMeasuredAt: number | null;
  latestSource: SpreadSource | null;
  lockedBaselineInvariant: boolean;
  lockedLastKnownMeasurement: boolean;
  lockedMeasurementAgeMs: number | null;
}

export interface StageOneSpreadSnapshot {
  observedAt: number;
  retentionWindowMs: number;
  currentWindowMs: number;
  strategiesWithMeasuredSpread: number;
  totalStrategies: number;
  allStrategiesHaveMeasuredSpread: boolean;
  lockedBaselineTopologies: MeasuredOpportunityTopology[];
  lockedMeasuredTopologies: MeasuredOpportunityTopology[];
  byTopology: Record<MeasuredOpportunityTopology, StageOneTopologySpreadSnapshot>;
  authority: 'stage_one_measurement_visibility_only';
  executionAuthority: false;
  economicMutationAuthority: false;
  staleEvidenceExecutionAuthority: false;
  syntheticEconomicsAllowed: false;
}

let timer: NodeJS.Timeout | null = null;
let latest: StageOneSpreadSnapshot | null = null;
const lockedMeasuredSpreads = new Map<MeasuredOpportunityTopology, LockedMeasuredSpread>();

function finite(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function retentionWindowMs(): number {
  const configured = Number(process.env.CRYPTOCRAWL_STAGE_ONE_SPREAD_RETENTION_MS || 180_000);
  return Number.isFinite(configured) ? Math.max(30_000, Math.min(600_000, Math.trunc(configured))) : 180_000;
}

function currentWindowMs(): number {
  const configured = Number(process.env.CRYPTOCRAWL_STAGE_ONE_SPREAD_CURRENT_MS || 90_000);
  return Number.isFinite(configured) ? Math.max(10_000, Math.min(180_000, Math.trunc(configured))) : 90_000;
}

function intervalMs(): number {
  const configured = Number(process.env.CRYPTOCRAWL_STAGE_ONE_SPREAD_LOG_MS || 5_000);
  return Number.isFinite(configured) ? Math.max(1_000, Math.min(60_000, Math.trunc(configured))) : 5_000;
}

function candidateMeasuredSpread(candidate: MeasuredCandidate): { spreadBps: number; source: MeasuredSpreadPoint['source'] } | null {
  const canonicalGross = finite(candidate.canonicalBps.grossBps);
  if (canonicalGross !== null) return { spreadBps: canonicalGross, source: 'canonical_gross_bps' };

  const directGross = finite(candidate.economics.grossProfitBps);
  if (directGross !== null) return { spreadBps: directGross, source: 'canonical_gross_bps' };

  const grossUsd = finite(candidate.economics.grossProfitUsd);
  const notionalUsd = finite(candidate.economics.notionalUsd) ?? finite(candidate.canonicalBps.notionalUsd);
  if (grossUsd !== null && notionalUsd !== null && notionalUsd > 0) {
    const spreadBps = grossUsd / notionalUsd * 10_000;
    if (Number.isFinite(spreadBps)) {
      return { spreadBps, source: 'measured_gross_profit_usd_over_notional' };
    }
  }

  const canonicalNet = finite(candidate.canonicalBps.netBps);
  if (canonicalNet !== null) return { spreadBps: canonicalNet, source: 'canonical_net_bps_fallback' };
  return null;
}

function registrySpreadPoints(now: number, retentionMs: number, currentMs: number): MeasuredSpreadPoint[] {
  const cutoff = now - retentionMs;
  return measuredCandidateRegistry.getRecentIncludingExpired(4096).flatMap(candidate => {
    if (candidate.observedAt < cutoff) return [];
    const measured = candidateMeasuredSpread(candidate);
    if (!measured) return [];
    const current = candidate.observedAt >= now - currentMs
      && candidate.expiresAt > now
      && candidate.status !== 'expired'
      && candidate.status !== 'blocked';
    return [{
      topology: candidate.topology,
      opportunityId: candidate.opportunityId,
      spreadBps: measured.spreadBps,
      observedAt: candidate.observedAt,
      expiresAt: candidate.expiresAt,
      source: measured.source,
      current,
    }];
  });
}

function cexFourModeSpreadPoints(now: number, retentionMs: number, currentMs: number): MeasuredSpreadPoint[] {
  const cutoff = now - retentionMs;
  return getCexFourModeSnapshot().flatMap(mode => {
    const spreadBps = finite(mode.netAfterExchangeFeesBps);
    if (spreadBps === null || mode.observedAt < cutoff) return [];
    return [{
      topology: 'CEX_CEX' as const,
      opportunityId: `cex-four-mode:${mode.symbol}:${mode.buyVenue}:${mode.sellVenue}:${mode.mode}:${mode.observedAt}`,
      spreadBps,
      observedAt: mode.observedAt,
      expiresAt: null,
      source: 'cex_four_mode_measured_net_after_exchange_fees_bps' as const,
      current: mode.observedAt >= now - currentMs,
    }];
  });
}

function closestToZero(values: number[]): number | null {
  if (!values.length) return null;
  return [...values].sort((left, right) => Math.abs(left) - Math.abs(right) || right - left)[0];
}

function lockMeasuredPoints(points: readonly MeasuredSpreadPoint[]): void {
  for (const point of points) {
    const existing = lockedMeasuredSpreads.get(point.topology);
    if (existing && existing.observedAt > point.observedAt) continue;
    lockedMeasuredSpreads.set(point.topology, {
      spreadBps: point.spreadBps,
      observedAt: point.observedAt,
      source: point.source,
    });
  }
}

function recompute(): StageOneSpreadSnapshot {
  const now = Date.now();
  const retentionMs = retentionWindowMs();
  const currentMs = currentWindowMs();
  const registryCandidates = measuredCandidateRegistry.getRecentIncludingExpired(4096)
    .filter(candidate => candidate.observedAt >= now - retentionMs);
  const cexPoints = cexFourModeSpreadPoints(now, retentionMs, currentMs);
  const points = [...registrySpreadPoints(now, retentionMs, currentMs), ...cexPoints];
  lockMeasuredPoints(points);

  const byTopology = Object.fromEntries(TOPOLOGIES.map(topology => {
    const topologyPoints = points
      .filter(point => point.topology === topology)
      .sort((left, right) => right.observedAt - left.observedAt);
    const values = topologyPoints.map(point => point.spreadBps);
    const latestPoint = topologyPoints[0] || null;
    const locked = lockedMeasuredSpreads.get(topology) ?? null;
    const visibleSpread = latestPoint?.spreadBps ?? locked?.spreadBps ?? null;
    const observationsInRetentionWindow = topology === 'CEX_CEX'
      ? Math.max(
          registryCandidates.filter(candidate => candidate.topology === topology).length,
          cexPoints.length,
        )
      : registryCandidates.filter(candidate => candidate.topology === topology).length;

    const snapshot: StageOneTopologySpreadSnapshot = {
      topology,
      observationsInRetentionWindow,
      measuredSpreadCount: topologyPoints.length,
      currentMeasuredSpreadCount: topologyPoints.filter(point => point.current).length,
      stageOneSpreadVisible: visibleSpread !== null,
      bestMeasuredSpreadBps: values.length ? Math.max(...values) : locked?.spreadBps ?? null,
      closestToZeroSpreadBps: values.length ? closestToZero(values) : locked?.spreadBps ?? null,
      latestMeasuredSpreadBps: visibleSpread,
      latestMeasuredAt: latestPoint?.observedAt ?? locked?.observedAt ?? null,
      latestSource: latestPoint?.source ?? (locked ? 'locked_last_known_measured_bps' : null),
      lockedBaselineInvariant: LOCKED_BASELINE_TOPOLOGIES.includes(topology),
      lockedLastKnownMeasurement: latestPoint === null && locked !== null,
      lockedMeasurementAgeMs: locked ? Math.max(0, now - locked.observedAt) : null,
    };
    return [topology, snapshot];
  })) as Record<MeasuredOpportunityTopology, StageOneTopologySpreadSnapshot>;

  const strategiesWithMeasuredSpread = TOPOLOGIES.filter(topology => byTopology[topology].stageOneSpreadVisible).length;
  latest = {
    observedAt: now,
    retentionWindowMs: retentionMs,
    currentWindowMs: currentMs,
    strategiesWithMeasuredSpread,
    totalStrategies: TOPOLOGIES.length,
    allStrategiesHaveMeasuredSpread: strategiesWithMeasuredSpread === TOPOLOGIES.length,
    lockedBaselineTopologies: [...LOCKED_BASELINE_TOPOLOGIES],
    lockedMeasuredTopologies: TOPOLOGIES.filter(topology => lockedMeasuredSpreads.has(topology)),
    byTopology,
    authority: 'stage_one_measurement_visibility_only',
    executionAuthority: false,
    economicMutationAuthority: false,
    staleEvidenceExecutionAuthority: false,
    syntheticEconomicsAllowed: false,
  };
  return latest;
}

function publish(): void {
  const snapshot = recompute();
  logger.info('[StageOneSpread] Measured strategy BPS visibility refreshed', {
    component: 'StageOneSpreadObservability',
    observedAt: snapshot.observedAt,
    strategiesWithMeasuredSpread: snapshot.strategiesWithMeasuredSpread,
    totalStrategies: snapshot.totalStrategies,
    allStrategiesHaveMeasuredSpread: snapshot.allStrategiesHaveMeasuredSpread,
    retentionWindowMs: snapshot.retentionWindowMs,
    currentWindowMs: snapshot.currentWindowMs,
    lockedBaselineTopologies: snapshot.lockedBaselineTopologies,
    lockedMeasuredTopologies: snapshot.lockedMeasuredTopologies,
    byTopology: Object.values(snapshot.byTopology),
    recovery: getStageOneMeasurementRecoverySnapshot(),
    dexMempoolRepair: getStageOneDexMempoolRepairSnapshot(),
    authority: snapshot.authority,
    executionAuthority: snapshot.executionAuthority,
    economicMutationAuthority: snapshot.economicMutationAuthority,
    staleEvidenceExecutionAuthority: snapshot.staleEvidenceExecutionAuthority,
    syntheticEconomicsAllowed: snapshot.syntheticEconomicsAllowed,
  });
}

export function getStageOneSpreadSnapshot(): StageOneSpreadSnapshot {
  return latest ?? recompute();
}

export function ensureStageOneSpreadObservability(): void {
  if (timer) return;
  ensureStageOneMeasurementRecovery();
  ensureStageOneDexMempoolRepair();
  publish();
  if (process.env.NO_INTERVALS !== 'true') {
    timer = setInterval(publish, intervalMs());
    timer.unref?.();
  }
  logger.info('[StageOneSpread] Measurement-only Stage-1 spread authority installed', {
    component: 'StageOneSpreadObservability',
    topologies: TOPOLOGIES,
    lockedBaselineTopologies: LOCKED_BASELINE_TOPOLOGIES,
    retentionWindowMs: retentionWindowMs(),
    currentWindowMs: currentWindowMs(),
    measurementRecoveryInstalled: true,
    dexMempoolRepairInstalled: true,
    executionAuthority: false,
    economicMutationAuthority: false,
    staleEvidenceExecutionAuthority: false,
    syntheticEconomicsAllowed: false,
  });
}
