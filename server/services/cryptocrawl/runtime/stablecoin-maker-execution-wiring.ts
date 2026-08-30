import logger from '../../../logger.js';
import {
  CentralizedExchangeExecutor,
  centralizedExchangeExecutor,
  type ArbitrageExecutionResult,
} from '../execution/centralized-exchange-executor.js';
import { createPostOnlyMakerAdapters } from '../execution/post-only-maker-adapters.js';
import { getMakerLifecycleTraceId } from '../execution/maker-lifecycle-trace.js';
import { isMakerRecoveryPlan } from '../execution/stablecoin-maker-strategy.js';
import { getMakerPaperProofStats } from '../intelligence/maker-microstructure-proof.js';
import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';

let installed = false;

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function adaptiveSettlementTtlMs(
  configuredTtlMs: number,
  jointFillProbability: number,
  stressPersistenceProbability: number,
): { ttlMs: number; sampleCount: number; paperFillRate: number | null } {
  const hardMax = Math.max(2_000, Math.min(30_000, Number.isFinite(configuredTtlMs) ? configuredTtlMs : 30_000));
  const stats = getMakerPaperProofStats();
  const terminal = stats.completed + stats.expired + stats.partial;
  const historicalFillRate = terminal >= 10 ? stats.completed / Math.max(1, terminal) : null;
  const historyFactor = historicalFillRate === null ? 1 : 0.35 + 0.65 * Math.max(0, Math.min(1, historicalFillRate));
  const jointFillFactor = 0.55 + 0.45 * Math.max(0, Math.min(1, jointFillProbability));
  const persistenceFactor = 0.65 + 0.35 * Math.max(0, Math.min(1, stressPersistenceProbability));
  const learned = Math.round(hardMax * historyFactor * jointFillFactor * persistenceFactor);
  return {
    ttlMs: Math.max(2_000, Math.min(hardMax, learned)),
    sampleCount: terminal,
    paperFillRate: historicalFillRate,
  };
}

function rejectResult(reason: string): ArbitrageExecutionResult {
  return {
    success: false,
    status: 'rejected',
    settlementConfirmed: false,
    error: reason,
  } as ArbitrageExecutionResult;
}

function executionGuard(plan: ReturnType<typeof asMakerPlan>): string | null {
  const execution = plan.makerExecution;
  if (execution.feeAuthority !== 'authenticated') return 'REJECT_MAKER_EXECUTION_FEE_AUTHORITY';
  if (!(plan.notionalUsd > 0) || plan.notionalUsd > execution.canaryCeilingUsd + 1e-9) return 'REJECT_MAKER_EXECUTION_CANARY_CEILING';
  if (execution.queueEcho.authority === 'measured_history') {
    const minJointFill = bounded(process.env.CRYPTO_ARBITRAGE_MAKER_EXECUTION_MIN_JOINT_FILL, 0.20, 0.05, 0.95);
    if (execution.queueEcho.jointFillProbability < minJointFill) return 'REJECT_MAKER_EXECUTION_FILL_PROBABILITY';
  }
  const minStressPersistence = bounded(process.env.CRYPTO_ARBITRAGE_MAKER_EXECUTION_MIN_STRESS_PERSISTENCE, 0.35, 0.05, 0.95);
  if (execution.spreadStress.paths > 0 && execution.spreadStress.persistenceProbability < minStressPersistence) {
    return 'REJECT_MAKER_EXECUTION_SPREAD_PERSISTENCE';
  }
  const maxQueueClearSeconds = bounded(process.env.CRYPTO_ARBITRAGE_MAKER_MAX_QUEUE_CLEAR_SECONDS, 20, 1, 120);
  const queueClears = [execution.queueEcho.buyQueueClearSeconds, execution.queueEcho.sellQueueClearSeconds]
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (queueClears.some(value => value > maxQueueClearSeconds)) return 'REJECT_MAKER_EXECUTION_QUEUE_CLEAR_TIME';
  if (execution.fractionalKelly.applied && execution.fractionalKelly.recommendedNotionalUsd !== null
      && plan.notionalUsd > execution.fractionalKelly.recommendedNotionalUsd * 1.05) {
    return 'REJECT_MAKER_EXECUTION_KELLY_SIZE';
  }
  return null;
}

function asMakerPlan(plan: VerifiedArbitragePlan) {
  if (!isMakerRecoveryPlan(plan)) throw new Error('maker plan required');
  return plan;
}

export function ensureStablecoinMakerExecutionWiring(): void {
  if (installed) return;
  installed = true;

  const target = centralizedExchangeExecutor as typeof centralizedExchangeExecutor & {
    execute: (plan: VerifiedArbitragePlan) => Promise<ArbitrageExecutionResult>;
  };
  const originalExecute = target.execute.bind(target);

  target.execute = async (plan: VerifiedArbitragePlan): Promise<ArbitrageExecutionResult> => {
    if (!isMakerRecoveryPlan(plan)) return originalExecute(plan);

    const makerPlan = asMakerPlan(plan);
    const traceId = getMakerLifecycleTraceId(plan);
    const guardReason = executionGuard(makerPlan);
    if (guardReason) {
      logger.info('[MakerRecovery] Maker plan rejected by execution-stage measured guard', {
        component: 'StablecoinMakerExecutionWiring',
        traceId,
        symbol: plan.symbol,
        reason: guardReason,
        notionalUsd: plan.notionalUsd,
        canaryCeilingUsd: makerPlan.makerExecution.canaryCeilingUsd,
        jointFillProbability: makerPlan.makerExecution.queueEcho.jointFillProbability,
        stressPersistenceProbability: makerPlan.makerExecution.spreadStress.persistenceProbability,
      });
      return rejectResult(guardReason);
    }

    const adapters = createPostOnlyMakerAdapters(plan);
    const ttl = adaptiveSettlementTtlMs(
      plan.makerExecution.ttlMs,
      plan.makerExecution.queueEcho.jointFillProbability,
      plan.makerExecution.spreadStress.persistenceProbability,
    );
    const pollIntervalRaw = Number(process.env.CRYPTO_ARBITRAGE_MAKER_POLL_MS || 250);
    const basePollMs = Math.max(100, Math.min(1_000, Number.isFinite(pollIntervalRaw) ? pollIntervalRaw : 250));
    const urgencyFactor = Math.max(0.4, Math.min(1, ttl.ttlMs / Math.max(1, plan.makerExecution.ttlMs)));
    const pollIntervalMs = Math.max(75, Math.min(basePollMs, Math.round(basePollMs * urgencyFactor)));
    logger.info('[MakerRecovery] Routing qualified maker plan through post-only canonical settlement', {
      component: 'StablecoinMakerExecutionWiring',
      traceId,
      strategy: plan.makerExecution.strategy,
      symbol: plan.symbol,
      buyVenue: plan.buyVenue,
      sellVenue: plan.sellVenue,
      notionalUsd: plan.notionalUsd,
      canaryCeilingUsd: plan.makerExecution.canaryCeilingUsd,
      canaryProofSamples: plan.makerExecution.canaryProofSamples,
      volatileMinGrossSpreadBps: plan.makerExecution.volatileMinGrossSpreadBps,
      ttlMs: ttl.ttlMs,
      configuredMaxTtlMs: Math.max(2_000, Math.min(30_000, plan.makerExecution.ttlMs)),
      paperProofSamples: ttl.sampleCount,
      paperFillRate: ttl.paperFillRate,
      ttlAuthority: 'paper_plus_joint_fill_plus_spread_persistence_bounded',
      pollIntervalMs,
      takerFallbackAllowed: false,
      queueEcho: plan.makerExecution.queueEcho,
      fractionalKelly: plan.makerExecution.fractionalKelly,
      causalLeadLag: plan.makerExecution.causalLeadLag,
      spreadStress: plan.makerExecution.spreadStress,
      adaptiveTakerFallback: 'not_authorized_without_fresh_positive_all_in_taker_economics',
    });

    const executor = new CentralizedExchangeExecutor({
      adapters,
      settlementTimeoutMs: ttl.ttlMs,
      pollIntervalMs,
    });
    const startedAt = Date.now();
    try {
      const result = await executor.execute(plan);
      logger.info('[MakerRecovery] Maker lifecycle terminal result', {
        component: 'StablecoinMakerExecutionWiring',
        traceId,
        strategy: plan.makerExecution.strategy,
        symbol: plan.symbol,
        elapsedMs: Date.now() - startedAt,
        success: result.success,
        queueEchoAuthority: plan.makerExecution.queueEcho.authority,
        jointFillProbability: plan.makerExecution.queueEcho.jointFillProbability,
        stressPersistenceProbability: plan.makerExecution.spreadStress.persistenceProbability,
      });
      return result;
    } catch (error) {
      logger.warn('[MakerRecovery] Maker lifecycle terminal error', {
        component: 'StablecoinMakerExecutionWiring',
        traceId,
        strategy: plan.makerExecution.strategy,
        symbol: plan.symbol,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}
