import logger from '../../../logger.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import { canonicalOpportunityState, type CanonicalOpportunitySnapshot } from '../intelligence/canonical-opportunity-state.js';
import { stageManager } from '../governance/stage-management.js';
import { getSettlementProfitCalibrationSnapshot } from '../learning/settlement-profit-calibrator.js';
import { getBpsReductionSuperEngineSnapshot } from '../optimization/bps-reduction-super-engine.js';
import { orderCexCandidatesWithNixGen } from '../optimization/nix-gen/cex-ordering.js';
import { endToEndLatencyHarness, type LatencyOutcome } from '../runtime/end-to-end-latency-harness.js';
import { getCryptoCrawlerRuntimeAttestation, isRuntimeIdentitySafe } from '../runtime/runtime-attestation.js';
import { runtimeInvariantMonitor } from '../runtime/runtime-invariant-monitor.js';
import { executeVerifiedArbitragePlan } from './index.js';
import { executionResourceScheduler, type ExecutionResourceLease } from './resource-scheduler.js';
import { measuredTopologyExecutionAdapter, type MeasuredTopologyDispatchResult } from './measured-topology-execution-adapter.js';
import { routeRecentMeasuredOpportunities } from './unified-execution-router.js';

export type CanonicalSchedulerIdleReason =
  | 'not_started'
  | 'live_execution_posture_disabled'
  | 'runtime_identity_mismatch'
  | 'governance_stage_blocked'
  | 'no_eligible_candidates'
  | 'candidate_retry_window'
  | 'no_resource_qualified_candidates';

export interface CanonicalExecutionSchedulerStats {
  running: boolean;
  ownerId: string;
  active: number;
  attempts: number;
  settled: number;
  pending: number;
  failed: number;
  lastDispatchAt: number | null;
  lastIdleReason: CanonicalSchedulerIdleReason | null;
  lastEligibleCandidateCount: number;
  lastDispatchCandidateCount: number;
  lastResourceQualifiedCount: number;
  lastMeasuredTopologyDispatchCount: number;
  resourceUsage: Record<string, number>;
}

type Candidate = CanonicalOpportunitySnapshot & { plan: NonNullable<CanonicalOpportunitySnapshot['plan']> };
type BpsEdgeHalfLifeState = {
  symbol: string;
  emaLifetimeMs: number;
  completedSamples: number;
};

function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function boundedNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function dispatchBatchLimit(): number {
  return boundedInt(process.env.CRYPTOCRAWL_EXECUTION_DISPATCH_BATCH, 8, 1, 32);
}

function baseDispatchIntervalMs(): number {
  return boundedInt(process.env.CRYPTOCRAWL_EXECUTION_DISPATCH_MS, 250, 100, 10_000);
}

function dispatchJitterFraction(): number {
  return boundedNumber(process.env.CRYPTOCRAWL_EXECUTION_DISPATCH_JITTER_FRACTION, 0.05, 0, 0.35);
}

function maxDispatchIntervalMs(): number {
  return boundedInt(process.env.CRYPTOCRAWL_EXECUTION_DISPATCH_MAX_MS, 1000, 250, 10_000);
}

function idleCadenceMultiplier(reason: CanonicalSchedulerIdleReason | null): number {
  if (reason === 'live_execution_posture_disabled' || reason === 'runtime_identity_mismatch' || reason === 'governance_stage_blocked') return 2;
  if (reason === 'no_eligible_candidates') return 1.5;
  if (reason === 'no_resource_qualified_candidates') return 1.4;
  if (reason === 'candidate_retry_window') return 1.25;
  return 1;
}

function nextDispatchDelayMs(reason: CanonicalSchedulerIdleReason | null): number {
  const base = baseDispatchIntervalMs() * idleCadenceMultiplier(reason);
  const jitter = dispatchJitterFraction();
  const randomFactor = jitter > 0 ? 1 + ((Math.random() * 2 - 1) * jitter) : 1;
  return Math.max(100, Math.min(maxDispatchIntervalMs(), Math.round(base * randomFactor)));
}

function isLiveExecutionPosture(): boolean {
  return process.env.NO_EXECUTION !== 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK';
}

function terminalCalibrationFactor(candidate: Candidate): number {
  const calibration = getSettlementProfitCalibrationSnapshot({
    chain: 'cex',
    symbol: candidate.symbol,
    strategy: 'verified_cex_arbitrage',
  });
  if (calibration.terminalSamples === 0) return 1;
  const expected = Math.max(1e-9, candidate.plan.netProfitUsd);
  const reserve = Math.max(0, calibration.confidenceWeightedProfitReserveUsd ?? 0);
  const reserveBurden = Math.min(0.8, reserve / expected);
  const confidence = Math.max(0, Math.min(1, calibration.calibrationConfidence));
  const overestimateRate = Math.max(0, Math.min(1, calibration.overestimateRate ?? 0));
  return Math.max(0.2, 1 - reserveBurden * confidence - 0.25 * overestimateRate * confidence);
}

function bpsDecayUrgencyFactor(candidate: Candidate, edgeLife: Map<string, BpsEdgeHalfLifeState>): number {
  const learned = edgeLife.get(candidate.symbol.trim().toUpperCase());
  if (!learned || learned.completedSamples <= 0 || !Number.isFinite(learned.emaLifetimeMs) || learned.emaLifetimeMs <= 0) return 1;
  const halfLifeMs = Math.max(50, Math.min(5_000, learned.emaLifetimeMs / 2));
  const quoteAgeMs = Math.max(0, Number(candidate.plan.quoteAgeMs) || 0);
  const urgency = Math.max(0, Math.min(1, quoteAgeMs / halfLifeMs));
  // Super Engine is scheduling-only: it may accelerate a decaying profitable
  // opportunity but can never reduce priority, admit, reject, size, or execute it.
  return 1 + urgency * 0.5;
}

function candidatePriority(
  candidate: Candidate,
  maxQuoteAgeMs: number,
  edgeLife: Map<string, BpsEdgeHalfLifeState>,
): number {
  const probability = Math.max(0.25, Math.min(1, candidate.assessment?.probabilityOfProfitableExecution ?? 1));
  const expectedProfit = Math.max(0, candidate.plan.netProfitUsd) * probability;
  const freshness = Math.max(0.05, Math.min(1, 1 - candidate.plan.quoteAgeMs / Math.max(1, maxQuoteAgeMs)));
  const notional = Math.max(1, candidate.plan.notionalUsd);
  const costBurden = Math.max(0, candidate.plan.costs.totalCostsUsd) / notional;
  const costEfficiency = 1 / (1 + costBurden);
  const rankSignal = Math.max(0.25, 1 + Math.max(-0.75, Math.min(0.75, Number(candidate.assessment?.rankScore ?? 0) / 100)));
  const calibration = terminalCalibrationFactor(candidate);
  const decayUrgency = bpsDecayUrgencyFactor(candidate, edgeLife);
  return expectedProfit * freshness * costEfficiency * rankSignal * calibration * decayUrgency;
}

function currentCandidates(): Candidate[] {
  const maxQuoteAgeMs = Math.max(250, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000));
  const now = Date.now();
  const superEngine = getBpsReductionSuperEngineSnapshot();
  const edgeLife = new Map<string, BpsEdgeHalfLifeState>(
    superEngine.edgeHalfLife
      .filter(row => row.symbol && Number.isFinite(row.emaLifetimeMs))
      .map(row => [row.symbol.trim().toUpperCase(), {
        symbol: row.symbol,
        emaLifetimeMs: row.emaLifetimeMs,
        completedSamples: row.completedSamples,
      }]),
  );
  const candidates = canonicalOpportunityState.getRecent(512)
    .filter((snapshot): snapshot is Candidate => !!snapshot.plan)
    .filter(snapshot => snapshot.status === 'eligible')
    .filter(snapshot => runtimeInvariantMonitor.evaluate(snapshot).allowed)
    .filter(snapshot => Number.isFinite(snapshot.plan.netProfitUsd) && snapshot.plan.netProfitUsd > 0)
    .filter(snapshot => snapshot.plan.quoteAgeMs <= maxQuoteAgeMs)
    .filter(snapshot => now - snapshot.observedAt <= maxQuoteAgeMs)
    .filter(snapshot => snapshot.governance.killSwitchActive === false)
    .filter(snapshot => snapshot.governance.paused === false)
    .sort((left, right) => {
      const priorityDelta = candidatePriority(right, maxQuoteAgeMs, edgeLife) - candidatePriority(left, maxQuoteAgeMs, edgeLife);
      if (priorityDelta !== 0) return priorityDelta;
      if (right.plan.netProfitUsd !== left.plan.netProfitUsd) return right.plan.netProfitUsd - left.plan.netProfitUsd;
      return (right.assessment?.rankScore ?? -Infinity) - (left.assessment?.rankScore ?? -Infinity);
    });

  const nixOrdering = orderCexCandidatesWithNixGen({
    candidates,
    now,
    maxQuoteAgeMs,
    dispatchCapacity: dispatchBatchLimit(),
    terminalCalibrationFactor,
    decayUrgencyFactor: candidate => bpsDecayUrgencyFactor(candidate, edgeLife),
  });
  if (nixOrdering.error) {
    logger.warn('[ExecutionScheduler] Nix-Gen advisory ordering failed open to canonical order', {
      component: 'CanonicalExecutionScheduler',
      error: nixOrdering.error,
      canonicalEligibilityChanged: false,
      executionAuthorityChanged: false,
    });
  }
  return nixOrdering.candidates;
}

function terminalResult(status: string, settlementConfirmed: boolean): boolean {
  return settlementConfirmed || ['cancelled', 'rejected', 'failed'].includes(status);
}

function settlementLatencyOutcome(status: string, settlementConfirmed: boolean): LatencyOutcome {
  if (settlementConfirmed) return 'ok';
  if (status === 'settlement_unknown') return 'timeout';
  if (status === 'cancelled') return 'cancel';
  if (status === 'failed' || status === 'rejected') return 'error';
  return 'retry';
}

class CanonicalExecutionScheduler {
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private dispatchInFlight: Promise<void> | null = null;
  private eligibleUnsubscribe: (() => void) | null = null;
  private immediateWakeScheduled = false;
  private immediateWakeRequested = false;
  private readonly activeOpportunityIds = new Set<string>();
  private readonly lastAttemptAt = new Map<string, number>();
  private attempts = 0;
  private settled = 0;
  private pending = 0;
  private failed = 0;
  private lastDispatchAt: number | null = null;
  private lastIdleReason: CanonicalSchedulerIdleReason | null = 'not_started';
  private lastEligibleCandidateCount = 0;
  private lastDispatchCandidateCount = 0;
  private lastResourceQualifiedCount = 0;
  private lastMeasuredTopologyDispatchCount = 0;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.eligibleUnsubscribe = measuredCandidateRegistry.onEligible(candidate => this.requestImmediateDispatch(candidate));
    this.scheduleNextDispatch();
    logger.info('[ExecutionScheduler] Canonical execution scheduler started', {
      component: 'CanonicalExecutionScheduler',
      baseIntervalMs: baseDispatchIntervalMs(),
      maxIntervalMs: maxDispatchIntervalMs(),
      boundedJitterFraction: dispatchJitterFraction(),
      dispatchBatchLimit: dispatchBatchLimit(),
      ownerId: executionResourceScheduler.getOwnerId(),
      authority: 'canonical_eligible_opportunities_and_admitted_measured_topologies',
      schedulingObjective: 'positive_all_in_net_x_freshness_x_cost_efficiency_x_rank_x_terminal_calibration_x_bps_decay_urgency',
      bpsSuperEngineSchedulingAuthority: 'bounded_priority_boost_only',
      bpsSuperEngineExecutionAuthority: false,
      nixGenAdvisoryOrderingEnabled: process.env.CRYPTOCRAWL_NIX_GEN_ADVISORY_ORDERING === 'true',
      nixGenExecutionAuthority: false,
      cadenceObjective: 'event_driven_eligibility_wake_with_low_latency_poll_fallback',
      eligibleWakeAuthority: 'measured_candidate_registry',
      terminalCalibrationAuthority: 'scheduling_only_confirmed_settlement_evidence',
      measuredTopologyExecutionAdapter: true,
      discoveryExecutionAuthority: false,
      legacyBusinessCapsAuthoritative: false,
      distributedResourceLeases: true,
      runtimeInvariantQuarantine: true,
      runtimeIdentityMismatchFailClosed: true,
      exactOpportunityIdentityRequired: true,
      latencyHarness: 'telemetry_only',
    });
  }

  stop(): void {
    this.started = false;
    this.eligibleUnsubscribe?.();
    this.eligibleUnsubscribe = null;
    this.immediateWakeRequested = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.lastIdleReason = 'not_started';
  }

  async dispatchOnce(): Promise<void> {
    if (this.dispatchInFlight) return this.dispatchInFlight;
    this.dispatchInFlight = this.runDispatch().finally(() => {
      this.dispatchInFlight = null;
    });
    return this.dispatchInFlight;
  }

  getStats(): CanonicalExecutionSchedulerStats {
    return {
      running: this.started,
      ownerId: executionResourceScheduler.getOwnerId(),
      active: this.activeOpportunityIds.size,
      attempts: this.attempts,
      settled: this.settled,
      pending: this.pending,
      failed: this.failed,
      lastDispatchAt: this.lastDispatchAt,
      lastIdleReason: this.lastIdleReason,
      lastEligibleCandidateCount: this.lastEligibleCandidateCount,
      lastDispatchCandidateCount: this.lastDispatchCandidateCount,
      lastResourceQualifiedCount: this.lastResourceQualifiedCount,
      lastMeasuredTopologyDispatchCount: this.lastMeasuredTopologyDispatchCount,
      resourceUsage: executionResourceScheduler.getLocalUsage(),
    };
  }

  private requestImmediateDispatch(candidate: MeasuredCandidate): void {
    if (!this.started || candidate.expiresAt <= Date.now()) return;
    this.immediateWakeRequested = true;
    if (this.immediateWakeScheduled) return;
    this.immediateWakeScheduled = true;
    queueMicrotask(async () => {
      try {
        while (this.started && this.immediateWakeRequested) {
          this.immediateWakeRequested = false;
          const joinedExistingDispatch = this.dispatchInFlight !== null;
          await this.dispatchOnce();
          if (joinedExistingDispatch && this.started) this.immediateWakeRequested = true;
        }
      } catch (error) {
        logger.error('[ExecutionScheduler] Immediate eligible-candidate wake failed closed', {
          component: 'CanonicalExecutionScheduler',
          opportunityId: candidate.opportunityId,
          topology: candidate.topology,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.immediateWakeScheduled = false;
        if (this.started && this.immediateWakeRequested) this.requestImmediateDispatch(candidate);
      }
    });
  }

  private scheduleNextDispatch(): void {
    if (!this.started || process.env.NO_INTERVALS === 'true') return;
    const delayMs = nextDispatchDelayMs(this.lastIdleReason);
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.dispatchOnce();
      } catch (error) {
        logger.error('[ExecutionScheduler] Dispatch cycle failed closed', {
          component: 'CanonicalExecutionScheduler',
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.scheduleNextDispatch();
      }
    }, delayMs);
    this.timer.unref?.();
  }

  private setIdle(reason: CanonicalSchedulerIdleReason, eligible = 0, dispatchable = 0, resourceQualified = 0): void {
    this.lastIdleReason = reason;
    this.lastEligibleCandidateCount = eligible;
    this.lastDispatchCandidateCount = dispatchable;
    this.lastResourceQualifiedCount = resourceQualified;
  }

  private applyMeasuredTopologyResults(results: readonly MeasuredTopologyDispatchResult[]): boolean {
    this.lastMeasuredTopologyDispatchCount = results.filter(result => result.dispatched).length;
    let dispatched = false;
    for (const result of results) {
      if (!result.dispatched) continue;
      dispatched = true;
      this.attempts++;
      if (result.settlementConfirmed) {
        if (result.success) this.settled++;
        else this.failed++;
      } else if (result.error) {
        this.failed++;
      } else {
        this.pending++;
      }
    }
    if (dispatched) {
      this.lastDispatchAt = Date.now();
      this.lastIdleReason = null;
    }
    return dispatched;
  }

  private async dispatchMeasuredTopologies(): Promise<boolean> {
    try {
      const routed = routeRecentMeasuredOpportunities(1024);
      const results = await measuredTopologyExecutionAdapter.dispatch(routed);
      return this.applyMeasuredTopologyResults(results);
    } catch (error) {
      this.lastMeasuredTopologyDispatchCount = 0;
      logger.error('[ExecutionScheduler] Measured topology adapter failed closed', {
        component: 'CanonicalExecutionScheduler',
        error: error instanceof Error ? error.message : String(error),
        schedulingAuthorityChanged: false,
      });
      return false;
    }
  }

  private async runDispatch(): Promise<void> {
    if (!isLiveExecutionPosture()) {
      this.setIdle('live_execution_posture_disabled');
      return;
    }

    const runtimeAttestation = getCryptoCrawlerRuntimeAttestation();
    if (!isRuntimeIdentitySafe(runtimeAttestation)) {
      this.setIdle('runtime_identity_mismatch');
      logger.error('[ExecutionScheduler] Live dispatch blocked by runtime identity mismatch', {
        component: 'CanonicalExecutionScheduler',
        sourceSha: runtimeAttestation.sourceSha,
        railwayCommitSha: runtimeAttestation.railwayCommitSha,
        mismatches: runtimeAttestation.mismatches,
      });
      return;
    }

    const governanceAllowed = endToEndLatencyHarness.measureSync(
      'governance_risk',
      'compute',
      { backend: 'stage_manager', worker: executionResourceScheduler.getOwnerId() },
      () => stageManager.canExecuteTrades(),
    );
    if (!governanceAllowed) {
      this.setIdle('governance_stage_blocked');
      return;
    }

    const measuredTopologyDispatched = await this.dispatchMeasuredTopologies();

    const retryWindowMs = Math.max(250, Number(process.env.CRYPTOCRAWL_EXECUTION_RETRY_WINDOW_MS || 1_000));
    const now = Date.now();
    const eligibleCandidates = currentCandidates();
    this.lastEligibleCandidateCount = eligibleCandidates.length;
    if (eligibleCandidates.length === 0) {
      if (!measuredTopologyDispatched) this.setIdle('no_eligible_candidates');
      return;
    }

    const candidates = eligibleCandidates.filter(candidate =>
      !this.activeOpportunityIds.has(candidate.opportunityId)
      && now - (this.lastAttemptAt.get(candidate.opportunityId) || 0) >= retryWindowMs,
    ).slice(0, dispatchBatchLimit());
    this.lastDispatchCandidateCount = candidates.length;
    if (candidates.length === 0) {
      if (!measuredTopologyDispatched) this.setIdle('candidate_retry_window', eligibleCandidates.length, 0, 0);
      return;
    }

    const selected: Array<{ candidate: Candidate; lease: ExecutionResourceLease }> = [];
    for (const candidate of candidates) {
      const dimensions = {
        traceId: candidate.opportunityId,
        worker: executionResourceScheduler.getOwnerId(),
        backend: 'cex_resource_scheduler',
        venue: `${candidate.plan.buyVenue}->${candidate.plan.sellVenue}`,
        chain: 'cex',
        symbol: candidate.symbol,
        strategy: 'verified_cex_arbitrage',
      };
      const lease = await endToEndLatencyHarness.measureAsync(
        'resource_lease',
        'queue',
        dimensions,
        () => executionResourceScheduler.acquireCexPlan(candidate.plan, candidate.opportunityId),
      );
      if (!lease) continue;
      selected.push({ candidate, lease });
    }
    this.lastResourceQualifiedCount = selected.length;
    if (selected.length === 0) {
      if (!measuredTopologyDispatched) this.setIdle('no_resource_qualified_candidates', eligibleCandidates.length, candidates.length, 0);
      return;
    }

    this.lastIdleReason = null;
    this.lastDispatchAt = Date.now();
    logger.info('[ExecutionScheduler] Resource-qualified canonical batch selected', {
      component: 'CanonicalExecutionScheduler',
      selected: selected.map(({ candidate, lease }) => ({
        opportunityId: candidate.opportunityId,
        symbol: candidate.symbol,
        buyVenue: candidate.plan.buyVenue,
        sellVenue: candidate.plan.sellVenue,
        netProfitUsd: candidate.plan.netProfitUsd,
        probabilityOfProfitableExecution: candidate.assessment?.probabilityOfProfitableExecution,
        terminalCalibrationFactor: terminalCalibrationFactor(candidate),
        leaseId: lease.leaseId,
        resources: lease.resources,
      })),
      stage: stageManager.getCurrentStage(),
    });

    await Promise.all(selected.map(async ({ candidate, lease }) => {
      this.activeOpportunityIds.add(candidate.opportunityId);
      this.lastAttemptAt.set(candidate.opportunityId, Date.now());
      this.attempts++;
      let retainOpportunityUntilExpiry = false;
      const dimensions = {
        traceId: candidate.opportunityId,
        worker: executionResourceScheduler.getOwnerId(),
        backend: 'canonical_cex_execution',
        venue: `${candidate.plan.buyVenue}->${candidate.plan.sellVenue}`,
        chain: 'cex',
        symbol: candidate.symbol,
        strategy: 'verified_cex_arbitrage',
      };
      const settlementSpan = endToEndLatencyHarness.startSpan('terminal_settlement', 'network', dimensions);
      try {
        const result = await executeVerifiedArbitragePlan(candidate.plan, {
          opportunityId: candidate.opportunityId,
          source: 'master_pipeline',
          chain: candidate.plan.bridge?.from,
          observedSlippageBps: candidate.plan.expectedSlippageBps ?? undefined,
        });
        settlementSpan.end(settlementLatencyOutcome(result.status, result.settlementConfirmed));

        if (result.success && result.settlementConfirmed) {
          this.settled++;
        } else if (!terminalResult(result.status, result.settlementConfirmed)) {
          this.pending++;
          retainOpportunityUntilExpiry = true;
        } else {
          this.failed++;
        }

        logger.info('[ExecutionScheduler] Canonical execution attempt completed', {
          component: 'CanonicalExecutionScheduler',
          opportunityId: candidate.opportunityId,
          symbol: candidate.symbol,
          status: result.status,
          success: result.success,
          settlementConfirmed: result.settlementConfirmed,
          expectedNetProfitUsd: candidate.plan.netProfitUsd,
          realizedNetProfitUsd: result.normalized?.realized.netProfitUsd ?? null,
          latencyMs: result.latencyMs,
          retainOpportunityUntilExpiry,
          error: result.error,
        });
      } catch (error) {
        settlementSpan.end('error');
        this.failed++;
        logger.error('[ExecutionScheduler] Canonical execution attempt failed closed', {
          component: 'CanonicalExecutionScheduler',
          opportunityId: candidate.opportunityId,
          symbol: candidate.symbol,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.activeOpportunityIds.delete(candidate.opportunityId);
        await lease.release({ retainOpportunityUntilExpiry });
      }
    }));
  }
}

export const canonicalExecutionScheduler = new CanonicalExecutionScheduler();