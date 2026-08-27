import type { QuoteVenue, VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import logger from '../../../logger.js';
import { monteCarloCalibrationStore } from '../validation/monte-carlo-calibration-store.js';
import { runProfitabilityMonteCarlo } from './adapters/monte-carlo-profitability.js';
import {
  createProductionCexSettlementAdapters,
  executeCexPlan,
  type CexExecutorOptions,
  type CexExecutionResult,
} from './cex-settlement.js';

export type ExchangeOrderReceipt = NonNullable<CexExecutionResult['buyOrder']>;
export type ArbitrageExecutionResult = CexExecutionResult;

function rejectPlan(error: string): ArbitrageExecutionResult {
  return {
    success: false,
    status: 'rejected',
    settlementConfirmed: false,
    error,
  };
}

function measuredLiquidityCoverage(plan: VerifiedArbitragePlan): number {
  if (plan.liquidity.status !== 'measured' ||
      plan.liquidity.buyAvailableBaseQty === null ||
      plan.liquidity.sellAvailableBaseQty === null ||
      !(plan.baseQty > 0)) return 0;
  return Math.max(0, Math.min(1,
    Math.min(plan.liquidity.buyAvailableBaseQty, plan.liquidity.sellAvailableBaseQty) / plan.baseQty,
  ));
}

export class CentralizedExchangeExecutor {
  constructor(private readonly options: CexExecutorOptions = {}) {}

  async execute(plan: VerifiedArbitragePlan): Promise<ArbitrageExecutionResult> {
    getCryptocrawlGovernance().requireAllowed('EXECUTE_OPPORTUNITY', { pair: plan.symbol });
    if (process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION !== 'true') {
      throw new Error('CRYPTO_ARBITRAGE_LIVE_EXECUTION=true is required for live orders');
    }
    if (process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION !== 'I_ACCEPT_LIVE_ORDER_RISK') {
      throw new Error('CRYPTO_ARBITRAGE_LIVE_CONFIRMATION=I_ACCEPT_LIVE_ORDER_RISK is required for live orders');
    }
    if (plan.bridge) throw new Error('Cross-chain plans require settlement orchestration and cannot be submitted as spot orders');
    if (!['kraken', 'okx'].includes(plan.buyVenue) || !['kraken', 'okx'].includes(plan.sellVenue)) {
      throw new Error(`Live execution is not configured for ${plan.buyVenue} -> ${plan.sellVenue}`);
    }
    if (!Number.isFinite(plan.netProfitUsd) || plan.netProfitUsd <= 0) {
      return rejectPlan('Verified all-in net profit must be positive before live CEX submission');
    }

    // CEX inventory arbitrage is not an on-chain mempool strategy. Requiring
    // Alchemy pending-transaction telemetry here previously rejected otherwise
    // valid CEX plans for evidence unrelated to the topology. Capture confidence
    // now comes from measured quote freshness/liquidity and terminal CEX fills.
    const maxQuoteAgeMs = Math.max(1, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5000));
    const quoteFreshness = Math.max(0, Math.min(1, 1 - plan.quoteAgeMs / maxQuoteAgeMs));
    const liquidityCoverage = measuredLiquidityCoverage(plan);
    const calibration = monteCarloCalibrationStore.getSamples({
      topology: 'CEX_CEX',
      venuePair: `${plan.buyVenue}->${plan.sellVenue}`,
      symbol: plan.symbol,
      chain: 'cex',
      strategy: 'verified_cex_arbitrage',
      limit: 1024,
    });
    const empiricalFill = calibration.bothLegsFillRate;
    const evidenceConfidence = empiricalFill !== null
      ? Math.max(0, Math.min(1, empiricalFill * 0.70 + quoteFreshness * 0.20 + liquidityCoverage * 0.10))
      : Math.max(0, Math.min(1, quoteFreshness * liquidityCoverage));

    const monteCarlo = runProfitabilityMonteCarlo({
      seed: `cex:${plan.buyVenue}:${plan.sellVenue}:${plan.symbol}:${plan.buyAsk}:${plan.sellBid}:${plan.quoteAgeMs}`,
      topology: 'CEX_CEX',
      notionalUsd: plan.notionalUsd,
      expectedNetProfitUsd: plan.netProfitUsd,
      estimatedExecutionCostUsd: Math.max(0, plan.costs.totalCostsUsd),
      expectedSlippageBps: Math.max(0, plan.expectedSlippageBps ?? 0),
      quoteLatencyMs: Math.max(0, plan.quoteAgeMs),
      quoteMaxAgeMs: maxQuoteAgeMs,
      executionHorizonMs: maxQuoteAgeMs,
      confidence: evidenceConfidence,
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
    });

    logger.info('Measured CEX profitability forecast evaluated', {
      component: 'CentralizedExchangeExecutor',
      symbol: plan.symbol,
      buyVenue: plan.buyVenue,
      sellVenue: plan.sellVenue,
      topology: 'CEX_CEX',
      verifiedNetProfitUsd: plan.netProfitUsd,
      quoteFreshness,
      liquidityCoverage,
      evidenceConfidence,
      calibrationSamples: calibration.samples,
      empiricalBothLegsFillRate: calibration.bothLegsFillRate,
      empiricalPartialFillRate: calibration.partialFillRate,
      empiricalProviderFailureRate: calibration.providerFailureRate,
      profitableProbability: monteCarlo.profitableProbability,
      profitableProbabilityInterval: monteCarlo.profitableProbabilityInterval,
      probabilityBothLegsFill: monteCarlo.probabilityBothLegsFill,
      probabilityLossExceedsThreshold: monteCarlo.probabilityLossExceedsThreshold,
      probabilityPartialFillLoss: monteCarlo.probabilityPartialFillLoss,
      p50NetProfitUsd: monteCarlo.p50NetProfitUsd,
      p25NetProfitUsd: monteCarlo.p25NetProfitUsd,
      p10NetProfitUsd: monteCarlo.p10NetProfitUsd,
      p5NetProfitUsd: monteCarlo.p5NetProfitUsd,
      p1NetProfitUsd: monteCarlo.p1NetProfitUsd,
      worstNetProfitUsd: monteCarlo.worstNetProfitUsd,
      valueAtRisk95Usd: monteCarlo.valueAtRisk95Usd,
      valueAtRisk99Usd: monteCarlo.valueAtRisk99Usd,
      expectedShortfall95Usd: monteCarlo.expectedShortfall95Usd,
      expectedShortfall975Usd: monteCarlo.expectedShortfall975Usd,
      expectedShortfall99Usd: monteCarlo.expectedShortfall99Usd,
      executionHorizonMs: monteCarlo.executionHorizonMs,
      samples: monteCarlo.samples,
      stoppedEarly: monteCarlo.stoppedEarly,
      converged: monteCarlo.converged,
      distribution: monteCarlo.distribution,
      distributionProvenance: monteCarlo.distributionProvenance,
      policyVersion: monteCarlo.policyVersion,
      approved: monteCarlo.approved,
      reason: monteCarlo.reason,
    });

    if (!monteCarlo.approved) {
      return rejectPlan(`Measured profitability forecast rejected execution: ${monteCarlo.reason}`);
    }

    return executeCexPlan(plan, this.options);
  }
}

// Keep one authenticated adapter set for the process lifetime. In particular,
// Kraken's private API nonce is monotonic per API key, so independently creating
// an adapter for each concurrently evaluated plan can generate duplicate nonces
// when two requests begin in the same millisecond.
const productionCexAdapters = createProductionCexSettlementAdapters();
export const centralizedExchangeExecutor = new CentralizedExchangeExecutor({ adapters: productionCexAdapters });
