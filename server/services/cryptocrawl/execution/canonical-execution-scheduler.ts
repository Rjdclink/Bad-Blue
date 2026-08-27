import logger from '../../../logger.js';
import { canonicalOpportunityState, type CanonicalOpportunitySnapshot } from '../intelligence/canonical-opportunity-state.js';
import { stageManager } from '../governance/stage-management.js';
import { executeVerifiedArbitragePlan } from './index.js';
import { executionResourceScheduler, type ExecutionResourceLease } from './resource-scheduler.js';

export interface CanonicalExecutionSchedulerStats {
  running: boolean;
  ownerId: string;
  active: number;
  attempts: number;
  settled: number;
  pending: number;
  failed: number;
  lastDispatchAt: number | null;
  resourceUsage: Record<string, number>;
}

type Candidate = CanonicalOpportunitySnapshot & { plan: NonNullable<CanonicalOpportunitySnapshot['plan']> };

function isLiveExecutionPosture(): boolean {
  return process.env.NO_EXECUTION !== 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK';
}

function currentCandidates(): Candidate[] {
  const maxQuoteAgeMs = Math.max(250, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000));
  const now = Date.now();
  return canonicalOpportunityState.getRecent(512)
    .filter((snapshot): snapshot is Candidate => !!snapshot.plan)
    .filter(snapshot => snapshot.status === 'eligible')
    .filter(snapshot => snapshot.assessment?.recommendation === 'consider')
    .filter(snapshot => Number.isFinite(snapshot.plan.netProfitUsd) && snapshot.plan.netProfitUsd > 0)
    .filter(snapshot => snapshot.plan.quoteAgeMs <= maxQuoteAgeMs)
    .filter(snapshot => now - snapshot.observedAt <= maxQuoteAgeMs)
    .filter(snapshot => snapshot.governance.killSwitchActive === false)
    .filter(snapshot => snapshot.governance.paused === false)
    .sort((left, right) => {
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
      ownerId: executionResourceScheduler.getOwnerId(),
      authority: 'canonical_eligible_opportunities',
      legacyBusinessCapsAuthoritative: false,
      distributedResourceLeases: true,
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
      resourceUsage: executionResourceScheduler.getLocalUsage(),
    };
  }

  private async runDispatch(): Promise<void> {
    if (!isLiveExecutionPosture()) return;
    if (!stageManager.canExecuteTrades()) return;

    const retryWindowMs = Math.max(1_000, Number(process.env.CRYPTOCRAWL_EXECUTION_RETRY_WINDOW_MS || 10_000));
    const now = Date.now();
    const candidates = currentCandidates().filter(candidate =>
      !this.activeOpportunityIds.has(candidate.opportunityId)
      && now - (this.lastAttemptAt.get(candidate.opportunityId) || 0) >= retryWindowMs,
    );
    if (candidates.length === 0) return;

    const selected: Array<{ candidate: Candidate; lease: ExecutionResourceLease }> = [];
    for (const candidate of candidates) {
      const lease = await executionResourceScheduler.acquireCexPlan(candidate.plan, candidate.opportunityId);
      if (!lease) continue;
      selected.push({ candidate, lease });
    }
    if (selected.length === 0) return;

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
      try {
        const result = await executeVerifiedArbitragePlan(candidate.plan, {
          source: 'master_pipeline',
          chain: candidate.plan.bridge?.from,
          observedSlippageBps: candidate.plan.expectedSlippageBps ?? undefined,
        });

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
