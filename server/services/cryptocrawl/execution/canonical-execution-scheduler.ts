import logger from '../../../logger.js';
import { canonicalOpportunityState, type CanonicalOpportunitySnapshot } from '../intelligence/canonical-opportunity-state.js';
import { stageManager } from '../governance/stage-management.js';
import { getSettlementProfitCalibrationSnapshot } from '../learning/settlement-profit-calibrator.js';
import { endToEndLatencyHarness, type LatencyOutcome } from '../runtime/end-to-end-latency-harness.js';
import { getCryptoCrawlerRuntimeAttestation, isRuntimeIdentitySafe } from '../runtime/runtime-attestation.js';
import { runtimeInvariantMonitor } from '../runtime/runtime-invariant-monitor.js';
import { executeVerifiedArbitragePlan } from './index.js';
import { executionResourceScheduler, type ExecutionResourceLease } from './resource-scheduler.js';

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
  resourceUsage: Record<string, number>;
}

type Candidate = CanonicalOpportunitySnapshot & { plan: NonNullable<CanonicalOpportunitySnapshot['plan']> };

function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function dispatchBatchLimit(): number {
  return boundedInt(process.env.CRYPTOCRAWL_EXECUTION_DISPATCH_BATCH, 8, 1, 32);
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

function candidatePriority(candidate: Candidate, maxQuoteAgeMs: number): number {
  const probability = Math.max(0, Math.min(1, candidate.assessment?.probabilityOfProfitableExecution ?? 0));
  const expectedProfit = Math.max(0, candidate.plan.netProfitUsd) * probability;
  const freshness = Math.max(0.05, Math.min(1, 1 - candidate.plan.quoteAgeMs / Math.max(1, maxQuoteAgeMs)));
  const notional = Math.max(1, candidate.plan.notionalUsd);
  const costBurden = Math.max(0, candidate.plan.costs.totalCostsUsd) / notional;
  const costEfficiency = 1 / (1 + costBurden);
  const rankSignal = Math.max(0.25, 1 + Math.max(-0.75, Math.min(0.75, Number(candidate.assessment?.rankScore ?? 0) / 100)));
  const calibration = terminalCalibrationFactor(candidate);
  return expectedProfit * freshness * costEfficiency * rankSignal * calibration;
}

function currentCandidates(): Candidate[] {
  const maxQuoteAgeMs = Math.max(250, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000));
  const now = Date.now();
  return canonicalOpportunityState.getRecent(512)
    .filter((snapshot): snapshot is Candidate => !!snapshot.plan)
    .filter(snapshot => snapshot.status === 'eligible')
    .filter(snapshot => runtimeInvariantMonitor.evaluate(snapshot).allowed)
    .filter(snapshot => snapshot.assessment?.recommendation === 'consider')
    .filter(snapshot => Number.isFinite(snapshot.plan.netProfitUsd) && snapshot.plan.netProfitUsd > 0)
    .filter(snapshot => snapshot.plan.quoteAgeMs <= maxQuoteAgeMs)
    .filter(snapshot => now - snapshot.observedAt <= maxQuoteAgeMs)
    .filter(snapshot => snapshot.governance.killSwitchActive === false)
    .filter(snapshot => snapshot.governance.paused === false)
    .sort((left, right) => {
      const priorityDelta = candidatePriority(right, maxQuoteAgeMs) - candidatePriority(left, maxQuoteAgeMs);
      if (priorityDelta !== 0) return priorityDelta;
      const leftProbability = left.assessment?.probabilityOfProfitableExecution ?? 0;
      const rightProbability = right.assessment?.probabilityOfProfitableExecution ?? 0;
      const leftValue = left.plan.netProfitUsd * leftProbability;
      const rightValue = right.plan.netProfitUsd * rightProbability;
      if (rightValue !== leftValue) return rightValue - leftValue;
      return (right.assessment?.rankScore ?? -Infinity) - (left.assessment?.rankScore ?? -Infinity);
    });
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
  private dispatchInFlight: Promise<void> | null = null;
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

  start(): void {
    if (this.timer) return;
    const intervalMs = Math.max(250, Number(process.env.CRYPTOCRAWL_EXECUTION_DISPATCH_MS || 750));
    this.timer = setInterval(() => {
      void this.dispatchOnce();
    }, intervalMs);
    this.timer.unref?.();
    logger.info('[ExecutionScheduler] Canonical execution scheduler started', {
      component: 'CanonicalExecutionScheduler',
      intervalMs,
      dispatchBatchLimit: dispatchBatchLimit(),
      ownerId: executionResourceScheduler.getOwnerId(),
      authority: 'canonical_eligible_opportunities',
      schedulingObjective: 'expected_profit_x_freshness_x_cost_efficiency_x_rank_x_terminal_calibration',
      terminalCalibrationAuthority: 'scheduling_only_confirmed_settlement_evidence',
      legacyBusinessCapsAuthoritative: false,
      distributedResourceLeases: true,
      runtimeInvariantQuarantine: true,
      runtimeIdentityMismatchFailClosed: true,
      exactOpportunityIdentityRequired: true,
      latencyHarness: 'telemetry_only',
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
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
      running: this.timer !== null,
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
      resourceUsage: executionResourceScheduler.getLocalUsage(),
    };
  }

  private setIdle(reason: CanonicalSchedulerIdleReason, eligible = 0, dispatchable = 0, resourceQualified = 0): void {
    this.lastIdleReason = reason;
    this.lastEligibleCandidateCount = eligible;
    this.lastDispatchCandidateCount = dispatchable;
    this.lastResourceQualifiedCount = resourceQualified;
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

    const retryWindowMs = Math.max(1_000, Number(process.env.CRYPTOCRAWL_EXECUTION_RETRY_WINDOW_MS || 10_000));
    const now = Date.now();
    const eligibleCandidates = currentCandidates();
    this.lastEligibleCandidateCount = eligibleCandidates.length;
    if (eligibleCandidates.length === 0) {
      this.setIdle('no_eligible_candidates');
      return;
    }

    const candidates = eligibleCandidates.filter(candidate =>
      !this.activeOpportunityIds.has(candidate.opportunityId)
      && now - (this.lastAttemptAt.get(candidate.opportunityId) || 0) >= retryWindowMs,
    ).slice(0, dispatchBatchLimit());
    this.lastDispatchCandidateCount = candidates.length;
    if (candidates.length === 0) {
      this.setIdle('candidate_retry_window', eligibleCandidates.length, 0, 0);
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
      this.setIdle('no_resource_qualified_candidates', eligibleCandidates.length, candidates.length, 0);
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
