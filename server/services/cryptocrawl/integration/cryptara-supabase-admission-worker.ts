import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { getPoolStats, pool } from '../../../db.js';
import { createLogger } from '../../../logger.js';

/**
 * Autonomous Cryptara pool custodian for CryptoCrawler database work.
 *
 * The custodian is deliberately event-driven: it does nothing while the pool is
 * healthy, then automatically queues, ranks, contracts and recovers when measured
 * pressure appears. It never asks the operator what to do and never creates a
 * second database pool or expands the configured connection budget.
 *
 * Boundary rules:
 * - creates no database pool and consumes no connection by itself;
 * - never touches the session-capable coordination pool;
 * - never grants execution, governance, profitability, or write authority;
 * - queues rather than drops work, so pressure reduction cannot remove capability;
 * - adapts only from measured local pool/acquisition outcomes;
 * - full utilization alone is capacity use, not pressure;
 * - the hot Overflow ordinary pool is governed automatically;
 * - explicit cold-archive work may join the same ranked permit queue without
 *   registering or globally intercepting the application's Primary pool.
 *
 * The worker gates Pool.connect() for the live exported ordinary pool. Because
 * node-postgres Pool.query() also acquires through Pool.connect(), existing hot
 * callers automatically share one admission surface without invasive rewrites.
 */

export type CryptaraSupabasePriority = 'critical' | 'high' | 'normal' | 'low';

type Waiter = {
  id: number;
  priority: CryptaraSupabasePriority;
  queuedAt: number;
  resolve: (permit: AdmissionPermit) => void;
};

type AdmissionPermit = {
  release: (error?: unknown, heldMs?: number) => void;
};

type RecoveryAdvisor = () => number;

type PoolStats = {
  total: number;
  idle: number;
  waiting: number;
  max: number;
};

export interface CryptaraSupabaseAdmissionSnapshot {
  installed: boolean;
  governor: 'cryptara';
  authority: 'resource_admission_only';
  writeAuthority: false;
  executionAuthority: false;
  mode: 'steady' | 'recovering' | 'pressure';
  targetConcurrency: number;
  inFlight: number;
  queued: number;
  pool: PoolStats;
  ewmaAcquireMs: number;
  ewmaHoldMs: number;
  pressureCooldownMs: number;
  admissionFailures: number;
  peakQueued: number;
}

const log = createLogger('CryptaraSupabaseAdmissionWorker');
const priorityContext = new AsyncLocalStorage<CryptaraSupabasePriority>();
const PRIORITY_RANK: Record<CryptaraSupabasePriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const EWMA_ALPHA = 0.20;
const AGE_PROMOTION_MS = Math.max(250, Math.min(10_000, Number(process.env.CRYPTARA_DB_PRIORITY_AGE_MS || 2_000)));
const HEALTHY_ACQUIRE_MS = Math.max(25, Math.min(2_000, Number(process.env.CRYPTARA_DB_HEALTHY_ACQUIRE_MS || 350)));
const PRESSURE_ACQUIRE_MS = Math.max(250, Math.min(15_000, Number(process.env.CRYPTARA_DB_PRESSURE_ACQUIRE_MS || 1_500)));
const PRESSURE_HOLD_MS = Math.max(1_000, Math.min(60_000, Number(process.env.CRYPTARA_DB_PRESSURE_HOLD_MS || 7_500)));
const MIN_COOLDOWN_MS = Math.max(250, Math.min(10_000, Number(process.env.CRYPTARA_DB_MIN_COOLDOWN_MS || 1_500)));
const MAX_COOLDOWN_MS = Math.max(MIN_COOLDOWN_MS, Math.min(30_000, Number(process.env.CRYPTARA_DB_MAX_COOLDOWN_MS || 6_000)));
const HEALTHY_SUCCESSES_TO_GROW = Math.max(2, Math.min(32, Number(process.env.CRYPTARA_DB_HEALTHY_SUCCESSES_TO_GROW || 3)));

let recoveryAdvisor: RecoveryAdvisor | null = null;

function finiteNonNegative(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function boundedRecoveryAcceleration(): number {
  if (!recoveryAdvisor) return 1;
  try {
    const value = Number(recoveryAdvisor());
    return Number.isFinite(value) ? Math.max(1, Math.min(1.5, value)) : 1;
  } catch {
    return 1;
  }
}

function jitterMs(minMs: number, maxMs: number): number {
  const lo = Math.max(0, Math.min(minMs, maxMs));
  const hi = Math.max(lo, maxMs);
  return lo + Math.floor(Math.random() * Math.max(1, hi - lo + 1));
}

function errorText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: any = error;
  for (let depth = 0; current != null && depth < 6 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (current instanceof Error && current.message) parts.push(current.message);
    else if (typeof current === 'string') parts.push(current);
    if (current && typeof current === 'object' && current.code) parts.push(String(current.code));
    current = current && typeof current === 'object' ? current.cause : null;
  }
  return parts.join(' | ').toLowerCase();
}

function isAdmissionPressureError(error: unknown): boolean {
  if (!error) return false;
  const text = errorText(error);
  const timeoutContext = text.includes('timeout') || text.includes('timed out') || text.includes('connection terminated');
  return text.includes('53300') ||
    text.includes('57p03') ||
    text.includes('etimedout') ||
    text.includes('max_client_conn') ||
    text.includes('too many clients') ||
    text.includes('too many connections') ||
    text.includes('remaining connection slots') ||
    text.includes('failed to connect to database: {:error, :timeout}') ||
    text.includes('connection terminated due to connection timeout') ||
    (text.includes('08006') && timeoutContext);
}

class CryptaraSupabaseResourceGovernor {
  private queue: Waiter[] = [];
  private nextWaiterId = 1;
  private inFlight = 0;
  private targetConcurrency = 1;
  private ewmaAcquireMs = 0;
  private ewmaHoldMs = 0;
  private healthySuccesses = 0;
  private pressureUntil = 0;
  private pressureResumeTimer: NodeJS.Timeout | null = null;
  private admissionFailures = 0;
  private peakQueued = 0;
  private lastMode: CryptaraSupabaseAdmissionSnapshot['mode'] = 'recovering';
  private lastPressureReason: string | null = null;

  private poolSnapshot(): PoolStats {
    try {
      const stats = getPoolStats();
      return {
        total: finiteNonNegative(stats.total),
        idle: finiteNonNegative(stats.idle),
        waiting: finiteNonNegative(stats.waiting),
        max: Math.max(1, Math.trunc(finiteNonNegative(stats.max) || 1)),
      };
    } catch {
      return { total: 0, idle: 0, waiting: 0, max: 1 };
    }
  }

  private mode(now = Date.now()): CryptaraSupabaseAdmissionSnapshot['mode'] {
    const stats = this.poolSnapshot();
    if (now < this.pressureUntil || stats.waiting > 0) return 'pressure';
    if (this.targetConcurrency < stats.max) return 'recovering';
    return 'steady';
  }

  primeToCurrentPoolCapacity(): void {
    const stats = this.poolSnapshot();
    const ceiling = stats.max;
    this.healthySuccesses = 0;

    // Start at the already-configured safe pool ceiling. Only measured existing
    // waiters justify a contracted cold start. Merely having every pool client in
    // use is healthy capacity utilization and must not be treated as an incident.
    if (stats.waiting > 0) {
      this.targetConcurrency = Math.max(1, Math.floor(ceiling / 2));
      this.pressureUntil = Date.now() + this.pressureCooldown();
      this.lastMode = 'pressure';
      this.lastPressureReason = 'startup_pool_waiters';
      return;
    }

    this.targetConcurrency = ceiling;
    this.pressureUntil = 0;
    this.lastMode = 'steady';
    this.lastPressureReason = null;
  }

  private updateEwma(current: number, sample: number): number {
    if (!Number.isFinite(sample) || sample < 0) return current;
    if (current <= 0) return sample;
    return current * (1 - EWMA_ALPHA) + sample * EWMA_ALPHA;
  }

  private pressureCooldown(): number {
    return jitterMs(MIN_COOLDOWN_MS, MAX_COOLDOWN_MS);
  }

  private schedulePressureResume(now = Date.now()): void {
    if (this.pressureResumeTimer || this.queue.length === 0) return;
    const delayMs = Math.max(1, this.pressureUntil - now);
    this.pressureResumeTimer = setTimeout(() => {
      this.pressureResumeTimer = null;
      this.drain();
    }, delayMs);
    this.pressureResumeTimer.unref?.();
  }

  private contract(reason: string): void {
    const previous = this.targetConcurrency;
    const next = Math.max(1, Math.floor(previous / 2));
    this.targetConcurrency = next;
    this.healthySuccesses = 0;
    this.pressureUntil = Math.max(this.pressureUntil, Date.now() + this.pressureCooldown());

    // One warning per actual transition/reason. Healthy full utilization never
    // enters this path, which prevents expected queueing from becoming Railway red.
    if (previous !== next || this.lastMode !== 'pressure' || this.lastPressureReason !== reason) {
      log.warn('[CRYPTARA][SUPABASE-WORKER] measured pressure; autonomous contraction applied', {
        reason,
        previousConcurrency: previous,
        targetConcurrency: next,
        queued: this.queue.length,
        inFlight: this.inFlight,
        pool: this.poolSnapshot(),
      });
    }
    this.lastMode = 'pressure';
    this.lastPressureReason = reason;
  }

  private considerRecovery(acquireMs: number): void {
    const now = Date.now();
    const stats = this.poolSnapshot();
    const ceiling = stats.max;
    this.targetConcurrency = Math.max(1, Math.min(this.targetConcurrency, ceiling));

    // Actual node-postgres waiters or slow acquisition prove contention. A pool
    // with total=max, idle=0 and a local queue does not: the local queue is the
    // custodian doing its job and should not trigger multiplicative backoff.
    if (stats.waiting > 0) {
      this.contract('pool_waiters');
      return;
    }
    if (acquireMs >= PRESSURE_ACQUIRE_MS) {
      this.contract('slow_admission');
      return;
    }

    if (now < this.pressureUntil) {
      this.healthySuccesses = 0;
      return;
    }

    const healthy = acquireMs <= HEALTHY_ACQUIRE_MS;
    if (!healthy) {
      this.healthySuccesses = 0;
      return;
    }

    this.healthySuccesses += 1;
    const recoveryAcceleration = boundedRecoveryAcceleration();
    const healthySuccessThreshold = Math.max(2, Math.ceil(HEALTHY_SUCCESSES_TO_GROW / recoveryAcceleration));
    if (this.healthySuccesses < healthySuccessThreshold || this.targetConcurrency >= ceiling) {
      this.lastMode = this.mode(now);
      if (this.lastMode === 'steady') this.lastPressureReason = null;
      return;
    }

    const previous = this.targetConcurrency;
    this.targetConcurrency = Math.min(ceiling, previous + 1);
    this.healthySuccesses = 0;
    if (previous !== this.targetConcurrency) {
      log.info('[CRYPTARA][SUPABASE-WORKER] healthy evidence restored one concurrency permit', {
        previousConcurrency: previous,
        targetConcurrency: this.targetConcurrency,
        pool: stats,
        healthyEvidenceRequired: healthySuccessThreshold,
        recoveryAdvisor: Number(recoveryAcceleration.toFixed(2)),
      });
    }
    this.lastMode = this.mode(now);
    if (this.lastMode === 'steady') this.lastPressureReason = null;
  }

  private effectiveRank(waiter: Waiter, now: number): number {
    const agePromotions = Math.floor(Math.max(0, now - waiter.queuedAt) / AGE_PROMOTION_MS);
    return Math.max(0, PRIORITY_RANK[waiter.priority] - agePromotions);
  }

  private nextWaiterIndex(): number {
    if (this.queue.length <= 1) return 0;
    const now = Date.now();
    let bestIndex = 0;
    let bestRank = this.effectiveRank(this.queue[0], now);
    for (let index = 1; index < this.queue.length; index += 1) {
      const rank = this.effectiveRank(this.queue[index], now);
      if (rank < bestRank || (rank === bestRank && this.queue[index].id < this.queue[bestIndex].id)) {
        bestIndex = index;
        bestRank = rank;
      }
    }
    return bestIndex;
  }

  private observeRelease(error: unknown, heldMs: number): void {
    if (heldMs > 0) this.ewmaHoldMs = this.updateEwma(this.ewmaHoldMs, heldMs);
    if (isAdmissionPressureError(error)) {
      this.admissionFailures += 1;
      this.contract('upstream_query_or_release_error');
      return;
    }
    if (heldMs >= PRESSURE_HOLD_MS && this.queue.length > 0) {
      this.contract('sustained_checkout');
    }
  }

  private drain(): void {
    const stats = this.poolSnapshot();
    const ceiling = stats.max;
    this.targetConcurrency = Math.max(1, Math.min(this.targetConcurrency, ceiling));

    const now = Date.now();
    const pressureActive = now < this.pressureUntil;
    if (this.queue.length > 0 && pressureActive && stats.idle === 0) {
      this.schedulePressureResume(now);
      return;
    }

    const targetSlots = Math.max(0, this.targetConcurrency - this.inFlight);
    const admissionBudget = pressureActive
      ? Math.min(targetSlots, Math.max(0, stats.idle))
      : targetSlots;
    let admitted = 0;

    while (admitted < admissionBudget && this.queue.length > 0) {
      const index = this.nextWaiterIndex();
      const waiter = this.queue.splice(index, 1)[0];
      this.inFlight += 1;
      admitted += 1;
      let released = false;
      waiter.resolve({
        release: (error?: unknown, heldMs?: number) => {
          if (released) return;
          released = true;
          this.inFlight = Math.max(0, this.inFlight - 1);
          this.observeRelease(error, finiteNonNegative(heldMs));
          this.drain();
        },
      });
    }
  }

  acquire(priority: CryptaraSupabasePriority): Promise<AdmissionPermit> {
    return new Promise(resolve => {
      this.queue.push({ id: this.nextWaiterId++, priority, queuedAt: Date.now(), resolve });
      this.peakQueued = Math.max(this.peakQueued, this.queue.length);
      this.drain();
    });
  }

  reportConnectionOutcome(acquireMs: number, error?: unknown): void {
    const duration = finiteNonNegative(acquireMs);
    this.ewmaAcquireMs = this.updateEwma(this.ewmaAcquireMs, duration);
    if (isAdmissionPressureError(error)) {
      this.admissionFailures += 1;
      this.contract('connection_acquisition_error');
      return;
    }
    if (!error) this.considerRecovery(duration);
  }

  snapshot(installed: boolean): CryptaraSupabaseAdmissionSnapshot {
    const now = Date.now();
    const stats = this.poolSnapshot();
    return {
      installed,
      governor: 'cryptara',
      authority: 'resource_admission_only',
      writeAuthority: false,
      executionAuthority: false,
      mode: this.mode(now),
      targetConcurrency: this.targetConcurrency,
      inFlight: this.inFlight,
      queued: this.queue.length,
      pool: stats,
      ewmaAcquireMs: Number(this.ewmaAcquireMs.toFixed(2)),
      ewmaHoldMs: Number(this.ewmaHoldMs.toFixed(2)),
      pressureCooldownMs: Math.max(0, this.pressureUntil - now),
      admissionFailures: this.admissionFailures,
      peakQueued: this.peakQueued,
    };
  }
}

const governor = new CryptaraSupabaseResourceGovernor();
const ORIGINAL_CONNECT = Symbol.for('badblue.cryptara.supabase.originalConnect');
const PATCHED_CONNECT = Symbol.for('badblue.cryptara.supabase.patchedConnect');
let installed = false;

function wrapClientRelease(
  client: any,
  originalRelease: (error?: unknown) => void,
  permit: AdmissionPermit,
  checkedOutAt: number,
): (error?: unknown) => void {
  let released = false;
  const wrappedRelease = (error?: unknown) => {
    // Preserve node-postgres double-release behavior instead of hiding a caller
    // bug; only the custodian permit itself is protected from double release.
    if (released) {
      originalRelease(error);
      return;
    }
    released = true;
    try {
      originalRelease(error);
    } finally {
      permit.release(error, Date.now() - checkedOutAt);
    }
  };
  client.release = wrappedRelease;
  return wrappedRelease;
}

/** Install once after schema/migration admission and before heavyweight routes. */
export function installCryptaraSupabaseAdmissionWorker(): void {
  if (installed) return;
  const prototype: any = (pg as any).Pool.prototype;
  if (!prototype[ORIGINAL_CONNECT]) prototype[ORIGINAL_CONNECT] = prototype.connect;
  const originalConnect = prototype[ORIGINAL_CONNECT] as (...args: any[]) => any;

  if (!prototype.connect?.[PATCHED_CONNECT]) {
    const patchedConnect = function(this: any, callback?: (...args: any[]) => void): any {
      // The live ESM binding tracks resetPool() replacements. Coordination and any
      // unrelated pg pools bypass this custodian completely.
      if (this !== pool) {
        return typeof callback === 'function' ? originalConnect.call(this, callback) : originalConnect.call(this);
      }

      const priority: CryptaraSupabasePriority = priorityContext.getStore() || 'normal';

      if (typeof callback === 'function') {
        void governor.acquire(priority).then(permit => {
          const acquisitionStartedAt = Date.now();
          try {
            originalConnect.call(this, (error: unknown, client: any, release: (error?: unknown) => void) => {
              const acquireMs = Date.now() - acquisitionStartedAt;
              governor.reportConnectionOutcome(acquireMs, error);
              if (error || !client) {
                permit.release(undefined, 0);
                callback(error, client, release);
                return;
              }
              const wrappedRelease = wrapClientRelease(client, release, permit, Date.now());
              callback(null, client, wrappedRelease);
            });
          } catch (error) {
            permit.release(undefined, 0);
            throw error;
          }
        }).catch(error => callback(error));
        return undefined;
      }

      return governor.acquire(priority).then(async permit => {
        const acquisitionStartedAt = Date.now();
        try {
          const client = await originalConnect.call(this);
          governor.reportConnectionOutcome(Date.now() - acquisitionStartedAt);
          const release = client.release.bind(client);
          wrapClientRelease(client, release, permit, Date.now());
          return client;
        } catch (error) {
          governor.reportConnectionOutcome(Date.now() - acquisitionStartedAt, error);
          permit.release(undefined, 0);
          throw error;
        }
      });
    };
    (patchedConnect as any)[PATCHED_CONNECT] = true;
    prototype.connect = patchedConnect;
  }

  governor.primeToCurrentPoolCapacity();
  installed = true;
  const snapshot = governor.snapshot(true);
  log.info('[CRYPTARA][SUPABASE-WORKER] autonomous pool custodian installed', {
    ordinaryPoolOnly: true,
    additionalPoolCreated: false,
    additionalConnectionBudget: 0,
    operatorPromptsRequired: false,
    interventionPolicy: 'measured_pressure_only',
    initialConcurrency: snapshot.targetConcurrency,
    poolMax: snapshot.pool.max,
  });
}

/**
 * Explicit priority is optional. Existing hot-pool users are governed automatically;
 * critical callers can use this helper without receiving any new DB authority.
 */
export function withCryptaraSupabasePriority<T>(
  priority: CryptaraSupabasePriority,
  task: () => T,
): T {
  return priorityContext.run(priority, task);
}

/**
 * Join the same ranked Cryptara admission queue for a deliberately explicit task
 * that does not use the automatically governed hot pool (for example a Primary
 * cold-archive query). This does not register or patch the task's underlying pool.
 */
export async function withCryptaraSupabaseAdmission<T>(
  priority: CryptaraSupabasePriority,
  task: () => Promise<T> | T,
): Promise<T> {
  const permit = await governor.acquire(priority);
  const startedAt = Date.now();
  let failure: unknown;
  try {
    return await priorityContext.run(priority, task);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    permit.release(failure, Date.now() - startedAt);
  }
}

/**
 * Optional advisory recovery acceleration. It can only shorten the number of
 * already-healthy samples needed to restore one permit and is clamped to 1..1.5.
 */
export function setCryptaraSupabaseRecoveryAdvisor(advisor: RecoveryAdvisor | null): void {
  recoveryAdvisor = advisor;
}

export function getCryptaraSupabaseAdmissionSnapshot(): CryptaraSupabaseAdmissionSnapshot {
  return governor.snapshot(installed);
}
