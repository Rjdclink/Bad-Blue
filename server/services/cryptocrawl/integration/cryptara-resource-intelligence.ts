import { quantiComp, quantiParallelismGovernor } from '../../quantiComp/index.js';
import { getProviderQualityAuctionSnapshot } from '../intelligence/provider-quality-auction.js';
import {
  getCryptaraSupabaseAdmissionSnapshot,
  setCryptaraSupabaseRecoveryAdvisor,
} from './cryptara-supabase-admission-worker.js';

export interface CryptaraResourceIntelligenceSnapshot {
  observedAt: number;
  database: {
    mode: 'steady' | 'recovering' | 'pressure';
    pressureScore: number;
    targetConcurrency: number;
    inFlight: number;
    queued: number;
    poolWaiting: number;
    acquireLatencyMs: number;
  };
  compute: {
    utilization: number;
    queuedReservations: number;
    cpuUtilizationPercent: number | null;
    pressureScore: number;
  };
  antenna: {
    observedProviders: number;
    activeProviders: number;
    averageQuality: number;
    averageFailureRate: number;
    signalConfidence: number;
  };
  usefulParallelHeadroom: number;
  dbRecoveryAcceleration: number;
  authority: 'resource_intelligence_advisory_only';
  writeAuthority: false;
  executionAuthority: false;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function fixed(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * Local-only fusion of already-measured telemetry. This function performs no DB,
 * provider, RPC, or network call; it reuses snapshots already held by Cryptara's
 * admission worker, Quanti Comp, and the Sovereign Antenna provider auction.
 *
 * The output is advisory. In particular, provider or compute conditions can never
 * grant database, execution, profitability, settlement, or governance authority.
 */
export function getCryptaraResourceIntelligenceSnapshot(): CryptaraResourceIntelligenceSnapshot {
  const database = getCryptaraSupabaseAdmissionSnapshot();
  const parallelism = quantiParallelismGovernor.getStatus();
  const quantiStatus = quantiComp.getStatus();
  const auction = getProviderQualityAuctionSnapshot();
  const active = auction.bids.filter(bid => !bid.temporarilyDeprioritized);

  const poolOccupancy = database.pool.max > 0
    ? Math.max(0, database.pool.total - database.pool.idle) / database.pool.max
    : 1;
  // Queue depth represents demand, not automatically overload. Scale it against
  // four pool-widths so a small healthy backlog can justify additive recovery,
  // while a deep backlog still blocks advisory acceleration.
  const queuePressure = database.queued > 0
    ? Math.min(1, database.queued / Math.max(1, database.pool.max * 4))
    : 0;
  const waitingPressure = database.pool.waiting > 0 ? 1 : 0;
  const latencyPressure = clamp01(database.ewmaAcquireMs / 1_500);
  // Recovering is not itself pressure; it only means the current target is below
  // the live ceiling. Keep a small bias so acceleration still requires clean DB
  // telemetry instead of being enabled merely by healthy compute/providers.
  const modePressure = database.mode === 'pressure' ? 1 : database.mode === 'recovering' ? 0.15 : 0;
  const databasePressure = clamp01(Math.max(
    waitingPressure,
    modePressure,
    poolOccupancy * 0.65,
    queuePressure,
    latencyPressure * 0.80,
  ));

  const computeUtilization = clamp01(parallelism.utilization);
  const computeQueuePressure = parallelism.queuedReservations > 0
    ? Math.min(1, 0.25 + parallelism.queuedReservations / Math.max(1, parallelism.capacityUnits * 2))
    : 0;
  const cpuPercentRaw = Number(quantiStatus.resource.cpuUtilizationPercent);
  const cpuUtilizationPercent = Number.isFinite(cpuPercentRaw) ? Math.max(0, Math.min(100, cpuPercentRaw)) : null;
  const cpuPressure = cpuUtilizationPercent === null ? 0 : cpuUtilizationPercent / 100;
  const computePressure = clamp01(Math.max(computeUtilization, computeQueuePressure, cpuPressure * 0.85));

  const averageQuality = active.length > 0
    ? active.reduce((sum, bid) => sum + clamp01(bid.qualityScore), 0) / active.length
    : 0;
  const averageFailureRate = auction.bids.length > 0
    ? auction.bids.reduce((sum, bid) => sum + clamp01(bid.failureRate), 0) / auction.bids.length
    : 0;
  const signalConfidence = auction.bids.length > 0
    ? auction.bids.reduce((sum, bid) => sum + Math.min(1, bid.sampleCount / 32), 0) / auction.bids.length
    : 0;

  // Database pressure is deliberately isolated from market/provider parallelism.
  // Healthy compute and provider telemetry can show useful non-DB headroom even
  // when DB admission is contracted, preserving profitable search work.
  const usefulParallelHeadroom = clamp01(
    (1 - databasePressure) * 0.45
    + (1 - computePressure) * 0.30
    + averageQuality * 0.15
    + signalConfidence * 0.10,
  );

  // This advisory can only accelerate additive recovery after DB telemetry itself
  // is clean. It can never force a contraction, skip a pressure cooldown or open
  // more permits than the worker's live pool ceiling.
  const dbRecoveryAcceleration = database.mode === 'recovering'
    && databasePressure < 0.35
    && database.pool.waiting === 0
    ? Math.max(1, Math.min(1.5, 1 + usefulParallelHeadroom * 0.5))
    : 1;

  return {
    observedAt: Date.now(),
    database: {
      mode: database.mode,
      pressureScore: fixed(databasePressure),
      targetConcurrency: database.targetConcurrency,
      inFlight: database.inFlight,
      queued: database.queued,
      poolWaiting: database.pool.waiting,
      acquireLatencyMs: database.ewmaAcquireMs,
    },
    compute: {
      utilization: fixed(computeUtilization),
      queuedReservations: parallelism.queuedReservations,
      cpuUtilizationPercent,
      pressureScore: fixed(computePressure),
    },
    antenna: {
      observedProviders: auction.bids.length,
      activeProviders: active.length,
      averageQuality: fixed(averageQuality),
      averageFailureRate: fixed(averageFailureRate),
      signalConfidence: fixed(signalConfidence),
    },
    usefulParallelHeadroom: fixed(usefulParallelHeadroom),
    dbRecoveryAcceleration: fixed(dbRecoveryAcceleration),
    authority: 'resource_intelligence_advisory_only',
    writeAuthority: false,
    executionAuthority: false,
  };
}

/**
 * Install the local resource advisory into Cryptara's DB governor. The advisor can
 * only reduce the count of already-healthy admissions required before the next
 * +1 permit; the worker remains the sole authority for contraction/cooldown/max.
 */
export function installCryptaraResourceIntelligenceAdvisor(): void {
  setCryptaraSupabaseRecoveryAdvisor(() => {
    const snapshot = getCryptaraResourceIntelligenceSnapshot();
    return snapshot.dbRecoveryAcceleration;
  });
}
