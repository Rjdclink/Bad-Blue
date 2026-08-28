import logger from '../../../logger.js';
import {
  CentralizedExchangeExecutor,
  centralizedExchangeExecutor,
  type ArbitrageExecutionResult,
} from '../execution/centralized-exchange-executor.js';
import { createPostOnlyMakerAdapters } from '../execution/post-only-maker-adapters.js';
import { isStablecoinMakerPlan } from '../execution/stablecoin-maker-strategy.js';
import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';

let installed = false;

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
    const ttlMs = Math.max(2_000, Math.min(30_000, plan.makerExecution.ttlMs));
    const pollIntervalMs = Math.max(100, Math.min(1_000, Number(process.env.CRYPTO_ARBITRAGE_MAKER_POLL_MS || 250)));
    logger.info('[StablecoinMaker] Routing qualified maker plan through post-only canonical settlement', {
      component: 'StablecoinMakerExecutionWiring',
      symbol: plan.symbol,
      buyVenue: plan.buyVenue,
      sellVenue: plan.sellVenue,
      notionalUsd: plan.notionalUsd,
      ttlMs,
      pollIntervalMs,
      takerFallbackAllowed: false,
    });

    const executor = new CentralizedExchangeExecutor({
      adapters,
      settlementTimeoutMs: ttlMs,
      pollIntervalMs,
    });
    return executor.execute(plan);
  };
}
