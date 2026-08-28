import logger from '../../../logger.js';
import {
  CentralizedExchangeExecutor,
  centralizedExchangeExecutor,
  type ArbitrageExecutionResult,
} from '../execution/centralized-exchange-executor.js';
import { createPostOnlyMakerAdapters } from '../execution/post-only-maker-adapters.js';
import { isStablecoinMakerPlan } from '../execution/stablecoin-maker-strategy.js';
import { getMakerPaperProofStats } from '../intelligence/maker-microstructure-proof.js';
import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';

let installed = false;

function adaptiveSettlementTtlMs(configuredTtlMs: number): { ttlMs: number; sampleCount: number; paperFillRate: number | null } {
  const hardMax = Math.max(2_000, Math.min(30_000, Number.isFinite(configuredTtlMs) ? configuredTtlMs : 30_000));
  const stats = getMakerPaperProofStats();
  const terminal = stats.completed + stats.expired + stats.partial;
  if (terminal < 10) return { ttlMs: hardMax, sampleCount: terminal, paperFillRate: null };

  const fillRate = stats.completed / Math.max(1, terminal);
  // Paper evidence can tune how long a post-only order rests, but it can never
  // expand beyond the already-approved TTL or change execution authority.
  const multiplier = 0.35 + (0.65 * Math.max(0, Math.min(1, fillRate)));
  const learned = Math.round(hardMax * multiplier);
  return {
    ttlMs: Math.max(3_000, Math.min(hardMax, learned)),
    sampleCount: terminal,
    paperFillRate: fillRate,
  };
}

/**
 * Installs a narrow route on top of the canonical executor. Existing taker plans
 * continue through the exact original instance. Stablecoin maker plans get a
 * per-plan executor with post-only adapters and an explicit cancel-only TTL;
 * every existing inventory, Monte Carlo, product, governance and settlement gate
 * inside CentralizedExchangeExecutor remains authoritative.
 */
export function ensureStablecoinMakerExecutionWiring(): void {
  if (installed) return;
  installed = true;

  const target = centralizedExchangeExecutor as typeof centralizedExchangeExecutor & {
    execute: (plan: VerifiedArbitragePlan) => Promise<ArbitrageExecutionResult>;
  };
  const originalExecute = target.execute.bind(target);

  target.execute = async (plan: VerifiedArbitragePlan): Promise<ArbitrageExecutionResult> => {
    if (!isStablecoinMakerPlan(plan)) return originalExecute(plan);

    const adapters = createPostOnlyMakerAdapters(plan);
    const ttl = adaptiveSettlementTtlMs(plan.makerExecution.ttlMs);
    const pollIntervalRaw = Number(process.env.CRYPTO_ARBITRAGE_MAKER_POLL_MS || 250);
    const pollIntervalMs = Math.max(100, Math.min(1_000, Number.isFinite(pollIntervalRaw) ? pollIntervalRaw : 250));
    logger.info('[StablecoinMaker] Routing qualified maker plan through post-only canonical settlement', {
      component: 'StablecoinMakerExecutionWiring',
      symbol: plan.symbol,
      buyVenue: plan.buyVenue,
      sellVenue: plan.sellVenue,
      notionalUsd: plan.notionalUsd,
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
    return executor.execute(plan);
  };
}
