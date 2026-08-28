export type ZeroXBudgetPurpose = 'discovery' | 'execution';

export interface ZeroXBudgetSnapshot {
  authority: 'local_provider_admission_only';
  executionAuthority: false;
  providerRateLimitClaim: false;
  windowMs: number;
  totalRequestsInWindow: number;
  discoveryRequestsInWindow: number;
  executionRequestsInWindow: number;
  activeRequests: number;
  activeDiscoveryRequests: number;
  activeExecutionRequests: number;
  totalRequestBudget: number;
  discoveryRequestBudget: number;
  maxConcurrentRequests: number;
  discoveryConcurrentBudget: number;
  executionReservedRequests: number;
  executionReservedConcurrentSlots: number;
  discoveryAdmissionsBlocked: number;
  executionAdmissionsBlocked: number;
}

export interface ZeroXBudgetAdmission {
  allowed: boolean;
  purpose: ZeroXBudgetPurpose;
  reason: string;
  release: () => void;
}

interface RequestStamp {
  purpose: ZeroXBudgetPurpose;
  observedAt: number;
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

/**
 * Local 0x admission authority.
 *
 * These limits are process-local safety budgets, not claims about 0x provider
 * quotas. Discovery is intentionally prevented from consuming the execution
 * reserve, while explicit execution requests may use the full local envelope.
 * This module cannot authorize a trade or weaken economics/governance checks.
 */
class ZeroXRequestBudget {
  private readonly stamps: RequestStamp[] = [];
  private activeDiscovery = 0;
  private activeExecution = 0;
  private discoveryAdmissionsBlocked = 0;
  private executionAdmissionsBlocked = 0;

  private readonly windowMs = boundedInteger(process.env.ZEROX_LOCAL_BUDGET_WINDOW_MS, 60_000, 1_000, 60 * 60_000);
  private readonly totalRequestBudget = boundedInteger(process.env.ZEROX_LOCAL_REQUEST_BUDGET, 360, 1, 100_000);
  private readonly executionReservedRequests = boundedInteger(process.env.ZEROX_LOCAL_EXECUTION_RESERVE, 60, 0, this.totalRequestBudget);
  private readonly maxConcurrentRequests = boundedInteger(process.env.ZEROX_LOCAL_MAX_CONCURRENT, 6, 1, 100);
  private readonly executionReservedConcurrentSlots = boundedInteger(
    process.env.ZEROX_LOCAL_EXECUTION_CONCURRENCY_RESERVE,
    1,
    0,
    Math.max(0, this.maxConcurrentRequests - 1),
  );

  private prune(now = Date.now()): void {
    const cutoff = now - this.windowMs;
    while (this.stamps.length > 0 && this.stamps[0].observedAt < cutoff) this.stamps.shift();
  }

  private counts(): { total: number; discovery: number; execution: number } {
    this.prune();
    let discovery = 0;
    let execution = 0;
    for (const stamp of this.stamps) {
      if (stamp.purpose === 'execution') execution += 1;
      else discovery += 1;
    }
    return { total: discovery + execution, discovery, execution };
  }

  tryAcquire(purpose: ZeroXBudgetPurpose): ZeroXBudgetAdmission {
    const counts = this.counts();
    const activeTotal = this.activeDiscovery + this.activeExecution;
    const discoveryRequestBudget = Math.max(0, this.totalRequestBudget - this.executionReservedRequests);
    const discoveryConcurrentBudget = Math.max(0, this.maxConcurrentRequests - this.executionReservedConcurrentSlots);

    let allowed = true;
    let reason = 'local provider admission granted';
    if (counts.total >= this.totalRequestBudget) {
      allowed = false;
      reason = 'local total 0x request budget exhausted';
    } else if (activeTotal >= this.maxConcurrentRequests) {
      allowed = false;
      reason = 'local total 0x concurrency budget exhausted';
    } else if (purpose === 'discovery' && counts.discovery >= discoveryRequestBudget) {
      allowed = false;
      reason = 'local discovery budget withheld to preserve execution reserve';
    } else if (purpose === 'discovery' && this.activeDiscovery >= discoveryConcurrentBudget) {
      allowed = false;
      reason = 'local discovery concurrency withheld to preserve execution reserve';
    }

    if (!allowed) {
      if (purpose === 'execution') this.executionAdmissionsBlocked += 1;
      else this.discoveryAdmissionsBlocked += 1;
      return { allowed: false, purpose, reason, release: () => undefined };
    }

    this.stamps.push({ purpose, observedAt: Date.now() });
    if (purpose === 'execution') this.activeExecution += 1;
    else this.activeDiscovery += 1;
    let released = false;
    return {
      allowed: true,
      purpose,
      reason,
      release: () => {
        if (released) return;
        released = true;
        if (purpose === 'execution') this.activeExecution = Math.max(0, this.activeExecution - 1);
        else this.activeDiscovery = Math.max(0, this.activeDiscovery - 1);
      },
    };
  }

  getSnapshot(): ZeroXBudgetSnapshot {
    const counts = this.counts();
    return {
      authority: 'local_provider_admission_only',
      executionAuthority: false,
      providerRateLimitClaim: false,
      windowMs: this.windowMs,
      totalRequestsInWindow: counts.total,
      discoveryRequestsInWindow: counts.discovery,
      executionRequestsInWindow: counts.execution,
      activeRequests: this.activeDiscovery + this.activeExecution,
      activeDiscoveryRequests: this.activeDiscovery,
      activeExecutionRequests: this.activeExecution,
      totalRequestBudget: this.totalRequestBudget,
      discoveryRequestBudget: Math.max(0, this.totalRequestBudget - this.executionReservedRequests),
      maxConcurrentRequests: this.maxConcurrentRequests,
      discoveryConcurrentBudget: Math.max(0, this.maxConcurrentRequests - this.executionReservedConcurrentSlots),
      executionReservedRequests: this.executionReservedRequests,
      executionReservedConcurrentSlots: this.executionReservedConcurrentSlots,
      discoveryAdmissionsBlocked: this.discoveryAdmissionsBlocked,
      executionAdmissionsBlocked: this.executionAdmissionsBlocked,
    };
  }
}

export const zeroXRequestBudget = new ZeroXRequestBudget();
