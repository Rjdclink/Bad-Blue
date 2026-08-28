import logger from '../../../logger.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { monteCarloCalibrationStore } from '../validation/monte-carlo-calibration-store.js';
import { precomputeMonteCarlo } from '../validation/monte-carlo-precompute-cache.js';

let timer: NodeJS.Timeout | null = null;
let running = false;
let inFlight = false;

function sizeBucket(value: number): string {
  if (value < 50) return 'lt50';
  if (value < 100) return '50_100';
  if (value < 250) return '100_250';
  if (value < 500) return '250_500';
  if (value < 1000) return '500_1000';
  if (value < 5000) return '1000_5000';
  return 'gte5000';
}

async function sweep(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const maxCandidates = Math.max(1, Math.min(32, Number(process.env.CRYPTO_MC_PRECOMPUTE_CANDIDATES || 8)));
    const maxQuoteAgeMs = Math.max(500, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000));
    const candidates = canonicalOpportunityState.getRecent(64)
      .filter(snapshot => snapshot.plan && snapshot.plan.netProfitUsd > 0 && snapshot.plan.quoteAgeMs < maxQuoteAgeMs)
      .slice(0, maxCandidates);

    for (const snapshot of candidates) {
      const plan = snapshot.plan!;
      const now = Date.now();
      const sourceExpiresAt = now + Math.max(1, maxQuoteAgeMs - Math.max(0, plan.quoteAgeMs));
      if (sourceExpiresAt <= now) continue;
      const venuePair = `${plan.buyVenue}->${plan.sellVenue}`;
      const calibration = monteCarloCalibrationStore.getSamples({
        topology: 'CEX_CEX', venuePair, symbol: plan.symbol, chain: 'cex', strategy: 'verified_cex_arbitrage', limit: 1024,
      });
      const latestCalibrationAt = calibration.observations.reduce((latest, observation) => Math.max(latest, observation.observedAt), 0);
      const liquidityCoverage = plan.liquidity.status === 'measured' && plan.baseQty > 0
        ? Math.max(0, Math.min(1, Math.min(plan.liquidity.buyAvailableBaseQty || 0, plan.liquidity.sellAvailableBaseQty || 0) / plan.baseQty))
        : 0;
      const quoteFreshness = Math.max(0, Math.min(1, 1 - plan.quoteAgeMs / maxQuoteAgeMs));
      const empiricalFill = calibration.bothLegsFillRate;
      const confidence = empiricalFill !== null
        ? Math.max(0, Math.min(1, empiricalFill * 0.70 + quoteFreshness * 0.20 + liquidityCoverage * 0.10))
        : Math.max(0, Math.min(1, quoteFreshness * liquidityCoverage));
      const input = {
        seed: `precompute:${snapshot.opportunityId}:${snapshot.updatedAt}`,
        topology: 'CEX_CEX' as const,
        notionalUsd: plan.notionalUsd,
        expectedNetProfitUsd: plan.netProfitUsd,
        estimatedExecutionCostUsd: Math.max(0, plan.costs.totalCostsUsd),
        expectedSlippageBps: Math.max(0, plan.expectedSlippageBps ?? 0),
        quoteLatencyMs: Math.max(0, plan.quoteAgeMs),
        quoteMaxAgeMs: maxQuoteAgeMs,
        executionHorizonMs: maxQuoteAgeMs,
        confidence,
        baselineSlippageAlreadyIncluded: true,
        calibrationSamples: calibration.samples,
        measuredProfitResidualsUsd: calibration.profitResidualsUsd,
        measuredCostMultipliers: calibration.costMultipliers,
        measuredSlippageResidualsBps: calibration.slippageResidualsBps,
        measuredLatenciesMs: calibration.latenciesMs,
        measuredJointResiduals: calibration.observations.map(observation => ({
          profitResidualUsd: observation.profitResidualUsd,
          costMultiplier: observation.costMultiplier,
          slippageResidualBps: observation.slippageResidualBps,
          latencyMs: observation.latencyMs,
          bothLegsFilled: observation.bothLegsFilled,
          partialFill: observation.partialFill,
          providerFailure: observation.providerFailure,
        })),
      };
      await precomputeMonteCarlo({
        marketRegime: snapshot.assessment?.monteCarlo?.marketRegime || snapshot.assessment?.riskLevel || 'unknown',
        topology: 'CEX_CEX',
        venuePair,
        symbol: plan.symbol,
        sizeBucket: sizeBucket(plan.notionalUsd),
        modelVersion: snapshot.assessment?.monteCarlo?.mode || 'canonical-mc-v1',
        calibrationVersion: `mc-calibration-v1:${calibration.samples}:${latestCalibrationAt}`,
        dataEpoch: `${snapshot.observedAt}:${snapshot.updatedAt}:${plan.quoteAgeMs}`,
        sourceObservedAt: snapshot.observedAt,
        sourceExpiresAt,
      }, input);
    }
  } catch (error) {
    logger.warn('[MonteCarloPrecompute] background sweep degraded', {
      component: 'MonteCarloPrecomputeWiring',
      error: error instanceof Error ? error.message : String(error),
      executionBlocked: false,
    });
  } finally {
    inFlight = false;
  }
}

export function ensureMonteCarloPrecomputeWiring(): void {
  if (running || process.env.NO_INTERVALS === 'true') return;
  running = true;
  const intervalMs = Math.max(2_000, Number(process.env.CRYPTO_MC_PRECOMPUTE_INTERVAL_MS || 10_000));
  void sweep();
  timer = setInterval(() => void sweep(), intervalMs);
  timer.unref();
  logger.info('[MonteCarloPrecompute] Quanti Comp background precompute installed', {
    component: 'MonteCarloPrecomputeWiring',
    intervalMs,
    authority: 'advisory_precompute_only',
    computeAuthority: 'quanti-comp',
    finalDeterministicValidationRequired: true,
    finalMonteCarloValidationRequired: true,
    executionAuthority: false,
  });
}

export function stopMonteCarloPrecomputeWiring(): void {
  running = false;
  if (timer) clearInterval(timer);
  timer = null;
}
