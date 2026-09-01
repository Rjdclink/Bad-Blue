import { quantiDataFabric } from '../../quantiComp/dataFabric.js';

export type CryptaraSupabaseDataPath = 'normal' | 'comp';

export interface CryptaraSupabaseAdmissionSignal {
  mode: 'steady' | 'recovering' | 'pressure';
  targetConcurrency: number;
  inFlight: number;
  queued: number;
  pool: {
    total: number;
    idle: number;
    waiting: number;
    max: number;
  };
  ewmaAcquireMs: number;
  ewmaHoldMs: number;
  pressureCooldownMs: number;
  admissionFailures: number;
}

export interface CryptaraSupabaseCompPolicy {
  sharedFreshnessMultiplier: number;
  backgroundPollMultiplier: number;
  observabilityMultiplier: number;
  preferBatching: boolean;
  dropWork: false;
  criticalDurabilityAlwaysDirect: true;
}

export interface CryptaraSupabaseCompSwitchSnapshot {
  observedAt: number;
  changedAt: number;
  path: CryptaraSupabaseDataPath;
  reason: string;
  pressureScore: number;
  healthyObservations: number;
  transitions: number;
  admissionFailuresSeen: number;
  policy: CryptaraSupabaseCompPolicy;
  authority: 'resource_path_selection_only';
  writeAuthority: false;
  executionAuthority: false;
}

function boundedNumber(raw: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(raw);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

const ENTER_SCORE = boundedNumber(process.env.CRYPTARA_SUPABASE_COMP_ENTER_SCORE, 0.60, 0.35, 0.95);
const EXIT_SCORE = Math.min(
  ENTER_SCORE - 0.10,
  boundedNumber(process.env.CRYPTARA_SUPABASE_COMP_EXIT_SCORE, 0.25, 0.05, 0.60),
);
const ENTER_ACQUIRE_MS = boundedNumber(process.env.CRYPTARA_SUPABASE_COMP_ENTER_ACQUIRE_MS, 1_200, 250, 15_000);
const EXIT_ACQUIRE_MS = Math.min(
  ENTER_ACQUIRE_MS,
  boundedNumber(process.env.CRYPTARA_SUPABASE_COMP_EXIT_ACQUIRE_MS, 400, 25, 2_000),
);
const MIN_COMP_RESIDENCY_MS = boundedNumber(process.env.CRYPTARA_SUPABASE_COMP_MIN_RESIDENCY_MS, 8_000, 1_000, 120_000);
const HEALTHY_OBSERVATIONS_TO_EXIT = Math.floor(
  boundedNumber(process.env.CRYPTARA_SUPABASE_COMP_HEALTHY_OBSERVATIONS, 6, 2, 64),
);

const NORMAL_POLICY: CryptaraSupabaseCompPolicy = {
  sharedFreshnessMultiplier: 1,
  backgroundPollMultiplier: 1,
  observabilityMultiplier: 1,
  preferBatching: false,
  dropWork: false,
  criticalDurabilityAlwaysDirect: true,
};

const COMP_POLICY: CryptaraSupabaseCompPolicy = {
  // Reuse only within each information class's already-defined semantic maximum.
  // The Super Worker still keeps execution_truth at zero retention.
  sharedFreshnessMultiplier: 3,
  // Background/observability work becomes less chatty while the DB is throttled.
  backgroundPollMultiplier: 4,
  observabilityMultiplier: 4,
  preferBatching: true,
  dropWork: false,
  criticalDurabilityAlwaysDirect: true,
};

let path: CryptaraSupabaseDataPath = 'normal';
let reason = 'healthy_start';
let changedAt = Date.now();
let observedAt = changedAt;
let pressureScore = 0;
let healthyObservations = 0;
let transitions = 0;
let admissionFailuresSeen = 0;

function policyFor(current: CryptaraSupabaseDataPath): CryptaraSupabaseCompPolicy {
  return current === 'comp' ? COMP_POLICY : NORMAL_POLICY;
}

function publishTransition(signal: CryptaraSupabaseAdmissionSignal): void {
  try {
    quantiDataFabric.publishFloat64State('cryptara-super-worker:supabase-comp-switch', [
      path === 'comp' ? 1 : 0,
      pressureScore,
      Math.max(0, signal.ewmaAcquireMs),
      Math.max(0, signal.ewmaHoldMs),
      Math.max(0, signal.queued),
      Math.max(0, signal.pool.waiting),
      Math.max(0, signal.targetConcurrency),
      Math.max(0, signal.pool.max),
    ]);
  } catch {
    // Resource telemetry must never become a runtime dependency.
  }
}

function transition(next: CryptaraSupabaseDataPath, nextReason: string, signal: CryptaraSupabaseAdmissionSignal): void {
  if (path === next) return;
  path = next;
  reason = nextReason;
  changedAt = Date.now();
  healthyObservations = 0;
  transitions += 1;
  publishTransition(signal);
  console.log(`[CRYPTARA][SUPABASE-SWITCH] path=${path}; reason=${reason}; pressure=${pressureScore.toFixed(3)}; acquireMs=${Math.max(0, signal.ewmaAcquireMs).toFixed(1)}; queued=${signal.queued}; waiters=${signal.pool.waiting}`);
}

function score(signal: CryptaraSupabaseAdmissionSignal): { value: number; hardPressure: boolean; reason: string } {
  const poolWidth = Math.max(1, Number(signal.pool.max) || 1);
  const failureIncrease = Math.max(0, Number(signal.admissionFailures || 0) - admissionFailuresSeen);
  const queuePressure = clamp01(Number(signal.queued || 0) / Math.max(1, poolWidth * 2));
  const latencyPressure = clamp01(Number(signal.ewmaAcquireMs || 0) / ENTER_ACQUIRE_MS);
  const holdPressure = clamp01(Number(signal.ewmaHoldMs || 0) / 7_500);
  const contractionPressure = Number(signal.targetConcurrency || 0) < poolWidth ? 0.35 : 0;
  const cooldownPressure = Number(signal.pressureCooldownMs || 0) > 0 ? 0.85 : 0;
  const modePressure = signal.mode === 'pressure' ? 1 : signal.mode === 'recovering' ? 0.30 : 0;
  const waitingPressure = Number(signal.pool.waiting || 0) > 0 ? 1 : 0;
  const failurePressure = failureIncrease > 0 ? 1 : 0;

  const value = clamp01(Math.max(
    modePressure,
    waitingPressure,
    failurePressure,
    cooldownPressure,
    latencyPressure,
    queuePressure * 0.90,
    holdPressure * 0.65,
    contractionPressure,
  ));

  if (failureIncrease > 0) return { value, hardPressure: true, reason: 'admission_failure' };
  if (signal.mode === 'pressure') return { value, hardPressure: true, reason: 'admission_pressure' };
  if (Number(signal.pool.waiting || 0) > 0) return { value, hardPressure: true, reason: 'pool_waiters' };
  if (Number(signal.ewmaAcquireMs || 0) >= ENTER_ACQUIRE_MS) return { value, hardPressure: true, reason: 'slow_admission' };
  if (Number(signal.pressureCooldownMs || 0) > 0) return { value, hardPressure: true, reason: 'pressure_cooldown' };
  if (value >= ENTER_SCORE) return { value, hardPressure: false, reason: 'rising_database_pressure' };
  return { value, hardPressure: false, reason: 'healthy' };
}

export function observeCryptaraSupabaseCompSwitch(
  signal: CryptaraSupabaseAdmissionSignal,
): CryptaraSupabaseCompSwitchSnapshot {
  observedAt = Date.now();
  const scored = score(signal);
  pressureScore = scored.value;
  admissionFailuresSeen = Math.max(admissionFailuresSeen, Number(signal.admissionFailures || 0));

  if (path === 'normal') {
    if (scored.hardPressure || scored.value >= ENTER_SCORE) {
      transition('comp', scored.reason, signal);
    } else {
      reason = scored.reason;
      healthyObservations = 0;
    }
    return getCryptaraSupabaseCompSwitchSnapshot();
  }

  const healthy = signal.mode === 'steady'
    && Number(signal.pool.waiting || 0) === 0
    && Number(signal.pressureCooldownMs || 0) <= 0
    && Number(signal.ewmaAcquireMs || 0) <= EXIT_ACQUIRE_MS
    && scored.value <= EXIT_SCORE;

  if (!healthy) {
    healthyObservations = 0;
    reason = scored.reason === 'healthy' ? 'recovering_database' : scored.reason;
    return getCryptaraSupabaseCompSwitchSnapshot();
  }

  healthyObservations += 1;
  reason = 'healthy_recovery_evidence';
  if (
    observedAt - changedAt >= MIN_COMP_RESIDENCY_MS
    && healthyObservations >= HEALTHY_OBSERVATIONS_TO_EXIT
  ) {
    transition('normal', 'healthy_database_recovered', signal);
  }

  return getCryptaraSupabaseCompSwitchSnapshot();
}

/**
 * Refresh from the admission worker's already-measured local telemetry. Dynamic
 * import avoids pulling the DB module into no-database Super Worker tests and does
 * not perform a query or create a connection.
 */
export async function refreshCryptaraSupabaseCompSwitch(): Promise<CryptaraSupabaseCompSwitchSnapshot> {
  const { getCryptaraSupabaseAdmissionSnapshot } = await import('./cryptara-supabase-admission-worker.js');
  return observeCryptaraSupabaseCompSwitch(getCryptaraSupabaseAdmissionSnapshot());
}

export function getCryptaraSupabaseCompSwitchSnapshot(): CryptaraSupabaseCompSwitchSnapshot {
  return {
    observedAt,
    changedAt,
    path,
    reason,
    pressureScore: Number(pressureScore.toFixed(6)),
    healthyObservations,
    transitions,
    admissionFailuresSeen,
    policy: { ...policyFor(path) },
    authority: 'resource_path_selection_only',
    writeAuthority: false,
    executionAuthority: false,
  };
}
