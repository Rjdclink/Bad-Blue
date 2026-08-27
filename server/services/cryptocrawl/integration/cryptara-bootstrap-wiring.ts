import Cryptara, {
  getCryptara,
  type CryptaraExecutionFeedback,
  type CryptaraMonteCarloEvidence,
  type CryptaraOpportunityAssessment,
  type CryptaraOpportunityContext,
  type MonteCarloResult,
} from '../../cryptara/index.js';
import { createLogger } from '../../../logger.js';
import { createMonteCarloEngine, type MarketCondition, type StrategyProfile } from '../validation/monte-carlo-engine.js';
import type { MarketUniverseAsset } from '../intelligence/market-data-providers.js';
import type { MarketConditionLevel } from '../core/market-condition-detector.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';

const log = createLogger('CryptaraBootstrapWiring');
const installed = new WeakSet<object>();

type BootstrapMonteCarloEvidence = CryptaraMonteCarloEvidence & {
  mode: 'pretrade_bootstrap' | 'posttrade_calibrated';
  calibrationSamples: number;
};

type CryptaraInternals = {
  status: {
    isRunning: boolean;
    lastSimulationTime: Date | null;
    totalSimulations: number;
    errorCount: number;
  };
  latestOpportunityContext: CryptaraOpportunityContext | null;
  latestMonteCarloEvidence: BootstrapMonteCarloEvidence | null;
  executionHistory: CryptaraExecutionFeedback[];
  runMonteCarloSimulation: () => Promise<MonteCarloResult>;
  recordOpportunityObservation: (context: CryptaraOpportunityContext) => CryptaraOpportunityAssessment;
  recordExecutionResult: (feedback: CryptaraExecutionFeedback) => void;
  emit: (event: string, ...args: unknown[]) => boolean;
};

function findMarketAsset(marketUniverse: MarketUniverseAsset[], symbol: string): MarketUniverseAsset | undefined {
  const normalized = symbol.trim().toUpperCase();
  const direct = marketUniverse.find(asset => asset.symbol.toUpperCase() === normalized);
  if (direct) return direct;
  const providerSymbol = normalized === 'USDC' || normalized === 'USDT' ? `${normalized}USDT` : undefined;
  return providerSymbol ? marketUniverse.find(asset => asset.symbol.toUpperCase() === providerSymbol) : undefined;
}

function classifyLearningCondition(market: MarketCondition): MarketConditionLevel {
  const stress = (1 - market.liquidityScore) * 0.35 +
    market.networkCongestion * 0.25 +
    Math.min(1, market.volatility / 2) * 0.25 +
    market.competitorDensity * 0.15;
  if (stress <= 0.3) return 'ideal';
  if (stress >= 0.65) return 'poor';
  return 'average';
}

async function runBootstrapAwareMonteCarlo(this: CryptaraInternals): Promise<MonteCarloResult> {
  if (!this.status.isRunning) throw new Error('CRYPTARA is not running. Call initialize() first.');

  const context = this.latestOpportunityContext;
  const marketAsset = context ? findMarketAsset(context.marketUniverse, context.symbol) : undefined;
  const priceHistory = marketAsset?.priceHistory;
  const mempool = context?.mempool;
  const executionHistory = context ? this.executionHistory.filter(entry => entry.symbol === context.symbol) : [];
  const measuredExecutionHistory = executionHistory.filter(entry =>
    entry.settlementConfirmed === true && entry.realizedProfitUsd !== null && Number.isFinite(entry.realizedProfitUsd),
  );
  const measuredLatencies = measuredExecutionHistory.map(entry => entry.latencyMs).filter(latency => Number.isFinite(latency) && latency > 0);
  const posttradeCalibrated = measuredExecutionHistory.length >= 3 && measuredLatencies.length > 0;
  const mode: BootstrapMonteCarloEvidence['mode'] = posttradeCalibrated ? 'posttrade_calibrated' : 'pretrade_bootstrap';
  const requiresOnchainTelemetry = context?.plan?.crossVenueCostModel === 'bridge' || !!context?.plan?.bridge;

  const missingInformation: string[] = [];
  if (!context?.plan) missingInformation.push('verified_opportunity_economics');
  if (!priceHistory || priceHistory.length < 20) missingInformation.push('price_history');
  if (requiresOnchainTelemetry && (!mempool || mempool.avgGasPrice <= 0 || mempool.maxGasPrice <= 0)) missingInformation.push('gas_observations');
  if (context?.tradingView?.dataProvenance !== 'live') missingInformation.push('live_technical_analysis');
  if (context?.plan && context.plan.quoteAgeMs > Math.max(1, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5000))) missingInformation.push('fresh_verified_quote');
  if (marketAsset && Date.now() - marketAsset.observedAt > Math.max(30_000, Number(process.env.COINGECKO_MARKET_TTL_MS || 300_000))) missingInformation.push('fresh_price_history');
  if (missingInformation.length > 0) throw new Error(`Cryptara Monte Carlo requires measured context: ${missingInformation.join(', ')}`);

  const plan = context!.plan!;
  const liquidityScore = Math.max(0, Math.min(1, Math.min(
    plan.liquidity.buyAvailableBaseQty ?? 0,
    plan.liquidity.sellAvailableBaseQty ?? 0,
  ) / Math.max(plan.baseQty, 1e-12)));
  const quoteMaxAgeMs = Math.max(1, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5000));
  const quoteFreshness = Math.max(0, Math.min(1, 1 - plan.quoteAgeMs / quoteMaxAgeMs));
  const technicalStrength = Math.max(0, Math.min(1, (context!.tradingView!.summary.strength || 0) / 100));
  const pretradeSuccessPrior = Math.max(0.35, Math.min(0.8,
    0.35 + liquidityScore * 0.2 + quoteFreshness * 0.15 + technicalStrength * 0.1 + (plan.netProfitUsd > 0 ? 0.05 : 0),
  ));

  log.info('Starting Monte Carlo from verified pre-trade evidence', {
    opportunityId: context!.opportunityId,
    symbol: context!.symbol,
    mode,
    calibrationSamples: measuredExecutionHistory.length,
    executionTopology: requiresOnchainTelemetry ? 'cross_chain_or_onchain' : 'cex_prepositioned_or_transfer',
    mempoolRequired: requiresOnchainTelemetry,
  });
  this.status.totalSimulations++;

  try {
    const returns = priceHistory!.slice(1).map((price, index) => (price - priceHistory![index]) / priceHistory![index]);
    const volatility = Math.sqrt(returns.reduce((sum, value) => sum + value * value, 0) / returns.length) * Math.sqrt(365 * 24);
    const hasMeasuredMempool = !!mempool && mempool.avgGasPrice > 0 && mempool.maxGasPrice > 0;
    const gasRange = hasMeasuredMempool ? (mempool!.maxGasPrice - mempool!.avgGasPrice) / mempool!.avgGasPrice : 0;
    const measuredPriceImpact = Math.max(0, plan.expectedPriceImpactBps ?? plan.expectedSlippageBps ?? 0);
    const market: MarketCondition = {
      volatility: Math.max(0.01, Math.min(2, volatility)),
      liquidityScore,
      gasVolatility: requiresOnchainTelemetry ? Math.max(0, Math.min(2, gasRange)) : 0,
      competitorDensity: hasMeasuredMempool
        ? Math.max(0, Math.min(1, mempool!.arbitrageOpportunities.length / Math.max(1, mempool!.swapTransactions)))
        : Math.max(0, Math.min(1, measuredPriceImpact / 100)),
      networkCongestion: requiresOnchainTelemetry && hasMeasuredMempool
        ? Math.max(0, Math.min(1, mempool!.totalPending / 8000))
        : 0,
      priceHistory: priceHistory!,
      volumeHistory: marketAsset?.volume24hUsd ? [marketAsset.volume24hUsd] : [],
      gasHistory: hasMeasuredMempool ? [mempool!.avgGasPrice, mempool!.maxGasPrice] : [],
    };

    const successRate = posttradeCalibrated
      ? measuredExecutionHistory.filter(entry => entry.success).length / measuredExecutionHistory.length
      : pretradeSuccessPrior;
    const timestamps = measuredExecutionHistory.map(entry => entry.timestamp).filter(Number.isFinite).sort((a, b) => a - b);
    const observedDays = timestamps.length > 1 ? Math.max(1 / 24, (timestamps[timestamps.length - 1] - timestamps[0]) / 86_400_000) : 1;
    const observedLatencyMs = posttradeCalibrated
      ? measuredLatencies.reduce((sum, latency) => sum + latency, 0) / measuredLatencies.length
      : Math.max(1, plan.quoteAgeMs);
    const realizedLosses = measuredExecutionHistory
      .map(entry => entry.realizedProfitUsd)
      .filter((value): value is number => value !== null && Number.isFinite(value) && value < 0);
    const strategy: StrategyProfile = {
      name: posttradeCalibrated ? 'verified-arbitrage-calibrated' : 'verified-arbitrage-pretrade-bootstrap',
      baseSuccessRate: successRate,
      avgProfitPerTrade: Math.max(0.0001, plan.netProfitUsd / plan.notionalUsd),
      avgLossPerTrade: posttradeCalibrated && realizedLosses.length > 0
        ? Math.max(0.0001, Math.abs(Math.min(...realizedLosses)) / plan.notionalUsd)
        : Math.max(0.0001, plan.costs.totalCostsUsd / plan.notionalUsd),
      tradesPerDay: posttradeCalibrated ? measuredExecutionHistory.length / observedDays : 1,
      gasPerTrade: requiresOnchainTelemetry ? plan.costs.gasUsd / plan.notionalUsd : 0,
      slippageTolerance: Math.max(0.0001, (plan.expectedSlippageBps ?? 0) / 10_000),
      executionLatency: observedLatencyMs,
      strategyType: 'arbitrage',
      mlFilterEnabled: false,
      multiChainEnabled: requiresOnchainTelemetry,
      mempoolMonitoring: requiresOnchainTelemetry,
    };

    const simulation = await createMonteCarloEngine({ simulations: 1000, timeHorizonDays: 1, ensembleCount: 3 }).runSimulation(strategy, market);
    const result: MonteCarloResult = {
      simulationId: `sim-${Date.now()}`,
      timestamp: new Date(),
      iterations: 1000,
      scenarios: [{
        name: posttradeCalibrated ? 'Measured execution calibrated distribution' : 'Measured pre-trade bootstrap distribution',
        probability: simulation.scenarioResults.probabilityOfProfit,
        expectedReturn: simulation.expectedProfit,
        maxDrawdown: simulation.maxDrawdown,
        sharpeRatio: simulation.sharpeRatio,
      }],
      optimalStrategy: strategy.name,
      riskMetrics: {
        valueAtRisk: simulation.valueAtRisk95,
        expectedShortfall: simulation.conditionalVaR,
        maxDrawdown: simulation.maxDrawdown,
        volatility: simulation.marketRegime.volatilityPercentile / 100,
      },
      learnings: simulation.performanceBreakdown.recommendation ? [simulation.performanceBreakdown.recommendation] : [],
    };

    if (posttradeCalibrated) {
      try {
        const { instantLearningEngine } = await import('../learning/instant-learning-engine.js');
        await instantLearningEngine.learnFromSimulation(strategy, market, classifyLearningCondition(market), simulation);
      } catch (error) {
        log.warn('Calibrated Monte Carlo learning update unavailable; retaining simulation evidence', {
          opportunityId: context!.opportunityId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.latestMonteCarloEvidence = {
      simulationId: result.simulationId,
      evaluatedAt: Date.now(),
      sourceOpportunityId: context!.opportunityId,
      mode,
      calibrationSamples: measuredExecutionHistory.length,
      expectedProfit: simulation.expectedProfit,
      probabilityOfProfit: simulation.scenarioResults.probabilityOfProfit,
      valueAtRisk95: simulation.valueAtRisk95,
      expectedShortfall: simulation.conditionalVaR,
      maxDrawdown: simulation.maxDrawdown,
      marketRegime: simulation.marketRegime.regime,
      confidence: posttradeCalibrated ? simulation.ensembleConfidence : Math.min(simulation.ensembleConfidence, 0.75),
      missingInformation: posttradeCalibrated ? [] : ['posttrade_calibration_pending'],
    };
    this.status.lastSimulationTime = new Date();
    this.emit('simulation:completed', result);
    this.emit('evolution:trigger', { learnings: result.learnings, timestamp: new Date(), mode });
    return result;
  } catch (error) {
    this.status.errorCount++;
    log.error('Monte Carlo simulation failed', { error });
    throw error;
  }
}

export function ensureCryptaraBootstrapWiring(): Cryptara {
  const instance = getCryptara();
  if (installed.has(instance)) return instance;
  installed.add(instance);
  const target = instance as unknown as CryptaraInternals;

  target.runMonteCarloSimulation = runBootstrapAwareMonteCarlo.bind(target);

  const originalRecordOpportunity = target.recordOpportunityObservation.bind(target);
  target.recordOpportunityObservation = (context: CryptaraOpportunityContext): CryptaraOpportunityAssessment => {
    const assessment = originalRecordOpportunity(context);
    const evidence = target.latestMonteCarloEvidence;
    const snapshot = canonicalOpportunityState.recordAssessment({
      opportunityId: context.opportunityId,
      observedAt: context.observedAt,
      chain: context.chain,
      symbol: context.symbol,
      plan: context.plan,
      technical: context.tradingView,
      mempool: context.mempool,
      assessment: {
        opportunityId: assessment.opportunityId,
        evaluatedAt: assessment.evaluatedAt,
        recommendation: assessment.recommendation,
        rankScore: assessment.rankScore,
        executionConfidence: assessment.executionConfidence,
        probabilityOfProfitableExecution: assessment.probabilityOfProfitableExecution,
        riskLevel: assessment.riskLevel,
        dataCompleteness: assessment.dataCompleteness,
        marketData: { ...assessment.marketData },
        missingInformation: [...assessment.missingInformation],
        provenance: [...assessment.provenance],
        monteCarlo: evidence && evidence.sourceOpportunityId === context.opportunityId
          ? {
              mode: evidence.mode,
              calibrationSamples: evidence.calibrationSamples,
              evaluatedAt: evidence.evaluatedAt,
              probabilityOfProfit: evidence.probabilityOfProfit,
              confidence: evidence.confidence,
              valueAtRisk95: evidence.valueAtRisk95,
              expectedShortfall: evidence.expectedShortfall,
              maxDrawdown: evidence.maxDrawdown,
              marketRegime: evidence.marketRegime,
            }
          : null,
      },
    });

    const plan = snapshot.plan;
    log.info('Canonical opportunity decision', {
      opportunityId: snapshot.opportunityId,
      symbol: snapshot.symbol,
      chain: snapshot.chain,
      status: snapshot.status,
      buyVenue: plan?.buyVenue ?? null,
      sellVenue: plan?.sellVenue ?? null,
      buyAsk: plan?.buyAsk ?? null,
      sellBid: plan?.sellBid ?? null,
      requestedNotionalUsd: plan?.requestedNotionalUsd ?? null,
      executableNotionalUsd: plan?.executableNotionalUsd ?? null,
      grossProfitUsd: plan?.grossProfitUsd ?? null,
      netProfitUsd: plan?.netProfitUsd ?? null,
      grossSpreadBps: plan ? plan.spreadPct * 100 : null,
      costs: plan?.costs ?? null,
      feeEvidence: plan?.feeEvidence ?? null,
      quoteAgeMs: plan?.quoteAgeMs ?? null,
      expectedSlippageBps: plan?.expectedSlippageBps ?? null,
      expectedPriceImpactBps: plan?.expectedPriceImpactBps ?? null,
      liquidity: plan?.liquidity ?? null,
      marketData: snapshot.assessment?.marketData ?? null,
      technicalProvenance: snapshot.technical?.dataProvenance ?? null,
      technicalSignal: snapshot.technical?.summary.signal ?? null,
      oracle: snapshot.oracle,
      monteCarlo: snapshot.assessment?.monteCarlo ?? null,
      recommendation: snapshot.assessment?.recommendation ?? null,
      rankScore: snapshot.assessment?.rankScore ?? null,
      executionConfidence: snapshot.assessment?.executionConfidence ?? null,
      governance: snapshot.governance,
      missingInformation: snapshot.missingInformation,
      provenance: snapshot.provenance,
    });
    return assessment;
  };

  const originalRecordExecution = target.recordExecutionResult.bind(target);
  target.recordExecutionResult = (feedback: CryptaraExecutionFeedback): void => {
    originalRecordExecution(feedback);
    const snapshot = canonicalOpportunityState.recordExecution({
      opportunityId: feedback.opportunityId,
      chain: feedback.chain,
      symbol: feedback.symbol,
      success: feedback.success,
      realizedProfitUsd: feedback.realizedProfitUsd,
      feeUsd: feedback.feeUsd,
      slippageBps: feedback.slippageBps,
      latencyMs: feedback.latencyMs,
      settlementStatus: feedback.settlementStatus,
      settlementConfirmed: feedback.settlementConfirmed,
      settlement: feedback.settlement,
      provenance: feedback.provenance,
    });
    if (snapshot) {
      log.info('Canonical opportunity settlement update', {
        opportunityId: snapshot.opportunityId,
        symbol: snapshot.symbol,
        status: snapshot.status,
        realized: snapshot.realized,
        settlementStatus: snapshot.settlement?.status ?? snapshot.realized.settlementStatus,
        transactionHash: snapshot.settlement?.transactionHash ?? null,
        blockNumber: snapshot.settlement?.blockNumber ?? null,
      });
    }
  };

  log.info('Cryptara bootstrap wiring installed', {
    monteCarloColdStart: 'measured_pretrade',
    posttradeCalibration: 'terminal_settlement_only',
    canonicalOpportunityState: true,
  });
  return instance;
}