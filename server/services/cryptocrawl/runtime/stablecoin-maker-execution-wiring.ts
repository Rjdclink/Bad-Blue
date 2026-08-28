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

function adaptiveSettlementTtlMs(configuredTtlMs: number): { ttlMs: number; sampleCount: number; paperFillRate: number | null } {
  const hardMax = Math.max(2_000, Math.min(30_000, Number.isFinite(configuredTtlMs) ? configuredTtlMs : 30_000));
  const stats = getMakerPaperProofStats();
  const terminal = stats.completed + stats.expired + stats.partial;
  if (terminal < 10) return { ttlMs: hardMax, sampleCount: terminal, paperFillRate: null };

  const fillRate = stats.completed / Math.max(1, terminal);
  const multiplier = 0.35 + (0.65 * Math.max(0, Math.min(1, fillRate)));
  const learned = Math.round(hardMax * multiplier);
  return {
    ttlMs: Math.max(3_000, Math.min(hardMax, learned)),
    sampleCount: terminal,
    paperFillRate: fillRate,
  };
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

    const traceId = getMakerLifecycleTraceId(plan);
    const adapters = createPostOnlyMakerAdapters(plan);
    const ttl = adaptiveSettlementTtlMs(plan.makerExecution.ttlMs);
    const pollIntervalRaw = Number(process.env.CRYPTO_ARBITRAGE_MAKER_POLL_MS || 250);
    const pollIntervalMs = Math.max(100, Math.min(1_000, Number.isFinite(pollIntervalRaw) ? pollIntervalRaw : 250));
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
      ttlAuthority: ttl.paperFillRate === null ? 'configured_bounded' : 'paper_calibrated_bounded',
      pollIntervalMs,
      takerFallbackAllowed: false,
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
