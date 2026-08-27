import type { QuoteVenue, VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { alchemyIntegration } from '../capital-free/alchemy-integration.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import logger from '../../../logger.js';
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

    const mempool = alchemyIntegration.getMempoolAnalysis();
    if (!mempool.available || mempool.observedAt === null || mempool.totalPending <= 0) {
      return rejectPlan('Live competition evidence is unavailable for competition-adjusted profitability forecasting');
    }

    const competitionLevel = Math.max(0, Math.min(1, mempool.arbitrageOpportunities.length / mempool.totalPending));
    const maxQuoteAgeMs = Math.max(1, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5000));
    const quoteFreshness = Math.max(0, Math.min(1, 1 - plan.quoteAgeMs / maxQuoteAgeMs));
    const captureProbability = Math.max(0, Math.min(1, (1 - competitionLevel) * quoteFreshness));
    const monteCarlo = runProfitabilityMonteCarlo({
      seed: `cex:${plan.buyVenue}:${plan.sellVenue}:${plan.symbol}:${plan.buyAsk}:${plan.sellBid}:${plan.quoteAgeMs}`,
      topology: 'CEX_CEX',
      notionalUsd: plan.notionalUsd,
      expectedNetProfitUsd: plan.netProfitUsd,
      estimatedExecutionCostUsd: Math.max(0, plan.costs.totalCostsUsd),
      expectedSlippageBps: Math.max(0, plan.expectedSlippageBps ?? 0),
      quoteLatencyMs: Math.max(0, plan.quoteAgeMs),
      quoteMaxAgeMs: maxQuoteAgeMs,
      confidence: captureProbability,
      baselineSlippageAlreadyIncluded: true,
    });

    logger.info('Competition-adjusted CEX profitability forecast evaluated', {
      component: 'CentralizedExchangeExecutor',
      symbol: plan.symbol,
      buyVenue: plan.buyVenue,
      sellVenue: plan.sellVenue,
      topology: 'CEX_CEX',
      verifiedNetProfitUsd: plan.netProfitUsd,
      competitionLevel,
      captureProbability,
      profitableProbability: monteCarlo.profitableProbability,
      profitableProbabilityInterval: monteCarlo.profitableProbabilityInterval,
      p10NetProfitUsd: monteCarlo.p10NetProfitUsd,
      p5NetProfitUsd: monteCarlo.p5NetProfitUsd,
      p1NetProfitUsd: monteCarlo.p1NetProfitUsd,
      expectedShortfall95Usd: monteCarlo.expectedShortfall95Usd,
      samples: monteCarlo.samples,
      stoppedEarly: monteCarlo.stoppedEarly,
      converged: monteCarlo.converged,
      distribution: monteCarlo.distribution,
      policyVersion: monteCarlo.policyVersion,
      approved: monteCarlo.approved,
      reason: monteCarlo.reason,
    });

    if (!monteCarlo.approved) {
      return rejectPlan(`Competition-adjusted profitability forecast rejected execution: ${monteCarlo.reason}`);
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