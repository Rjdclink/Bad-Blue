import {
  type Cryptara,
  type CryptaraOpportunityAssessment,
  type CryptaraOpportunityContext,
} from '../../cryptara/index.js';
import { runProfitabilityMonteCarlo } from '../execution/adapters/monte-carlo-profitability.js';

function hasMeasuredExecutionCalibration(cryptara: Cryptara, symbol: string): boolean {
  const history = cryptara.getExecutionHistory(120)
    .filter(entry => entry.symbol.toUpperCase() === symbol.toUpperCase() && entry.realizedProfitUsd !== null && Number.isFinite(entry.realizedProfitUsd));
  return history.length >= 3 && history.some(entry => Number.isFinite(entry.latencyMs) && entry.latencyMs > 0);
}

export async function assessCryptaraOpportunity(
  cryptara: Cryptara,
  context: CryptaraOpportunityContext,
): Promise<CryptaraOpportunityAssessment> {
  const measuredCalibrationReady = hasMeasuredExecutionCalibration(cryptara, context.symbol);
  const baseAssessment = measuredCalibrationReady
    ? await cryptara.assessOpportunity(context)
    : cryptara.recordOpportunityObservation(context);

  if (baseAssessment.monteCarlo || !context.plan) return baseAssessment;

  const plan = context.plan;
  const maxQuoteAgeMs = Math.max(1, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5000));
  const quoteFresh = Number.isFinite(plan.quoteAgeMs) && plan.quoteAgeMs >= 0 && plan.quoteAgeMs <= maxQuoteAgeMs;
  const eligible =
    Number.isFinite(plan.netProfitUsd) && plan.netProfitUsd > 0 &&
    Number.isFinite(plan.notionalUsd) && plan.notionalUsd > 0 &&
    Number.isFinite(plan.costs.totalCostsUsd) && plan.costs.totalCostsUsd >= 0 &&
    quoteFresh &&
    context.tradingView?.dataProvenance === 'live' &&
    context.mempool?.available === true && context.mempool.observedAt !== null &&
    plan.liquidity.status === 'measured' &&
    !!plan.feeEvidence &&
    baseAssessment.executionConfidence !== null;

  if (!eligible) return baseAssessment;

  const forecast = runProfitabilityMonteCarlo({
    seed: `cryptara-bootstrap:${context.opportunityId}:${plan.buyAsk}:${plan.sellBid}:${plan.quoteAgeMs}`,
    notionalUsd: plan.notionalUsd,
    expectedNetProfitUsd: plan.netProfitUsd,
    estimatedExecutionCostUsd: plan.costs.totalCostsUsd,
    expectedSlippageBps: Math.max(0, plan.expectedSlippageBps ?? 0),
    quoteLatencyMs: plan.quoteAgeMs,
    confidence: baseAssessment.executionConfidence,
    baselineSlippageAlreadyIncluded: true,
  });

  const monteCarlo = {
    evaluatedAt: Date.now(),
    probabilityOfProfit: forecast.profitableProbability,
    confidence: baseAssessment.executionConfidence,
    valueAtRisk95: forecast.p05NetProfitUsd,
    expectedShortfall: forecast.expectedShortfallNetProfitUsd,
    maxDrawdown: Math.max(0, plan.netProfitUsd - forecast.worstNetProfitUsd),
    marketRegime: 'bootstrap_live_verified_economics',
  };
  const missingInformation = baseAssessment.missingInformation.filter(item => item !== 'monte_carlo_evidence');
  const provenance = [...new Set([...baseAssessment.provenance, 'pretrade_profitability_monte_carlo'])];
  const dataCompleteness = Number(Math.max(0, Math.min(1, 1 - missingInformation.length / 8)).toFixed(4));
  const probabilityOfProfitableExecution = Math.min(baseAssessment.executionConfidence, forecast.profitableProbability);
  const rankScore = baseAssessment.netProfitMargin !== null
    ? Number((baseAssessment.netProfitMargin * 10000 * probabilityOfProfitableExecution * dataCompleteness).toFixed(4))
    : null;
  const recommendation: CryptaraOpportunityAssessment['recommendation'] =
    rankScore !== null && rankScore > 0 && probabilityOfProfitableExecution >= 0.6 && forecast.approved
      ? 'consider'
      : 'reject';

  return {
    ...baseAssessment,
    recommendation,
    rankScore,
    probabilityOfProfitableExecution,
    monteCarlo,
    dataCompleteness,
    missingInformation,
    provenance,
  };
}
