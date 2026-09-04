import logger from '../../../logger.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import { operatorTradingStrategy, type OperatorTradingStrategyState } from '../governance/operator-trading-strategy.js';
import { stageManager } from '../governance/stage-management.js';
import { canonicalOpportunityState, type CanonicalOpportunitySnapshot } from '../intelligence/canonical-opportunity-state.js';
import { getSettlementProfitCalibrationSnapshot } from '../learning/settlement-profit-calibrator.js';
import { getBpsReductionSuperEngineSnapshot } from '../optimization/bps-reduction-super-engine.js';
import { orderCexCandidatesWithNixGen } from '../optimization/nix-gen/cex-ordering.js';
import { orderSettlementCapableMeasuredDecisionsWithNixGen } from '../optimization/nix-gen/measured-portfolio-preparation.js';
import { endToEndLatencyHarness, type LatencyOutcome } from '../runtime/end-to-end-latency-harness.js';
import { getCryptoCrawlerRuntimeAttestation, isRuntimeIdentitySafe } from '../runtime/runtime-attestation.js';
import { runtimeInvariantMonitor } from '../runtime/runtime-invariant-monitor.js';
import { executeVerifiedArbitragePlan } from './index.js';
import { measuredTopologyExecutionAdapter, type MeasuredTopologyDispatchResult } from './measured-topology-execution-adapter.js';
import {
  fundingCrossChainExecutionAdapter,
  type FundingCrossChainDispatchResult,
} from './funding-crosschain-execution-adapter.js';
import { executionResourceScheduler, type ExecutionResourceLease } from './resource-scheduler.js';
import { routeRecentMeasuredOpportunities } from './unified-execution-router.js';

export type CanonicalSchedulerIdleReason =
  | 'not_started'
  | 'live_execution_posture_disabled'
  | 'runtime_identity_mismatch'
  | 'governance_stage_blocked'
  | 'operator_learning_day'
  | 'operator_daily_trade_limit'
  | 'operator_daily_profit_stop'
  | 'operator_trade_in_flight'
  | 'operator_strategy_unavailable'
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
  operatorStrategy: OperatorTradingStrategyState | null;
  resourceUsage: Record<string, number>;
}

type Candidate = CanonicalOpportunitySnapshot & { plan: NonNullable<CanonicalOpportunitySnapshot['plan']> };
type BpsEdgeHalfLifeState = { symbol: string; emaLifetimeMs: number; completedSamples: number };

function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}
function boundedNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}
function dispatchBatchLimit(): number { return boundedInt(process.env.CRYPTOCRAWL_EXECUTION_DISPATCH_BATCH, 8, 1, 32); }
function baseDispatchIntervalMs(): number { return boundedInt(process.env.CRYPTOCRAWL_EXECUTION_DISPATCH_MS, 250, 100, 10_000); }
function dispatchJitterFraction(): number { return boundedNumber(process.env.CRYPTOCRAWL_EXECUTION_DISPATCH_JITTER_FRACTION, 0.05, 0, 0.35); }
function maxDispatchIntervalMs(): number { return boundedInt(process.env.CRYPTOCRAWL_EXECUTION_DISPATCH_MAX_MS, 1000, 250, 10_000); }

function isOperatorStop(reason: CanonicalSchedulerIdleReason | null): boolean {
  return reason === 'operator_learning_day' || reason === 'operator_daily_trade_limit' || reason === 'operator_daily_profit_stop' || reason === 'operator_trade_in_flight';
}
function idleCadenceMultiplier(reason: CanonicalSchedulerIdleReason | null): number {
  if (reason === 'live_execution_posture_disabled' || reason === 'runtime_identity_mismatch' || reason === 'governance_stage_blocked') return 2;
  if (reason === 'operator_strategy_unavailable') return 4;
  if (reason === 'no_eligible_candidates') return 1.5;
  if (reason === 'no_resource_qualified_candidates') return 1.4;
  if (reason === 'candidate_retry_window') return 1.25;
  return 1;
}
function nextDispatchDelayMs(reason: CanonicalSchedulerIdleReason | null): number {
  if (isOperatorStop(reason)) return 60_000;
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
  const calibration = getSettlementProfitCalibrationSnapshot({ chain: 'cex', symbol: candidate.symbol, strategy: 'verified_cex_arbitrage' });
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
  return 1 + urgency * 0.5;
}
function candidatePriority(candidate: Candidate, maxQuoteAgeMs: number, edgeLife: Map<string, BpsEdgeHalfLifeState>): number {
  const probability = Math.max(0.25, Math.min(1, candidate.assessment?.probabilityOfProfitableExecution ?? 1));
  const expectedProfit = Math.max(0, candidate.plan.netProfitUsd) * probability;
  const freshness = Math.max(0.05, Math.min(1, 1 - candidate.plan.quoteAgeMs / Math.max(1, maxQuoteAgeMs)));
  const notional = Math.max(1, candidate.plan.notionalUsd);
  const costBurden = Math.max(0, candidate.plan.costs.totalCostsUsd) / notional;
  const costEfficiency = 1 / (1 + costBurden);
  const rankSignal = Math.max(0.25, 1 + Math.max(-0.75, Math.min(0.75, Number(candidate.assessment?.rankScore ?? 0) / 100)));
  return expectedProfit * freshness * costEfficiency * rankSignal * terminalCalibrationFactor(candidate) * bpsDecayUrgencyFactor(candidate, edgeLife);
}
function currentCandidates(): Candidate[] {
  const maxQuoteAgeMs = Math.max(250, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000));
  const now = Date.now();
  const superEngine = getBpsReductionSuperEngineSnapshot();
  const edgeLife = new Map<string, BpsEdgeHalfLifeState>(superEngine.edgeHalfLife
    .filter(row => row.symbol && Number.isFinite(row.emaLifetimeMs))
    .map(row => [row.symbol.trim().toUpperCase(), { symbol: row.symbol, emaLifetimeMs: row.emaLifetimeMs, completedSamples: row.completedSamples }]));
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
    candidates, now, maxQuoteAgeMs, dispatchCapacity: dispatchBatchLimit(), terminalCalibrationFactor,
    decayUrgencyFactor: candidate => bpsDecayUrgencyFactor(candidate, edgeLife),
  });
  if (nixOrdering.error) logger.warn('[ExecutionScheduler] Nix-Gen advisory ordering failed open to canonical order', { component: 'CanonicalExecutionScheduler', error: nixOrdering.error, canonicalEligibilityChanged: false, executionAuthorityChanged: false });
  return nixOrdering.candidates;
}
function terminalResult(status: string, settlementConfirmed: boolean): boolean { return settlementConfirmed || ['cancelled', 'rejected', 'failed'].includes(status); }
function settlementLatencyOutcome(status: string, settlementConfirmed: boolean): LatencyOutcome {
  if (settlementConfirmed) return 'ok';
  if (status === 'settlement_unknown') return 'timeout';
  if (status === 'cancelled') return 'cancel';
  if (status === 'failed' || status === 'rejected') return 'error';
  return 'retry';
}
function operatorIdleReason(state: OperatorTradingStrategyState): CanonicalSchedulerIdleReason | null {
  if (state.learningMode) return 'operator_learning_day';
  if (state.blockReason === 'daily_profit_stop') return 'operator_daily_profit_stop';
  if (state.blockReason === 'daily_trade_limit') return 'operator_daily_trade_limit';
  return null;
}
function cexHasConcreteSubmission(result: any): boolean {
  if (result?.buyOrder || result?.sellOrder) return true;
  if (Array.isArray(result?.orders) && result.orders.some((order: any) => order?.orderId || order?.clientOrderId || order?.submittedAt)) return true;
  return Array.isArray(result?.childExecutions) && result.childExecutions.some((child: any) => child?.buyOrder || child?.sellOrder || (Array.isArray(child?.orders) && child.orders.length > 0));
}
function measuredTerminal(result: MeasuredTopologyDispatchResult): boolean {
  if (!result.transactionHash) return false;
  if (result.settlementConfirmed) return true;
  const error = String(result.error || '').toUpperCase();
  return Boolean(error) && !error.includes('SETTLEMENT_UNKNOWN') && !error.includes('PENDING');
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
  private lastOperatorState: OperatorTradingStrategyState | null = null;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.eligibleUnsubscribe = measuredCandidateRegistry.onEligible(candidate => this.requestImmediateDispatch(candidate));
    this.scheduleNextDispatch();
    logger.info('[ExecutionScheduler] Canonical execution scheduler started', {
      component: 'CanonicalExecutionScheduler', baseIntervalMs: baseDispatchIntervalMs(), maxIntervalMs: maxDispatchIntervalMs(), boundedJitterFraction: dispatchJitterFraction(), dispatchBatchLimit: dispatchBatchLimit(), ownerId: executionResourceScheduler.getOwnerId(),
      authority: 'canonical_eligible_opportunities_and_admitted_measured_topologies',
      schedulingObjective: 'positive_all_in_net_x_freshness_x_cost_efficiency_x_rank_x_terminal_calibration_x_bps_decay_urgency',
      bpsSuperEngineSchedulingAuthority: 'bounded_priority_boost_only', bpsSuperEngineExecutionAuthority: false,
      nixGenAdvisoryOrderingEnabled: process.env.CRYPTOCRAWL_NIX_GEN_ADVISORY_ORDERING !== 'false', nixGenExecutionAuthority: false,
      operatorStrategyAuthority: 'when_and_how_many_parent_trades_only', operatorStrategyCycle: '20_randomized_trade_days_per_30_days', operatorStrategyDailyTradeRange: '1_to_3_submitted_parent_trades',
      operatorStrategyProfitStop: 'daily_random_300_to_3500_minus_50_cushion_realized_profit_only', operatorStrategyParentSerialization: true, operatorStrategyProfitabilityAuthority: false,
      cadenceObjective: 'event_driven_eligibility_wake_with_low_latency_poll_fallback', eligibleWakeAuthority: 'measured_candidate_registry', terminalCalibrationAuthority: 'scheduling_only_confirmed_settlement_evidence',
      measuredTopologyExecutionAdapter: true, fundingCrossChainExecutionAdapter: true, fundingLifecycleMaintenanceBeforeNewEntryGates: true,
      discoveryExecutionAuthority: false, legacyBusinessCapsAuthoritative: false, distributedResourceLeases: true, runtimeInvariantQuarantine: true, runtimeIdentityMismatchFailClosed: true, exactOpportunityIdentityRequired: true, latencyHarness: 'telemetry_only',
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
    this.dispatchInFlight = this.runDispatch().finally(() => { this.dispatchInFlight = null; });
    return this.dispatchInFlight;
  }
  getStats(): CanonicalExecutionSchedulerStats {
    return { running: this.started, ownerId: executionResourceScheduler.getOwnerId(), active: this.activeOpportunityIds.size, attempts: this.attempts, settled: this.settled, pending: this.pending, failed: this.failed, lastDispatchAt: this.lastDispatchAt, lastIdleReason: this.lastIdleReason, lastEligibleCandidateCount: this.lastEligibleCandidateCount, lastDispatchCandidateCount: this.lastDispatchCandidateCount, lastResourceQualifiedCount: this.lastResourceQualifiedCount, lastMeasuredTopologyDispatchCount: this.lastMeasuredTopologyDispatchCount, operatorStrategy: this.lastOperatorState ? { ...this.lastOperatorState } : null, resourceUsage: executionResourceScheduler.getLocalUsage() };
  }
  private requestImmediateDispatch(candidate: MeasuredCandidate): void {
    if (!this.started || candidate.expiresAt <= Date.now() || isOperatorStop(this.lastIdleReason)) return;
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
        logger.error('[ExecutionScheduler] Immediate eligible-candidate wake failed closed', { component: 'CanonicalExecutionScheduler', opportunityId: candidate.opportunityId, topology: candidate.topology, error: error instanceof Error ? error.message : String(error) });
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
      try { await this.dispatchOnce(); }
      catch (error) { logger.error('[ExecutionScheduler] Dispatch cycle failed closed', { component: 'CanonicalExecutionScheduler', error: error instanceof Error ? error.message : String(error) }); }
      finally { this.scheduleNextDispatch(); }
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
      if (result.settlementConfirmed) { if (result.success) this.settled++; else this.failed++; }
      else if (result.error) this.failed++;
      else this.pending++;
    }
    if (dispatched) { this.lastDispatchAt = Date.now(); this.lastIdleReason = null; }
    return dispatched;
  }
  private applyFundingCrossChainResults(results: readonly FundingCrossChainDispatchResult[]): boolean {
    const dispatchedResults = results.filter(result => result.dispatched);
    this.lastMeasuredTopologyDispatchCount += dispatchedResults.length;
    for (const result of dispatchedResults) {
      this.attempts++;
      if (result.settlementConfirmed) { if (result.success) this.settled++; else this.failed++; }
      else if (result.submitted) this.pending++;
      else if (result.error) this.failed++;
    }
    if (dispatchedResults.length > 0) { this.lastDispatchAt = Date.now(); this.lastIdleReason = null; }
    return dispatchedResults.length > 0;
  }
  private async reserveOperatorTrade(opportunityId: string, strategy: string) {
    try {
      const reservation = await operatorTradingStrategy.reserveTrade(opportunityId, strategy);
      this.lastOperatorState = reservation.state;
      if (!reservation.allowed) this.setIdle(operatorIdleReason(reservation.state) || 'operator_trade_in_flight');
      return reservation;
    } catch (error) {
      this.setIdle('operator_trade_in_flight');
      logger.warn('[ExecutionScheduler] Operator parent slot unavailable; trade submission remains fail closed', { component: 'CanonicalExecutionScheduler', opportunityId, strategy, error: error instanceof Error ? error.message : String(error), dailyLimitBypassAllowed: false });
      return null;
    }
  }

  private async dispatchMeasuredTopologies(): Promise<{ dispatched: boolean; submitted: boolean }> {
    try {
      const routed = routeRecentMeasuredOpportunities(1024);
      const ordered = orderSettlementCapableMeasuredDecisionsWithNixGen(routed, 6, Date.now()).decisions;
      const candidates = ordered.filter(decision => decision.admitted && (
        (decision.topology === 'DEX_ATOMIC' && decision.path === 'FLASH_LOAN')
        || (decision.topology === 'LIQUIDATION' && decision.path === 'FLASH_LOAN_LIQUIDATION')
        || (decision.topology === 'CROSS_CHAIN' && decision.path === 'BRIDGE_FLASH_LOAN')
        || (decision.topology === 'FUNDING_ARBITRAGE' && decision.path === 'SPOT_PERP_FUNDING')
      ));
      let anyDispatched = false;
      for (const decision of candidates) {
        const strategy = decision.topology === 'LIQUIDATION' ? 'aave_liquidation'
          : decision.topology === 'DEX_ATOMIC' ? 'dex_0x_atomic_roundtrip'
            : decision.topology === 'CROSS_CHAIN' ? 'across_same_asset_cross_chain'
              : 'okx_spot_perp_funding';
        const reservation = await this.reserveOperatorTrade(decision.opportunityId, strategy);
        if (!reservation || !reservation.allowed || !reservation.reservationId) return { dispatched: anyDispatched, submitted: false };
        const reservationId = reservation.reservationId;
        try {
          if (decision.topology === 'DEX_ATOMIC' || decision.topology === 'LIQUIDATION') {
            const results = await measuredTopologyExecutionAdapter.dispatch([decision]);
            const result = results.find(item => item.opportunityId === decision.opportunityId);
            anyDispatched = this.applyMeasuredTopologyResults(results) || anyDispatched;
            if (!result?.transactionHash) { await operatorTradingStrategy.releaseReservation(reservationId); continue; }
            this.lastOperatorState = await operatorTradingStrategy.markSubmitted(reservationId);
            if (measuredTerminal(result)) await operatorTradingStrategy.markTerminal(reservationId);
            logger.info('[ExecutionScheduler] Measured parent trade consumed operator daily slot', { component: 'CanonicalExecutionScheduler', opportunityId: decision.opportunityId, topology: decision.topology, submissionReference: result.transactionHash, localDate: this.lastOperatorState.localDate, submittedTrades: this.lastOperatorState.submittedTrades, maxTrades: this.lastOperatorState.maxTrades, realizedProfitUsd: this.lastOperatorState.realizedProfitUsd, stopProfitUsd: this.lastOperatorState.stopProfitUsd });
            return { dispatched: true, submitted: true };
          }

          const results = await fundingCrossChainExecutionAdapter.dispatch([decision]);
          const result = results.find(item => item.opportunityId === decision.opportunityId);
          anyDispatched = this.applyFundingCrossChainResults(results) || anyDispatched;
          if (!result?.submitted || !result.submissionReference) { await operatorTradingStrategy.releaseReservation(reservationId); continue; }
          this.lastOperatorState = await operatorTradingStrategy.markSubmitted(reservationId);
          if (result.settlementConfirmed) await operatorTradingStrategy.markTerminal(reservationId);
          logger.info('[ExecutionScheduler] Funding/cross-chain parent trade consumed operator daily slot', { component: 'CanonicalExecutionScheduler', opportunityId: decision.opportunityId, topology: decision.topology, submissionReference: result.submissionReference, lifecycleId: result.lifecycleId, transactionHash: result.transactionHash, localDate: this.lastOperatorState.localDate, submittedTrades: this.lastOperatorState.submittedTrades, maxTrades: this.lastOperatorState.maxTrades, realizedProfitUsd: this.lastOperatorState.realizedProfitUsd, stopProfitUsd: this.lastOperatorState.stopProfitUsd });
          return { dispatched: true, submitted: true };
        } catch (error) {
          await operatorTradingStrategy.releaseReservation(reservationId).catch(() => undefined);
          throw error;
        }
      }
      if (!anyDispatched) this.lastMeasuredTopologyDispatchCount = 0;
      return { dispatched: anyDispatched, submitted: false };
    } catch (error) {
      this.lastMeasuredTopologyDispatchCount = 0;
      logger.error('[ExecutionScheduler] Measured topology adapter failed closed', { component: 'CanonicalExecutionScheduler', error: error instanceof Error ? error.message : String(error), schedulingAuthorityChanged: false });
      return { dispatched: false, submitted: false };
    }
  }

  private async loadOperatorState(): Promise<OperatorTradingStrategyState | null> {
    try {
      const state = await operatorTradingStrategy.getState();
      this.lastOperatorState = state;
      const idleReason = operatorIdleReason(state);
      if (idleReason) {
        this.setIdle(idleReason);
        if (state.learningMode) void operatorTradingStrategy.runLearningDayCycle();
        logger.info('[ExecutionScheduler] Operator strategy intentionally blocks new trade submission', { component: 'CanonicalExecutionScheduler', localDate: state.localDate, cycleStart: state.cycleStart, cycleEnd: state.cycleEnd, dayOffset: state.dayOffset, learningMode: state.learningMode, maxTrades: state.maxTrades, submittedTrades: state.submittedTrades, profitCeilingUsd: state.profitCeilingUsd, stopProfitUsd: state.stopProfitUsd, realizedProfitUsd: state.realizedProfitUsd, reason: state.blockReason, discoveryAndLearningRemainActive: true });
      }
      return state;
    } catch (error) {
      this.setIdle('operator_strategy_unavailable');
      logger.error('[ExecutionScheduler] Durable operator strategy state unavailable; live trade submission fails closed', { component: 'CanonicalExecutionScheduler', error: error instanceof Error ? error.message : String(error), failClosed: true });
      return null;
    }
  }

  private async runDispatch(): Promise<void> {
    // Existing funding positions are risk-management obligations, not new parent
    // trades. Advance/close/reconcile them before any gate that only governs new
    // exposure, including learning days, daily limits and profit stops.
    try {
      await fundingCrossChainExecutionAdapter.advanceOpenFundingLifecycles(4);
    } catch (error) {
      logger.error('[ExecutionScheduler] Existing funding lifecycle maintenance failed closed', { component: 'CanonicalExecutionScheduler', error: error instanceof Error ? error.message : String(error), newExposureGranted: false });
    }

    if (!isLiveExecutionPosture()) { this.setIdle('live_execution_posture_disabled'); return; }
    const runtimeAttestation = getCryptoCrawlerRuntimeAttestation();
    if (!isRuntimeIdentitySafe(runtimeAttestation)) {
      this.setIdle('runtime_identity_mismatch');
      logger.error('[ExecutionScheduler] Live dispatch blocked by runtime identity mismatch', { component: 'CanonicalExecutionScheduler', sourceSha: runtimeAttestation.sourceSha, railwayCommitSha: runtimeAttestation.railwayCommitSha, mismatches: runtimeAttestation.mismatches });
      return;
    }
    const governanceAllowed = endToEndLatencyHarness.measureSync('governance_risk', 'compute', { backend: 'stage_manager', worker: executionResourceScheduler.getOwnerId() }, () => stageManager.canExecuteTrades());
    if (!governanceAllowed) { this.setIdle('governance_stage_blocked'); return; }
    const operatorState = await this.loadOperatorState();
    if (!operatorState || !operatorState.executionAllowed) return;
    const measured = await this.dispatchMeasuredTopologies();
    if (measured.submitted) return;
    const refreshedOperatorState = await this.loadOperatorState();
    if (!refreshedOperatorState || !refreshedOperatorState.executionAllowed) return;

    const retryWindowMs = Math.max(250, Number(process.env.CRYPTOCRAWL_EXECUTION_RETRY_WINDOW_MS || 1_000));
    const now = Date.now();
    const eligibleCandidates = currentCandidates();
    this.lastEligibleCandidateCount = eligibleCandidates.length;
    if (eligibleCandidates.length === 0) { if (!measured.dispatched) this.setIdle('no_eligible_candidates'); return; }
    const candidates = eligibleCandidates.filter(candidate => !this.activeOpportunityIds.has(candidate.opportunityId) && now - (this.lastAttemptAt.get(candidate.opportunityId) || 0) >= retryWindowMs)
      .slice(0, Math.min(dispatchBatchLimit(), Math.max(1, refreshedOperatorState.remainingTrades)));
    this.lastDispatchCandidateCount = candidates.length;
    if (candidates.length === 0) { if (!measured.dispatched) this.setIdle('candidate_retry_window', eligibleCandidates.length, 0, 0); return; }

    this.lastResourceQualifiedCount = 0;
    for (const candidate of candidates) {
      const dimensions = { traceId: candidate.opportunityId, worker: executionResourceScheduler.getOwnerId(), backend: 'cex_resource_scheduler', venue: `${candidate.plan.buyVenue}->${candidate.plan.sellVenue}`, chain: 'cex', symbol: candidate.symbol, strategy: 'verified_cex_arbitrage' };
      const lease: ExecutionResourceLease | null = await endToEndLatencyHarness.measureAsync('resource_lease', 'queue', dimensions, () => executionResourceScheduler.acquireCexPlan(candidate.plan, candidate.opportunityId));
      if (!lease) continue;
      this.lastResourceQualifiedCount += 1;
      const reservation = await this.reserveOperatorTrade(candidate.opportunityId, 'verified_cex_arbitrage');
      if (!reservation || !reservation.allowed || !reservation.reservationId) { await lease.release({ retainOpportunityUntilExpiry: true }); return; }
      const reservationId = reservation.reservationId;
      this.activeOpportunityIds.add(candidate.opportunityId);
      this.lastAttemptAt.set(candidate.opportunityId, Date.now());
      this.attempts++;
      let retainOpportunityUntilExpiry = false;
      let concreteSubmission = false;
      const settlementSpan = endToEndLatencyHarness.startSpan('terminal_settlement', 'network', dimensions);
      try {
        this.lastIdleReason = null;
        this.lastDispatchAt = Date.now();
        logger.info('[ExecutionScheduler] Resource-qualified canonical parent selected under operator strategy', { component: 'CanonicalExecutionScheduler', opportunityId: candidate.opportunityId, symbol: candidate.symbol, buyVenue: candidate.plan.buyVenue, sellVenue: candidate.plan.sellVenue, netProfitUsd: candidate.plan.netProfitUsd, probabilityOfProfitableExecution: candidate.assessment?.probabilityOfProfitableExecution, terminalCalibrationFactor: terminalCalibrationFactor(candidate), leaseId: lease.leaseId, resources: lease.resources, stage: stageManager.getCurrentStage(), localDate: reservation.state.localDate, remainingTrades: reservation.state.remainingTrades, realizedProfitUsd: reservation.state.realizedProfitUsd, stopProfitUsd: reservation.state.stopProfitUsd });
        const result = await executeVerifiedArbitragePlan(candidate.plan, { opportunityId: candidate.opportunityId, source: 'master_pipeline', chain: candidate.plan.bridge?.from, observedSlippageBps: candidate.plan.expectedSlippageBps ?? undefined });
        concreteSubmission = cexHasConcreteSubmission(result);
        if (concreteSubmission) {
          this.lastOperatorState = await operatorTradingStrategy.markSubmitted(reservationId);
          if (terminalResult(result.status, result.settlementConfirmed)) await operatorTradingStrategy.markTerminal(reservationId);
        } else await operatorTradingStrategy.releaseReservation(reservationId);
        settlementSpan.end(settlementLatencyOutcome(result.status, result.settlementConfirmed));
        if (result.success && result.settlementConfirmed) this.settled++;
        else if (!terminalResult(result.status, result.settlementConfirmed)) { this.pending++; retainOpportunityUntilExpiry = true; }
        else this.failed++;
        logger.info('[ExecutionScheduler] Canonical execution attempt completed', { component: 'CanonicalExecutionScheduler', opportunityId: candidate.opportunityId, symbol: candidate.symbol, status: result.status, success: result.success, settlementConfirmed: result.settlementConfirmed, concreteParentSubmission: concreteSubmission, expectedNetProfitUsd: candidate.plan.netProfitUsd, realizedNetProfitUsd: result.normalized?.realized.netProfitUsd ?? null, latencyMs: result.latencyMs, retainOpportunityUntilExpiry, operatorSubmittedTrades: this.lastOperatorState?.submittedTrades ?? reservation.state.submittedTrades, operatorMaxTrades: this.lastOperatorState?.maxTrades ?? reservation.state.maxTrades, operatorRealizedProfitUsd: this.lastOperatorState?.realizedProfitUsd ?? reservation.state.realizedProfitUsd, operatorStopProfitUsd: this.lastOperatorState?.stopProfitUsd ?? reservation.state.stopProfitUsd, error: result.error });
        if (concreteSubmission) return;
      } catch (error) {
        settlementSpan.end('error');
        this.failed++;
        try { this.lastOperatorState = await operatorTradingStrategy.markSubmitted(reservationId); } catch { /* durable reservation remains safety authority */ }
        logger.error('[ExecutionScheduler] Canonical execution attempt failed closed with ambiguous submission state', { component: 'CanonicalExecutionScheduler', opportunityId: candidate.opportunityId, symbol: candidate.symbol, error: error instanceof Error ? error.message : String(error), extraDailyTradeAllowed: false });
        return;
      } finally {
        this.activeOpportunityIds.delete(candidate.opportunityId);
        await lease.release({ retainOpportunityUntilExpiry });
      }
    }
    if (this.lastResourceQualifiedCount === 0 && !measured.dispatched) this.setIdle('no_resource_qualified_candidates', eligibleCandidates.length, candidates.length, 0);
  }
}

export const canonicalExecutionScheduler = new CanonicalExecutionScheduler();
