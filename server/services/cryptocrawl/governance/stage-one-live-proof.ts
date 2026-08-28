import logger from '../../../logger.js';
import { Stage, stageManager } from './stage-management.js';

export interface StageOneMeasuredCycleEvidence {
  observedAt: number;
  selectedSymbols: number;
  evaluatedSymbols: number;
  publicDiscoveryObservations: number;
  publicDiscoveryVenues: number;
  economicBarrierStatus: 'unknown' | 'fee_blocked' | 'fee_clear';
  deterministicPositive: number;
  eligibleCandidates: number;
  errorCount: number;
}

let lastSampleAt = 0;
let progressionInFlight: Promise<void> | null = null;

function minimumSampleIntervalMs(): number {
  const parsed = Number(process.env.CRYPTO_STAGE_ONE_LIVE_SAMPLE_INTERVAL_MS || 5_000);
  const value = Number.isFinite(parsed) ? parsed : 5_000;
  return Math.max(2_000, Math.min(60_000, value));
}

function qualifiesAsMeasuredLiveCycle(evidence: StageOneMeasuredCycleEvidence): boolean {
  return evidence.selectedSymbols > 0
    && evidence.evaluatedSymbols > 0
    && evidence.publicDiscoveryObservations > 0
    && evidence.publicDiscoveryVenues >= 2
    && evidence.economicBarrierStatus !== 'unknown';
}

function requestProgressionEvaluation(): void {
  if (progressionInFlight) return;
  progressionInFlight = import('./automatic-stage-progression.js')
    .then(module => module.evaluateAutomaticStageProgression())
    .then(result => {
      logger.info('[StageOneProof] Automatic progression re-evaluated from measured live evidence', {
        component: 'StageOneLiveProof',
        advanced: result.advanced,
        fromStage: result.fromStage,
        toStage: result.toStage ?? null,
        blockers: result.blockers.slice(0, 12),
      });
    })
    .catch(error => {
      logger.warn('[StageOneProof] Automatic progression evaluation unavailable; proof sample retained', {
        component: 'StageOneLiveProof',
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => { progressionInFlight = null; });
}

/**
 * Stage 1 cannot trade, so its existing proof criteria are infrastructure/live-
 * signal criteria: three live samples, >=80% pass rate, and healthy underlying
 * chain readiness. This sampler finally supplies those production samples from
 * independent measured CEX cycles. It never records a trade, settlement, paper
 * P&L, or realized profit and it does not alter any advancement threshold.
 */
export async function recordStageOneMeasuredCycleProof(evidence: StageOneMeasuredCycleEvidence): Promise<void> {
  if (stageManager.getCurrentStage() !== Stage.STAGE_1_CONSTRAINED_PILOT) return;
  const now = Date.now();
  if (!Number.isFinite(evidence.observedAt) || evidence.observedAt <= 0) return;
  if (now - lastSampleAt < minimumSampleIntervalMs()) return;
  lastSampleAt = now;

  const passed = qualifiesAsMeasuredLiveCycle(evidence);
  const chainHealthy = stageManager.isInitialGasReady();
  await stageManager.recordLiveValidation({
    passed,
    chainHealthy,
    timestamp: evidence.observedAt,
  });

  const metrics = stageManager.getState().proofMetrics;
  logger.info('[StageOneProof] Measured live-validation sample recorded', {
    component: 'StageOneLiveProof',
    authority: 'measured_infrastructure_only',
    passed,
    chainHealthy,
    samples: metrics.liveValidationSamples,
    passes: metrics.liveValidationPasses,
    passRate: metrics.liveValidationPassRate,
    meetsAdvancementCriteria: metrics.meetsAdvancementCriteria,
    economicBarrierStatus: evidence.economicBarrierStatus,
    deterministicPositive: evidence.deterministicPositive,
    eligibleCandidates: evidence.eligibleCandidates,
    publicDiscoveryVenues: evidence.publicDiscoveryVenues,
    errorCount: evidence.errorCount,
    tradeEvidenceRecorded: false,
    realizedProfitCredit: false,
    thresholdsChanged: false,
  });

  if (metrics.meetsAdvancementCriteria) requestProgressionEvaluation();
}
