/**
 * CRYPTARA - Crypto Market Surveillance & Trading Intelligence Module
 * 
 * A highly sophisticated advanced crypto-market surveillance and crypto arbitrage/trading 
 * intelligence module that continuously, vigilantly monitors and surveys cryptocurrency 
 * ecosystems, ingests live network data, then with extreme precise accuracy predicts 
 * future patterns, and transforms those signals into parallel strategic crypto omniscience 
 * used to enhance the behavior, adaptability, precision and evolution of the crypto 
 * crawler systems.
 * 
 * CAPABILITIES:
 * - Blockchain analytics and token activity monitoring
 * - Sentiment extraction from crypto sources
 * - Crypto-risk scanning and assessment
 * - Scheduled Monte Carlo simulations
 * - Learn → Adapt → Evolve cycle for crypto crawlers
 * 
 * DOMAIN RESTRICTIONS:
 * - NO access to legal data or OSINT tools
 * - NO access to case-law or legal research
 * - CRYPTARA is isolated to crypto/blockchain operations only
 * - Fires only when scheduled by faucet, but maintains continuous high surveillance
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../logger';
import { CryptaraMarketGateEngine } from './marketGates/index.js';
import type { CryptaraMarketGateConfig, CryptaraMarketGateContext, GateEvaluation } from './marketGates/index.js';
import { getCryptocrawlGovernance } from '../cryptocrawl/governance/index.js';
import { TradingViewEngine, type TechnicalAnalysis, type TradingViewHealthStatus } from '../cryptocrawl/babel/tradingview-integration.js';
import { alchemyIntegration, type MempoolAnalysis, type AlchemyReadinessStatus } from '../cryptocrawl/capital-free/alchemy-integration.js';
import type { VerifiedArbitragePlan } from '../cryptocrawl/arbitrage/arbitrage-verifier.js';
import { marketDataProviders, type DexQuoteObservation, type MarketUniverseAsset } from '../cryptocrawl/intelligence/market-data-providers.js';
import { createMonteCarloEngine, type MarketCondition, type StrategyProfile } from '../cryptocrawl/validation/monte-carlo-engine.js';
import type { ExecutionOutcomeObservation } from '../cryptocrawl/learning/execution-outcome.js';
import type { NormalizedRealizedExecution } from '../cryptocrawl/execution/settlement-types.js';
import { multiProviderRpcManager } from '../cryptocrawl/api/blockchain-providers.js';

const log = createLogger('CRYPTARA');

// ============================================================================
// STAGE 5 SAFETY GATES (NO BACKGROUND LOOPS)
// ============================================================================
//
// Requirements (Stage 5 wiring):
// - CRYPTARA_MODE=SILENT_WATCHER_ONLY => analysis-only, on-demand calls allowed
// - NO_INTERVALS=true => absolutely no timers/intervals created
// - NO_EXECUTION=true => execution layer must remain stubbed elsewhere
//
// IMPORTANT: This module must never start setInterval/setTimeout loops when
// NO_INTERVALS is enabled (or when in SILENT_WATCHER_ONLY mode).
type CryptaraMode = 'NORMAL' | 'SILENT_WATCHER_ONLY';

function getCryptaraMode(): CryptaraMode {
  const raw = (process.env.CRYPTARA_MODE || '').toUpperCase().trim();
  return raw === 'SILENT_WATCHER_ONLY' ? 'SILENT_WATCHER_ONLY' : 'NORMAL';
}

function isNoIntervals(): boolean {
  // Default-deny: background loops are OFF unless explicitly allowed.
  // SILENT_WATCHER_ONLY always disables intervals.
  if (getCryptaraMode() === 'SILENT_WATCHER_ONLY') return true;
  if (process.env.NO_INTERVALS === 'true') return true;
  return process.env.ALLOW_INTERVALS !== 'true';
}

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export interface CryptaraConfig {
  enabled: boolean;
  surveillanceMode: 'continuous' | 'scheduled';
  faucetTriggered: boolean;
  monteCarloInterval: number; // Hours between simulations
  supportedChains: string[];
  blockedDomains: string[]; // Legal/OSINT domains to block
}

export interface MarketSurveillanceData {
  timestamp: Date;
  chain: string;
  tokenActivity: TokenActivity[];
  sentimentScore: number | null;
  riskLevel: 'low' | 'medium' | 'high' | 'critical' | 'unknown';
  patterns: DetectedPattern[];
  predictions: MarketPrediction[];
}

export interface TokenActivity {
  token: string;
  chain: string;
  volume24h: number | null;
  priceChange24h: number | null;
  liquidity: number | null;
  holders: number | null;
  transactions: number | null;
}

export interface DetectedPattern {
  type: string;
  confidence: number;
  description: string;
  timestamp: Date;
  predictedImpact: string;
}

export interface MarketPrediction {
  asset: string;
  timeframe: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  signals: string[];
}

export interface MonteCarloResult {
  simulationId: string;
  timestamp: Date;
  iterations: number;
  scenarios: SimulationScenario[];
  optimalStrategy: string;
  riskMetrics: RiskMetrics;
  learnings: string[];
}

export interface SimulationScenario {
  name: string;
  probability: number;
  expectedReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
}

export interface RiskMetrics {
  valueAtRisk: number;
  expectedShortfall: number;
  maxDrawdown: number;
  volatility: number;
}

export interface CryptaraStatus {
  isRunning: boolean;
  isSurveillanceActive: boolean;
  lastSimulationTime: Date | null;
  totalSimulations: number;
  totalPatterns: number;
  totalPredictions: number;
  errorCount: number;
  uptime: number;
  faucetStatus: 'idle' | 'ready' | 'triggered';
}

export interface SentimentAnalysis {
  timestamp: Date;
  overallSentiment: number; // -1 to 1
  socialVolume: number | null;
  fearGreedIndex: number;
  dominantNarrative: string;
  keyTopics: string[];
}

export interface CrawlerEvolutionData {
  evolutionId: string;
  timestamp: Date;
  improvements: string[];
  adaptations: string[];
  performanceGain: number;
  newCapabilities: string[];
}

export interface CryptaraExecutionFeedback {
  source: 'master_pipeline' | 'zero_capital' | 'flash_loan' | 'manual';
  opportunityId?: string;
  chain: string;
  symbol: string;
  strategy: string;
  success: boolean;
  expectedProfitUsd: number;
  realizedProfitUsd: number | null;
  feeUsd: number | null;
  slippageBps: number | null;
  latencyMs: number;
  usedZeroCapital: boolean;
  timestamp: number;
  notes?: string;
  settlementStatus?: string;
  settlementConfirmed?: boolean;
  provenance?: string[];
  settlement?: NormalizedRealizedExecution;
}

export interface CryptaraAutonomousDirective {
  timestamp: number;
  riskBudget: 'defensive' | 'balanced' | 'aggressive';
  maxSlippageBps: number;
  notionalMultiplier: number;
  minimumNetProfitUsd: number;
  preferredChains: string[];
  preferredExecutionModes: Array<'standard' | 'zero_capital' | 'flashbots'>;
  feeSensitivity: 'low' | 'medium' | 'high';
  liquidityPressure: number;
}

export interface CryptaraChainPerformance {
  chain: string;
  netRealizedProfitUsd: number;
  successfulExecutions: number;
  totalExecutions: number;
  rankingScore: number;
}

export interface CryptaraPerformanceRanking {
  evaluatedAt: number;
  sampleCount: number;
  successfulExecutions: number;
  successRate: number;
  averageNetProfitUsd: number;
  averageSlippageBps: number | null;
  chains: CryptaraChainPerformance[];
  preferredChains: string[];
  directive: CryptaraAutonomousDirective;
}

export interface CryptaraConnectorReadiness {
  checkedAt: number;
  strictLive: boolean;
  liveSignalReady: boolean;
  tradingView: {
    ready: boolean;
    mode: TradingViewHealthStatus['mode'];
    detail: string;
  };
  alchemy: {
    ready: boolean;
    mode: 'live' | 'degraded';
    detail: string;
  };
  rpc: {
    ready: boolean;
    mode: 'live' | 'degraded';
    detail: string;
  };
}

export interface CryptaraRouteObservation {
  chain: string;
  inputToken: string;
  outputToken: string;
  inputAssetSymbol: 'USDC' | 'USDT';
  inputAmountBaseUnits: string;
  outputAmountBaseUnits: string;
  inputTokenDecimals: number;
  outputTokenDecimals: number;
  grossProfitBaseUnits: string;
  expectedNetProfitBaseUnits: string;
  estimatedGasCostBaseUnits: string;
  flashLoanFeeBaseUnits: string;
  relayFeeBaseUnits: string;
  quoteLatencyMs: number;
  route: Array<{
    protocol: string;
    tokenIn: string;
    tokenOut: string;
    amountInBaseUnits: string;
    expectedAmountOutBaseUnits: string;
    fee: number;
  }>;
  observedAt: number;
  expiresAt: number;
  executable: boolean;
}

export interface CryptaraOpportunityContext {
  opportunityId: string;
  observedAt: number;
  chain: string;
  symbol: string;
  plan: VerifiedArbitragePlan | null;
  tradingView: TechnicalAnalysis | null;
  mempool: MempoolAnalysis | null;
  marketUniverse: MarketUniverseAsset[];
  dexObservation: DexQuoteObservation | null;
  routeObservation?: CryptaraRouteObservation;
  missingInformation: string[];
  provenance: string[];
}

export interface CryptaraOpportunityAssessment {
  opportunityId: string;
  evaluatedAt: number;
  recommendation: 'observe' | 'consider' | 'reject';
  rankScore: number | null;
  executionConfidence: number | null;
  netProfitUsd: number | null;
  netProfitMargin: number | null;
  executableNotionalUsd: number | null;
  grossProfitUsd: number | null;
  expectedCostsUsd: number | null;
  expectedSlippageBps: number | null;
  expectedPriceImpactBps: number | null;
  probabilityOfProfitableExecution: number | null;
  monteCarlo: {
    evaluatedAt: number;
    probabilityOfProfit: number;
    confidence: number;
    valueAtRisk95: number;
    expectedShortfall: number;
    maxDrawdown: number;
    marketRegime: string;
  } | null;
  liquidityConfidence: number | null;
  dataCompleteness: number;
  riskLevel: MarketSurveillanceData['riskLevel'] | 'unknown';
  marketData: {
    source: MarketUniverseAsset['source'] | null;
    priceUsd: number | null;
    volume24hUsd: number | null;
    marketCapUsd: number | null;
    priceChange24hPct: number | null;
  };
  routeObservation?: CryptaraRouteObservation;
  missingInformation: string[];
  provenance: string[];
}

export interface CryptaraPredictionCalibration {
  predictions: number;
  evaluated: number;
  correct: number;
  accuracy: number | null;
  meanAbsoluteError: number | null;
}

export interface CryptaraMonteCarloEvidence {
  simulationId: string;
  evaluatedAt: number;
  sourceOpportunityId: string;
  expectedProfit: number;
  probabilityOfProfit: number;
  valueAtRisk95: number;
  expectedShortfall: number;
  maxDrawdown: number;
  marketRegime: string;
  confidence: number;
  missingInformation: string[];
}

// ============================================================================
// BLOCKED DOMAINS (Legal, OSINT, Case Law)
// ============================================================================

const BLOCKED_LEGAL_DOMAINS = [
  // Legal research platforms
  'law.justia.com', 'courtlistener.com', 'casetext.com', 'fastcase.com',
  'lexisnexis.com', 'westlaw.com', 'law.cornell.edu',
  // Government legal resources
  'congress.gov', 'govinfo.gov', 'uscourts.gov', 'justice.gov',
  'supremecourt.gov', 'regulations.gov',
  // OSINT platforms
  'shodan.io', 'censys.io', 'zoomeye.org', 'publicrecords.onlinesearches.com',
  // Legal news
  'law.com', 'law360.com', 'lawfareblog.com', 'scotusblog.com',
  // Public records
  'courtrecords.com', 'publicrecords.com', 'backgroundcheck.com',
];

const SUPPORTED_CHAINS = [
  'ethereum', 'polygon', 'arbitrum', 'optimism', 'avalanche',
  'bsc', 'fantom', 'base', 'zksync', 'solana'
];

// ============================================================================
// CRYPTARA CLASS
// ============================================================================

export class Cryptara extends EventEmitter {
  private static instance: Cryptara | null = null;
  private config: CryptaraConfig;
  private status: CryptaraStatus;
  private surveillanceInterval: NodeJS.Timeout | null = null;
  private simulationInterval: NodeJS.Timeout | null = null;
  private startTime: Date | null = null;
  private recentPatterns: DetectedPattern[] = [];
  private recentPredictions: MarketPrediction[] = [];
  private marketGateEngine = new CryptaraMarketGateEngine();
  private lastTradingViewAnalysis: TechnicalAnalysis | null = null;
  private lastMempoolAnalysis: MempoolAnalysis | null = null;
  private lastSurveillanceData: MarketSurveillanceData | null = null;
  private executionHistory: CryptaraExecutionFeedback[] = [];
  private opportunityAssessments: CryptaraOpportunityAssessment[] = [];
  private pendingOpportunityPredictions = new Map<string, { probability: number; expectedPositive: boolean; observedAt: number }>();
  private predictionCalibration = { predictions: 0, evaluated: 0, correct: 0, absoluteError: 0 };
  private latestMonteCarloEvidence: CryptaraMonteCarloEvidence | null = null;
  private latestOpportunityContext: CryptaraOpportunityContext | null = null;
  private autonomousDirective: CryptaraAutonomousDirective;
  private connectorReadiness: CryptaraConnectorReadiness;

  private constructor(config?: Partial<CryptaraConfig>) {
    super();
    
    this.config = {
      enabled: true,
      surveillanceMode: 'continuous',
      faucetTriggered: false,
      monteCarloInterval: 6, // Every 6 hours
      supportedChains: SUPPORTED_CHAINS,
      blockedDomains: BLOCKED_LEGAL_DOMAINS,
      ...config,
    };

    this.status = {
      isRunning: false,
      isSurveillanceActive: false,
      lastSimulationTime: null,
      totalSimulations: 0,
      totalPatterns: 0,
      totalPredictions: 0,
      errorCount: 0,
      uptime: 0,
      faucetStatus: 'idle',
    };

    this.autonomousDirective = {
      timestamp: Date.now(),
      riskBudget: 'balanced',
      maxSlippageBps: 20,
      notionalMultiplier: 1,
      minimumNetProfitUsd: 10,
      preferredChains: this.config.supportedChains.slice(0, 3),
      preferredExecutionModes: ['standard', 'zero_capital'],
      feeSensitivity: 'medium',
      liquidityPressure: 0,
    };

    this.connectorReadiness = {
      checkedAt: Date.now(),
      strictLive: false,
      liveSignalReady: false,
      tradingView: {
        ready: false,
        mode: 'simulated',
        detail: 'Not checked yet',
      },
      alchemy: {
        ready: false,
        mode: 'degraded',
        detail: 'Not checked yet',
      },
      rpc: {
        ready: false,
        mode: 'degraded',
        detail: 'Not checked yet',
      },
    };
  }

  async validateLiveSignalReadiness(options?: { strictLive?: boolean }): Promise<CryptaraConnectorReadiness> {
    const strictLive = options?.strictLive === true;
    const [tradingView, alchemy] = await Promise.all([
      TradingViewEngine.checkReadiness({ strictLive }),
      alchemyIntegration.readinessCheck({ strictLive }),
    ]);
    let rpcReady = false;
    let rpcDetail = 'No healthy shared RPC provider is configured for ethereum';
    try {
      await multiProviderRpcManager.initialize(['ethereum']);
      const healthyProviders = multiProviderRpcManager.getHealth('ethereum')
        .filter(observation => observation.http.success)
        .map(observation => observation.provider);
      rpcReady = healthyProviders.length > 0;
      if (rpcReady) rpcDetail = `Shared RPC probe succeeded via ${healthyProviders.join(', ')}`;
    } catch (error) {
      rpcDetail = `Shared RPC readiness check failed: ${error instanceof Error ? error.message : String(error)}`;
    }

    const alchemyMode: CryptaraConnectorReadiness['alchemy']['mode'] = alchemy.ready ? 'live' : 'degraded';
    const liveSignalReady = tradingView.ready && rpcReady;

    const readiness: CryptaraConnectorReadiness = {
      checkedAt: Date.now(),
      strictLive,
      liveSignalReady,
      tradingView: {
        ready: tradingView.ready,
        mode: tradingView.mode,
        detail: tradingView.detail,
      },
      alchemy: {
        ready: alchemy.ready,
        mode: alchemyMode,
        detail: alchemy.detail,
      },
      rpc: {
        ready: rpcReady,
        mode: rpcReady ? 'live' : 'degraded',
        detail: rpcDetail,
      },
    };

    this.connectorReadiness = readiness;
    return readiness;
  }

  private recomputeAutonomousDirective(): void {
    const recent = this.executionHistory.slice(-120);
    const ranking = this.calculateExecutionRanking();
    const { successRate, averageNetProfitUsd: avgNetProfit, averageSlippageBps: avgSlippageBps } = ranking;
    const preferredChains = ranking.chains.slice(0, 3).map(chain => chain.chain);

    const riskLevel = this.lastSurveillanceData?.riskLevel || 'medium';
    const liquidityPressure = Math.min(1, (this.lastMempoolAnalysis?.totalPending || 0) / 8000);

    const riskBudget: CryptaraAutonomousDirective['riskBudget'] =
      riskLevel === 'critical' || successRate < 0.45
        ? 'defensive'
        : riskLevel === 'low' && successRate > 0.7 && avgNetProfit > 0
          ? 'aggressive'
          : 'balanced';

    const notionalMultiplier = riskBudget === 'aggressive'
      ? Math.min(1.6, 1 + (successRate - 0.6) * 1.4)
      : riskBudget === 'defensive'
        ? Math.max(0.5, 0.9 - (0.6 - successRate))
        : Math.max(0.7, Math.min(1.2, 0.95 + (successRate - 0.5) * 0.7));

    const maxSlippageBps = avgSlippageBps === null
      ? 0
      : Math.max(
          6,
          Math.min(
            45,
            Math.round(
              (riskBudget === 'defensive' ? 14 : riskBudget === 'aggressive' ? 24 : 18) +
              avgSlippageBps * 0.35 +
              liquidityPressure * 8,
            ),
          ),
        );

    const minimumNetProfitUsd = Math.max(5, Number((8 + liquidityPressure * 18 + (riskBudget === 'defensive' ? 6 : 0)).toFixed(2)));

    const zeroCapitalSamples = recent.filter(entry => entry.usedZeroCapital);
    const zeroCapitalSuccessRate = zeroCapitalSamples.length > 0
      ? zeroCapitalSamples.filter(entry => entry.success).length / zeroCapitalSamples.length
      : 0;

    const preferredExecutionModes: CryptaraAutonomousDirective['preferredExecutionModes'] = ['standard'];
    if (zeroCapitalSuccessRate >= 0.45 || zeroCapitalSamples.length === 0) {
      preferredExecutionModes.push('zero_capital');
    }
    if ((this.lastMempoolAnalysis?.totalPending || 0) > 1200) {
      preferredExecutionModes.push('flashbots');
    }

    this.autonomousDirective = {
      timestamp: Date.now(),
      riskBudget,
      maxSlippageBps,
      notionalMultiplier: Number(notionalMultiplier.toFixed(3)),
      minimumNetProfitUsd,
      preferredChains: preferredChains.length > 0 ? preferredChains : this.config.supportedChains.slice(0, 3),
      preferredExecutionModes,
      feeSensitivity: riskBudget === 'aggressive' ? 'medium' : 'high',
      liquidityPressure: Number(liquidityPressure.toFixed(4)),
    };

    this.emit('directive:updated', this.autonomousDirective);
  }

  recordExecutionResult(feedback: CryptaraExecutionFeedback): void {
    this.executionHistory.push(feedback);
    if (this.executionHistory.length > 1000) {
      this.executionHistory = this.executionHistory.slice(-1000);
    }
    this.updatePredictionCalibration(feedback);
    this.recomputeAutonomousDirective();
  }

  async assessOpportunity(context: CryptaraOpportunityContext): Promise<CryptaraOpportunityAssessment> {
    this.latestOpportunityContext = context;
    let monteCarloMissingInformation: string[] = [];
    if (context.plan && this.status.isRunning) {
      try {
        await this.runMonteCarloSimulation();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        monteCarloMissingInformation = message.startsWith('Cryptara Monte Carlo requires measured context: ')
          ? message.replace('Cryptara Monte Carlo requires measured context: ', '').split(', ').filter(Boolean)
          : ['monte_carlo_evidence'];
        log.warn('Cryptara opportunity Monte Carlo unavailable; retaining explicit incomplete evidence', {
          opportunityId: context.opportunityId,
          error: message,
        });
      }
    }
    return this.recordOpportunityObservation({
      ...context,
      missingInformation: [...context.missingInformation, ...monteCarloMissingInformation],
    });
  }

  recordOpportunityObservation(context: CryptaraOpportunityContext): CryptaraOpportunityAssessment {
    this.latestOpportunityContext = {
      ...context,
      marketUniverse: context.marketUniverse.map(asset => ({ ...asset })),
      routeObservation: context.routeObservation
        ? { ...context.routeObservation, route: context.routeObservation.route.map(leg => ({ ...leg })) }
        : undefined,
      provenance: [...context.provenance],
      missingInformation: [...context.missingInformation],
    };
    const missingInformation = [...new Set(context.missingInformation)];
    const provenance = [...new Set(context.provenance)];
    if (!context.mempool?.available || context.mempool.observedAt === null) missingInformation.push('mempool_evidence');
    const marketAsset = context.marketUniverse.find(asset => asset.symbol === context.symbol);
    const now = Date.now();
    const marketMaxAgeMs = Math.max(30_000, Number(process.env.COINGECKO_MARKET_TTL_MS || 300_000));
    const dexMaxAgeMs = Math.max(500, Number(process.env.ZEROX_QUOTE_TTL_MS || 2_000));
    const tradingViewMaxAgeMs = Math.max(30_000, Number(process.env.TRADINGVIEW_DATA_TTL_MS || 300_000));
    const dexIsFresh = !!context.dexObservation && now - context.dexObservation.observedAt <= dexMaxAgeMs;
    const routeIsFresh = !!context.routeObservation && now <= context.routeObservation.expiresAt && context.routeObservation.observedAt <= now;
    const marketData = {
      source: marketAsset?.source || null,
      priceUsd: marketAsset?.priceUsd ?? null,
      volume24hUsd: marketAsset?.volume24hUsd ?? null,
      marketCapUsd: marketAsset?.marketCapUsd ?? null,
      priceChange24hPct: marketAsset?.priceChange24hPct ?? null,
    };
    if (!marketAsset) missingInformation.push('provider_market_asset');
    if (marketData.priceUsd === null) missingInformation.push('provider_price_usd');
    if (marketData.volume24hUsd === null) missingInformation.push('provider_volume_24h_usd');
    if (marketAsset && now - marketAsset.observedAt > marketMaxAgeMs) missingInformation.push('stale_provider_market_data');
    if (context.dexObservation && !dexIsFresh) missingInformation.push('stale_dex_quote');
    if (context.routeObservation && !routeIsFresh) missingInformation.push('stale_configured_route_quote');
    if (context.tradingView && now - context.tradingView.sourceTimestamp > tradingViewMaxAgeMs) missingInformation.push('stale_trading_view_analysis');
    const plan = context.plan;
    const hasPlanEconomics = !!plan && Number.isFinite(plan.netProfitUsd) && Number.isFinite(plan.notionalUsd) && plan.notionalUsd > 0;
    const routeMarketAsset = context.routeObservation
      ? context.marketUniverse.find(asset => asset.symbol.toUpperCase() === context.routeObservation!.inputAssetSymbol)
      : undefined;
    const routePriceUsd = routeMarketAsset?.priceUsd;
    const routeProfitBaseUnits = context.routeObservation ? Number(context.routeObservation.expectedNetProfitBaseUnits) : NaN;
    const routeAmountBaseUnits = context.routeObservation ? Number(context.routeObservation.inputAmountBaseUnits) : NaN;
    const routeScale = context.routeObservation ? 10 ** context.routeObservation.inputTokenDecimals : 1;
    const routeNetProfitUsd = routeIsFresh && Number.isFinite(routeProfitBaseUnits) && Number.isFinite(routePriceUsd)
      ? (routeProfitBaseUnits / routeScale) * routePriceUsd!
      : null;
    const routeNotionalUsd = routeIsFresh && Number.isFinite(routeAmountBaseUnits) && Number.isFinite(routePriceUsd)
      ? (routeAmountBaseUnits / routeScale) * routePriceUsd!
      : null;
    if (context.routeObservation && routeNetProfitUsd === null) missingInformation.push('route_input_price_usd');
    const hasRouteEconomics = routeNetProfitUsd !== null && routeNotionalUsd !== null && routeNotionalUsd > 0;
    const netProfitUsd = hasPlanEconomics ? plan!.netProfitUsd : hasRouteEconomics ? routeNetProfitUsd : null;
    const netProfitMargin = hasPlanEconomics
      ? plan!.netProfitUsd / plan!.notionalUsd
      : hasRouteEconomics ? routeNetProfitUsd! / routeNotionalUsd! : null;
    const monteCarloMaxAgeMs = Math.max(60_000, Number(process.env.CRYPTARA_MONTE_CARLO_TTL_MS || 900_000));
    const monteCarlo = this.latestMonteCarloEvidence &&
      this.latestMonteCarloEvidence.sourceOpportunityId === context.opportunityId &&
      context.observedAt - this.latestMonteCarloEvidence.evaluatedAt <= monteCarloMaxAgeMs &&
      now - this.latestMonteCarloEvidence.evaluatedAt <= monteCarloMaxAgeMs &&
      Number.isFinite(this.latestMonteCarloEvidence.probabilityOfProfit) &&
      this.latestMonteCarloEvidence.probabilityOfProfit >= 0 &&
      this.latestMonteCarloEvidence.probabilityOfProfit <= 1 &&
      Number.isFinite(this.latestMonteCarloEvidence.confidence) &&
      this.latestMonteCarloEvidence.confidence >= 0 &&
      this.latestMonteCarloEvidence.confidence <= 1
      ? { ...this.latestMonteCarloEvidence }
      : null;
    if (context.plan && !monteCarlo && !missingInformation.includes('monte_carlo_evidence')) {
      missingInformation.push('monte_carlo_evidence');
    }
    if (monteCarlo) provenance.push('cryptara_monte_carlo');
    const quoteFreshness = hasPlanEconomics && plan && Number.isFinite(plan.quoteAgeMs)
      ? Math.max(0, Math.min(1, 1 - plan.quoteAgeMs / Math.max(1, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5000))))
      : routeIsFresh && context.routeObservation
        ? Math.max(0, Math.min(1, 1 - (now - context.routeObservation.observedAt) / Math.max(1, context.routeObservation.expiresAt - context.routeObservation.observedAt)))
        : null;
    const liquidityEvidence = dexIsFresh
      ? (context.dexObservation.liquidityAvailable ? 1 : 0)
      : plan?.liquidity.status === 'measured'
        ? 1
        : null;
    const marketRisk = this.deriveOpportunityRisk(context, missingInformation);
    const riskPenalty = marketRisk === 'critical' ? 0.9 : marketRisk === 'high' ? 0.65 : marketRisk === 'medium' ? 0.35 : marketRisk === 'low' ? 0.1 : null;
    const hasExecutableEvidence = hasPlanEconomics || (hasRouteEconomics && context.routeObservation?.executable === true);
    const executionConfidence = hasExecutableEvidence && quoteFreshness !== null && riskPenalty !== null
      ? Number(Math.max(0, Math.min(1, quoteFreshness * 0.55 + (liquidityEvidence || 0) * 0.2 + Math.max(0, 1 - riskPenalty) * 0.25)).toFixed(4))
      : null;
    const probabilityOfProfitableExecution = executionConfidence !== null && monteCarlo !== null
      ? Math.min(executionConfidence, monteCarlo.probabilityOfProfit)
      : null;
    const dataCompleteness = Number(Math.max(0, Math.min(1, 1 - missingInformation.length / 8)).toFixed(4));
    const rankScore = netProfitMargin !== null && probabilityOfProfitableExecution !== null
      ? Number((netProfitMargin * 10000 * probabilityOfProfitableExecution * dataCompleteness).toFixed(4))
      : null;
    const recommendation: CryptaraOpportunityAssessment['recommendation'] =
      rankScore === null ? 'observe' : rankScore > 0 && probabilityOfProfitableExecution! >= 0.6 ? 'consider' : 'reject';
    const assessment: CryptaraOpportunityAssessment = {
      opportunityId: context.opportunityId,
      evaluatedAt: Date.now(),
      recommendation,
      rankScore,
      executionConfidence,
      netProfitUsd,
      netProfitMargin,
      executableNotionalUsd: plan?.executableNotionalUsd ?? routeNotionalUsd,
      grossProfitUsd: plan?.grossProfitUsd ?? (context.routeObservation && routeMarketAsset?.priceUsd !== undefined
        ? (Number(context.routeObservation.grossProfitBaseUnits) / routeScale) * routeMarketAsset.priceUsd
        : null),
      expectedCostsUsd: plan?.costs.totalCostsUsd ?? (context.routeObservation && routeMarketAsset?.priceUsd !== undefined
        ? ((Number(context.routeObservation.estimatedGasCostBaseUnits) + Number(context.routeObservation.flashLoanFeeBaseUnits) + Number(context.routeObservation.relayFeeBaseUnits)) / routeScale) * routeMarketAsset.priceUsd
        : null),
      expectedSlippageBps: plan?.expectedSlippageBps ?? null,
      expectedPriceImpactBps: plan?.expectedPriceImpactBps ?? null,
      probabilityOfProfitableExecution,
      monteCarlo,
      liquidityConfidence: liquidityEvidence,
      dataCompleteness,
      riskLevel: marketRisk,
      marketData,
      routeObservation: context.routeObservation
        ? { ...context.routeObservation, route: context.routeObservation.route.map(leg => ({ ...leg })) }
        : undefined,
      missingInformation,
      provenance,
    };

    this.opportunityAssessments.push(assessment);
    if (this.opportunityAssessments.length > 200) this.opportunityAssessments.shift();
    this.predictionCalibration.predictions++;
    if (executionConfidence !== null) {
      this.pendingOpportunityPredictions.set(context.opportunityId, {
        probability: executionConfidence,
        expectedPositive: netProfitUsd !== null && netProfitUsd > 0,
        observedAt: context.observedAt,
      });
    }
    this.emit('opportunity:assessed', assessment);
    return { ...assessment, marketData: { ...assessment.marketData }, missingInformation: [...missingInformation], provenance: [...provenance] };
  }

  getLatestOpportunityAssessment(): CryptaraOpportunityAssessment | null {
    const assessment = this.opportunityAssessments[this.opportunityAssessments.length - 1];
    return assessment ? { ...assessment, marketData: { ...assessment.marketData }, missingInformation: [...assessment.missingInformation], provenance: [...assessment.provenance] } : null;
  }

  getPredictionCalibration(): CryptaraPredictionCalibration {
    return {
      predictions: this.predictionCalibration.predictions,
      evaluated: this.predictionCalibration.evaluated,
      correct: this.predictionCalibration.correct,
      accuracy: this.predictionCalibration.evaluated > 0 ? this.predictionCalibration.correct / this.predictionCalibration.evaluated : null,
      meanAbsoluteError: this.predictionCalibration.evaluated > 0
        ? this.predictionCalibration.absoluteError / this.predictionCalibration.evaluated
        : null,
    };
  }

  getPendingOpportunityPrediction(opportunityId?: string): ExecutionOutcomeObservation['prediction'] | undefined {
    if (!opportunityId) return undefined;
    const prediction = this.pendingOpportunityPredictions.get(opportunityId);
    return prediction
      ? {
          probability: prediction.probability,
          expectedPositive: prediction.expectedPositive,
          observedAt: prediction.observedAt,
          model: 'cryptara-opportunity-assessment',
        }
      : undefined;
  }

  getLatestMonteCarloEvidence(): CryptaraMonteCarloEvidence | null {
    return this.latestMonteCarloEvidence
      ? { ...this.latestMonteCarloEvidence, missingInformation: [...this.latestMonteCarloEvidence.missingInformation] }
      : null;
  }

  private updatePredictionCalibration(feedback: CryptaraExecutionFeedback): void {
    if (!feedback.opportunityId) return;
    const prediction = this.pendingOpportunityPredictions.get(feedback.opportunityId);
    if (!prediction) return;
    const predictionTtlMs = Math.max(60_000, Number(process.env.CRYPTARA_PREDICTION_TTL_MS || 900_000));
    if (feedback.timestamp - prediction.observedAt > predictionTtlMs) {
      this.pendingOpportunityPredictions.delete(feedback.opportunityId);
      return;
    }
    const realizedPositive = feedback.success && feedback.realizedProfitUsd !== null && feedback.realizedProfitUsd > 0;
    this.predictionCalibration.evaluated++;
    if (prediction.expectedPositive === realizedPositive) this.predictionCalibration.correct++;
    this.predictionCalibration.absoluteError += Math.abs(prediction.probability - (realizedPositive ? 1 : 0));
    this.pendingOpportunityPredictions.delete(feedback.opportunityId);
  }

  private deriveOpportunityRisk(context: CryptaraOpportunityContext, missingInformation: string[]): CryptaraOpportunityAssessment['riskLevel'] {
    const hasMempoolEvidence = context.mempool?.available === true && context.mempool.observedAt !== null;
    const pending = hasMempoolEvidence ? context.mempool?.totalPending : undefined;
    if (!context.tradingView && !hasMempoolEvidence) {
      if (!missingInformation.includes('market_risk_signals')) missingInformation.push('market_risk_signals');
      return 'unknown';
    }
    if (!hasMempoolEvidence && !missingInformation.includes('mempool_evidence')) missingInformation.push('mempool_evidence');
    const signal = context.tradingView?.summary.signal;
    const congestionRisk = pending !== undefined && pending > 8000;
      if (congestionRisk || signal === 'strong_sell') return 'critical';
    if (pending !== undefined && pending > 2000 || signal === 'sell') return 'high';
    if (pending !== undefined && pending > 1000 || signal === 'neutral') return 'medium';
    return 'low';
  }

  restoreExecutionHistory(history: CryptaraExecutionFeedback[]): void {
    this.executionHistory = history
      .filter(entry =>
        typeof entry.chain === 'string' &&
        typeof entry.symbol === 'string' &&
        typeof entry.strategy === 'string' &&
        typeof entry.success === 'boolean' &&
        Number.isFinite(entry.expectedProfitUsd) &&
        (entry.realizedProfitUsd === null || Number.isFinite(entry.realizedProfitUsd)) &&
        (entry.feeUsd === null || Number.isFinite(entry.feeUsd)) &&
        (entry.slippageBps === null || Number.isFinite(entry.slippageBps)) &&
        Number.isFinite(entry.latencyMs) &&
        Number.isFinite(entry.timestamp),
      )
      .slice(-1000)
      .map(entry => ({
        ...entry,
        provenance: entry.provenance ? [...entry.provenance] : undefined,
      }));
    this.recomputeAutonomousDirective();
  }

  getAutonomousDirective(): CryptaraAutonomousDirective {
    return { ...this.autonomousDirective, preferredChains: [...this.autonomousDirective.preferredChains], preferredExecutionModes: [...this.autonomousDirective.preferredExecutionModes] };
  }

  getPerformanceRanking(): CryptaraPerformanceRanking {
    const ranking = this.calculateExecutionRanking();
    return {
      evaluatedAt: Date.now(),
      ...ranking,
      preferredChains: [...this.autonomousDirective.preferredChains],
      directive: this.getAutonomousDirective(),
    };
  }

  getExecutionHistory(limit: number = 100): CryptaraExecutionFeedback[] {
    return this.executionHistory.slice(-Math.max(1, limit));
  }

  private calculateExecutionRanking(): Omit<CryptaraPerformanceRanking, 'evaluatedAt' | 'preferredChains' | 'directive'> {
    const recent = this.executionHistory.slice(-120);
    const successful = recent.filter(entry => entry.success);
    const measuredSuccessful = successful.filter(entry => entry.realizedProfitUsd !== null);
    const successRate = recent.length > 0 ? successful.length / recent.length : 0.5;
    const averageNetProfitUsd = measuredSuccessful.length > 0
      ? measuredSuccessful.reduce((sum, entry) => sum + entry.realizedProfitUsd!, 0) / measuredSuccessful.length
      : 0;
    const measuredSlippage = recent.filter(entry => entry.slippageBps !== null);
    const averageSlippageBps = measuredSlippage.length > 0
      ? measuredSlippage.reduce((sum, entry) => sum + Math.max(0, entry.slippageBps!), 0) / measuredSlippage.length
      : null;
    const chainPerformance = new Map<string, { net: number; wins: number; total: number }>();
    for (const entry of recent) {
      const current = chainPerformance.get(entry.chain) || { net: 0, wins: 0, total: 0 };
      if (entry.realizedProfitUsd !== null) current.net += entry.realizedProfitUsd;
      current.total += 1;
      if (entry.success) current.wins += 1;
      chainPerformance.set(entry.chain, current);
    }
    const chains = Array.from(chainPerformance.entries())
      .map(([chain, performance]) => ({
        chain,
        netRealizedProfitUsd: performance.net,
        successfulExecutions: performance.wins,
        totalExecutions: performance.total,
        rankingScore: performance.net + (performance.wins / Math.max(1, performance.total)) * 10,
      }))
      .sort((a, b) => b.rankingScore - a.rankingScore);

    return {
      sampleCount: recent.length,
      successfulExecutions: successful.length,
      successRate,
      averageNetProfitUsd,
      averageSlippageBps,
      chains,
    };
  }

  getConnectorReadiness(): CryptaraConnectorReadiness {
    return {
      ...this.connectorReadiness,
      tradingView: { ...this.connectorReadiness.tradingView },
      alchemy: { ...this.connectorReadiness.alchemy },
      rpc: { ...this.connectorReadiness.rpc },
    };
  }

  /**
   * Get singleton instance of CRYPTARA
   */
  static getInstance(config?: Partial<CryptaraConfig>): Cryptara {
    if (!Cryptara.instance) {
      Cryptara.instance = new Cryptara(config);
    }
    return Cryptara.instance;
  }

  /**
   * Initialize and start CRYPTARA
   */
  async initialize(): Promise<void> {
    if (this.status.isRunning) {
      log.warn('CRYPTARA is already running');
      return;
    }

    log.info('Initializing CRYPTARA - Crypto Market Surveillance & Trading Intelligence');
    
    this.startTime = new Date();
    this.status.isRunning = true;
    this.status.faucetStatus = 'ready';
    this.status.isSurveillanceActive = false;

    // Stage 5: SILENT_WATCHER_ONLY + NO_INTERVALS => no background timers.
    if (isNoIntervals()) {
      log.info('CRYPTARA initialized in NO_INTERVALS/SILENT_WATCHER_ONLY mode (no background loops)');
    } else {
      TradingViewEngine.initialize();

      try {
        await alchemyIntegration.start(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base']);
      } catch (error) {
        log.warn('Alchemy live telemetry failed to initialize; continuing with partial market signals', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Start continuous surveillance
      if (this.config.enabled && this.config.surveillanceMode === 'continuous') {
        this.startSurveillance();
      }

      // Schedule Monte Carlo simulations
      if (this.config.enabled) {
        this.scheduleSimulations();
      }
    }

    const strictLive = process.env.CRYPTARA_REQUIRE_LIVE_SIGNALS === 'true';
    const readiness = await this.validateLiveSignalReadiness({ strictLive });
    if (!readiness.liveSignalReady) {
      log.warn('CRYPTARA live signal stack is degraded', {
        tradingView: readiness.tradingView,
        alchemy: readiness.alchemy,
        rpc: readiness.rpc,
      });
      if (strictLive) {
        throw new Error(`Cryptara strict-live initialization failed: ${readiness.tradingView.detail}; ${readiness.rpc.detail}`);
      }
    }

    this.emit('initialized', { timestamp: new Date() });
    log.info('CRYPTARA initialized successfully', {
      supportedChains: this.config.supportedChains.length,
      blockedDomains: this.config.blockedDomains.length,
      liveSignalReady: readiness.liveSignalReady,
    });
  }

  /**
   * Start continuous market surveillance
   */
  private startSurveillance(): void {
    if (isNoIntervals()) {
      log.info('Surveillance timers disabled (NO_INTERVALS/SILENT_WATCHER_ONLY)');
      this.status.isSurveillanceActive = false;
      return;
    }
    this.status.isSurveillanceActive = true;
    
    // Run surveillance every minute
    this.surveillanceInterval = setInterval(async () => {
      await this.performSurveillance();
    }, 60000);

    log.info('Continuous market surveillance started');
    
    // Run initial surveillance
    setTimeout(async () => {
      await this.performSurveillance();
    }, 5000);
  }

  /**
   * Perform market surveillance cycle
   */
  private async performSurveillance(): Promise<void> {
    if (!this.status.isRunning) return;

    try {
        // Combine live market-provider observations with the live signal streams.
      const surveillanceData = await this.collectMarketData();
      
      // Detect patterns
      const patterns = this.detectPatterns(surveillanceData);
      this.recentPatterns.push(...patterns);
      this.status.totalPatterns += patterns.length;
      
      // Generate predictions
      const predictions = this.generatePredictions(surveillanceData, patterns);
      this.recentPredictions.push(...predictions);
      this.status.totalPredictions += predictions.length;

      // Keep only recent data
      this.recentPatterns = this.recentPatterns.slice(-100);
      this.recentPredictions = this.recentPredictions.slice(-100);

      this.emit('surveillance:completed', { 
        timestamp: new Date(),
        patternsFound: patterns.length,
        predictionsGenerated: predictions.length,
      });

      this.recomputeAutonomousDirective();
    } catch (error) {
      this.status.errorCount++;
      log.error('Surveillance cycle failed', { error });
    }
  }

  /**
   * Collect market data from supported chains
   */
  private async collectMarketData(): Promise<MarketSurveillanceData> {
    const symbol = (process.env.CRYPTARA_SIGNAL_SYMBOL || 'BTCUSDT').toUpperCase();

    const analysis = await TradingViewEngine.getAnalysis(symbol, '1h');
    this.lastTradingViewAnalysis = analysis;
    const marketUniverse = await marketDataProviders.discoverUniverse();

    let mempool: MempoolAnalysis | null = null;

    try {
      const observedMempool = alchemyIntegration.getMempoolAnalysis();
      if (observedMempool.available && observedMempool.observedAt !== null) {
        mempool = observedMempool;
        this.lastMempoolAnalysis = mempool;
      } else {
        this.lastMempoolAnalysis = null;
      }
    } catch {
      this.lastMempoolAnalysis = null;
    }

    const signalScore = TradingViewEngine.signalToScore(analysis.summary.signal);
    const normalizedSignal = signalScore / 2; // -1..1
    const riskIndex = mempool
      ? Math.max(
          0,
          Math.min(
            1,
            0.25 +
              Math.min(1, mempool.totalPending / 8000) * 0.35 +
              Math.min(1, mempool.avgGasPrice / 180_000_000_000) * 0.25 +
              (normalizedSignal < 0 ? Math.abs(normalizedSignal) * 0.3 : 0),
          )
        )
      : Number.NaN;

    const riskLevel: MarketSurveillanceData['riskLevel'] =
      !Number.isFinite(riskIndex) ? 'unknown' :
      riskIndex >= 0.85 ? 'critical' :
      riskIndex >= 0.65 ? 'high' :
      riskIndex >= 0.4 ? 'medium' :
      'low';

    const tokenActivity: TokenActivity[] = marketUniverse.map(asset => ({
      token: asset.symbol.replace(/USDT$|USDC$|USD$/, ''),
      chain: 'unknown',
      volume24h: asset.volume24hUsd ?? null,
      priceChange24h: asset.priceChange24hPct ?? null,
      liquidity: null,
      holders: null,
      transactions: null,
    }));

    const surveillance: MarketSurveillanceData = {
      timestamp: new Date(),
      chain: 'unknown',
      tokenActivity,
      sentimentScore: Number.isFinite(riskIndex) ? Math.max(-1, Math.min(1, normalizedSignal - riskIndex * 0.25)) : null,
      riskLevel,
      patterns: [],
      predictions: [],
    };

    this.lastSurveillanceData = surveillance;
    return surveillance;
  }

  /**
   * Detect patterns in market data
   */
  private detectPatterns(data: MarketSurveillanceData): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];
    const analysis = this.lastTradingViewAnalysis;
    const mempool = this.lastMempoolAnalysis;

    if (analysis) {
      const trendSignal = analysis.summary.signal;
      if (trendSignal !== 'neutral') {
        patterns.push({
          type: 'trend_regime_shift',
          confidence: Math.min(0.95, Math.max(0.55, analysis.summary.strength / 100)),
          description: `TradingView regime indicates ${trendSignal.replace('_', ' ')}`,
          timestamp: new Date(),
          predictedImpact: trendSignal.includes('buy')
            ? 'Favorable directional momentum for optimized entry windows'
            : 'Defensive posture advised; tighten risk and slippage controls',
        });
      }
    }

    if (mempool && mempool.totalPending > 1500) {
      patterns.push({
        type: 'mempool_congestion_wave',
        confidence: Math.min(0.92, 0.5 + mempool.totalPending / 12000),
        description: `Elevated pending transaction pressure (${mempool.totalPending})`,
        timestamp: new Date(),
        predictedImpact: 'Execution latency and gas spread likely elevated across venues',
      });
    }

    if (mempool && mempool.arbitrageOpportunities.length > 0) {
      patterns.push({
        type: 'cross_venue_arbitrage_cluster',
        confidence: Math.min(0.9, 0.55 + mempool.arbitrageOpportunities.length / 30),
        description: `${mempool.arbitrageOpportunities.length} mempool-level arbitrage signatures detected`,
        timestamp: new Date(),
        predictedImpact: 'Routing engine should prioritize low-latency paths and strict slippage caps',
      });
    }

    if (data.riskLevel === 'high' || data.riskLevel === 'critical') {
      patterns.push({
        type: 'risk_off_regime',
        confidence: data.riskLevel === 'critical' ? 0.95 : 0.82,
        description: `Risk regime escalated to ${data.riskLevel}`,
        timestamp: new Date(),
        predictedImpact: 'Reduce notional sizing and enforce defensive execution thresholds',
      });
    }

    return patterns;
  }

  /**
   * Generate market predictions
   */
  private generatePredictions(
    data: MarketSurveillanceData, 
    patterns: DetectedPattern[]
  ): MarketPrediction[] {
    const analysis = this.lastTradingViewAnalysis;
    if (!analysis) return [];

    const direction = this.signalToDirection(analysis.summary.signal);
    const baseConfidence = Math.max(0.45, Math.min(0.92, analysis.summary.strength / 100));
    const riskPenalty = data.riskLevel === 'critical' ? 0.18 : data.riskLevel === 'high' ? 0.1 : data.riskLevel === 'unknown' ? 0.15 : 0.04;
    const patternBoost = Math.min(0.12, patterns.length * 0.03);
    const confidence = Math.max(0.3, Math.min(0.97, baseConfidence + patternBoost - riskPenalty));

    const primary: MarketPrediction = {
      asset: analysis.symbol,
      timeframe: '1h',
      direction,
      confidence,
      signals: [
        `tradingview:${analysis.summary.signal}`,
        `risk:${data.riskLevel}`,
        ...patterns.map(pattern => pattern.type),
      ],
    };

    return [primary];
  }

  /**
   * Schedule Monte Carlo simulations
   */
  private scheduleSimulations(): void {
    if (isNoIntervals()) {
      log.info('Monte Carlo scheduling disabled (NO_INTERVALS/SILENT_WATCHER_ONLY)');
      return;
    }
    const intervalMs = this.config.monteCarloInterval * 60 * 60 * 1000;
    
    this.simulationInterval = setInterval(async () => {
      if (!this.latestOpportunityContext) return;
      await this.runMonteCarloSimulation();
    }, intervalMs);

    log.info('Monte Carlo simulations scheduled', {
      intervalHours: this.config.monteCarloInterval,
    });
  }

  /**
   * Run Monte Carlo simulation for strategy optimization
   */
  async runMonteCarloSimulation(): Promise<MonteCarloResult> {
    if (!this.status.isRunning) {
      throw new Error('CRYPTARA is not running. Call initialize() first.');
    }

    const context = this.latestOpportunityContext;
    const marketAsset = context?.marketUniverse.find(asset => asset.symbol === context.symbol);
    const priceHistory = marketAsset?.priceHistory;
    const mempool = context?.mempool;
    const executionHistory = context
      ? this.executionHistory.filter(entry => entry.symbol === context.symbol)
      : [];
    const measuredExecutionHistory = executionHistory.filter(entry =>
      entry.realizedProfitUsd !== null && Number.isFinite(entry.realizedProfitUsd),
    );
    const missingInformation: string[] = [];
    if (!context?.plan) missingInformation.push('verified_opportunity_economics');
    if (!priceHistory || priceHistory.length < 20) missingInformation.push('price_history');
    if (!mempool || mempool.avgGasPrice <= 0 || mempool.maxGasPrice <= 0) missingInformation.push('gas_observations');
    if (context?.tradingView?.dataProvenance !== 'live') missingInformation.push('live_technical_analysis');
    if (measuredExecutionHistory.length < 3) missingInformation.push('measured_execution_outcomes');
    if (!measuredExecutionHistory.some(entry => Number.isFinite(entry.latencyMs) && entry.latencyMs > 0)) missingInformation.push('measured_execution_latency');
    if (context?.plan && context.plan.quoteAgeMs > Math.max(1, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5000))) missingInformation.push('fresh_verified_quote');
    if (marketAsset && Date.now() - marketAsset.observedAt > Math.max(30_000, Number(process.env.COINGECKO_MARKET_TTL_MS || 300_000))) missingInformation.push('fresh_price_history');
    if (missingInformation.length > 0) {
      throw new Error(`Cryptara Monte Carlo requires measured context: ${missingInformation.join(', ')}`);
    }

    log.info('Starting Cryptara Monte Carlo simulation from measured opportunity context', {
      opportunityId: context.opportunityId,
      symbol: context.symbol,
    });
    this.status.totalSimulations++;

    try {
      const returns = priceHistory.slice(1).map((price, index) => (price - priceHistory[index]) / priceHistory[index]);
      const volatility = Math.sqrt(returns.reduce((sum, value) => sum + Math.pow(value, 2), 0) / returns.length) * Math.sqrt(365 * 24);
      const gasRange = (mempool.maxGasPrice - mempool.avgGasPrice) / mempool.avgGasPrice;
      const market: MarketCondition = {
        volatility: Math.max(0.01, Math.min(2, volatility)),
        liquidityScore: Math.max(0, Math.min(1, Math.min(
          context.plan!.liquidity.buyAvailableBaseQty ?? 0,
          context.plan!.liquidity.sellAvailableBaseQty ?? 0,
        ) / Math.max(context.plan!.baseQty, 1e-12))),
        gasVolatility: Math.max(0, Math.min(2, gasRange)),
        competitorDensity: Math.max(0, Math.min(1, mempool.arbitrageOpportunities.length / Math.max(1, mempool.swapTransactions))),
        networkCongestion: Math.max(0, Math.min(1, mempool.totalPending / 8000)),
        priceHistory,
        volumeHistory: marketAsset?.volume24hUsd ? [marketAsset.volume24hUsd] : [],
        gasHistory: [mempool.avgGasPrice, mempool.maxGasPrice],
      };
      const plan = context.plan;
      const successRate = measuredExecutionHistory.filter(entry => entry.success).length / measuredExecutionHistory.length;
      const timestamps = measuredExecutionHistory.map(entry => entry.timestamp).filter(timestamp => Number.isFinite(timestamp)).sort((left, right) => left - right);
      const observedDays = timestamps.length > 1
        ? Math.max(1 / 24, (timestamps[timestamps.length - 1] - timestamps[0]) / (24 * 60 * 60 * 1000))
        : 1;
      const observedLatencyMs = measuredExecutionHistory
        .map(entry => entry.latencyMs)
        .filter(latency => Number.isFinite(latency) && latency > 0)
        .reduce((sum, latency, _index, values) => sum + latency / values.length, 0);
      const strategy: StrategyProfile = {
        name: 'verified-arbitrage-context',
        baseSuccessRate: successRate,
        avgProfitPerTrade: Math.max(0.0001, plan!.netProfitUsd / plan!.notionalUsd),
        avgLossPerTrade: measuredExecutionHistory.length > 0
          ? Math.max(0.0001, Math.abs(Math.min(...measuredExecutionHistory.map(entry => entry.realizedProfitUsd!))) / plan!.notionalUsd)
          : Math.max(0.0001, plan!.costs.totalCostsUsd / plan!.notionalUsd),
        tradesPerDay: measuredExecutionHistory.length / observedDays,
        gasPerTrade: plan!.costs.gasUsd / plan!.notionalUsd,
        slippageTolerance: Math.max(0.0001, (plan!.expectedSlippageBps ?? 0) / 10_000),
        executionLatency: observedLatencyMs,
        strategyType: 'arbitrage',
        mlFilterEnabled: false,
        multiChainEnabled: !!plan!.bridge,
        mempoolMonitoring: true,
      };
      const simulation = await createMonteCarloEngine({ simulations: 1000, timeHorizonDays: 1, ensembleCount: 3 }).runSimulation(strategy, market);
      const result: MonteCarloResult = {
        simulationId: `sim-${Date.now()}`,
        timestamp: new Date(),
        iterations: 1000,
        scenarios: [
          { name: 'Measured opportunity distribution', probability: simulation.scenarioResults.probabilityOfProfit, expectedReturn: simulation.expectedProfit, maxDrawdown: simulation.maxDrawdown, sharpeRatio: simulation.sharpeRatio },
        ],
        optimalStrategy: 'verified-arbitrage-context',
        riskMetrics: {
          valueAtRisk: simulation.valueAtRisk95,
          expectedShortfall: simulation.conditionalVaR,
          maxDrawdown: simulation.maxDrawdown,
          volatility: simulation.marketRegime.volatilityPercentile / 100,
        },
        learnings: simulation.performanceBreakdown.recommendation ? [simulation.performanceBreakdown.recommendation] : [],
      };
      this.latestMonteCarloEvidence = {
        simulationId: result.simulationId,
        evaluatedAt: Date.now(),
        sourceOpportunityId: context.opportunityId,
        expectedProfit: simulation.expectedProfit,
        probabilityOfProfit: simulation.scenarioResults.probabilityOfProfit,
        valueAtRisk95: simulation.valueAtRisk95,
        expectedShortfall: simulation.conditionalVaR,
        maxDrawdown: simulation.maxDrawdown,
        marketRegime: simulation.marketRegime.regime,
        confidence: simulation.ensembleConfidence,
        missingInformation: [],
      };

      this.status.lastSimulationTime = new Date();
      
      // Emit event for crawler evolution
      this.emit('simulation:completed', result);
      this.emit('evolution:trigger', {
        learnings: result.learnings,
        timestamp: new Date(),
      });

      return result;
    } catch (error) {
      this.status.errorCount++;
      log.error('Monte Carlo simulation failed', { error });
      throw error;
    }
  }

  /**
   * Validate that a URL is not in blocked domains (legal/OSINT)
   */
  validateUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.toLowerCase();
      
      // Check if domain is blocked (legal, OSINT, case law)
      for (const blocked of this.config.blockedDomains) {
        if (domain.includes(blocked) || domain.endsWith(blocked)) {
          log.warn('CRYPTARA blocked access to legal/OSINT domain', { url, blocked });
          return false;
        }
      }
      
      return true;
    } catch {
      return false;
    }
  }

  private signalToDirection(signal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell'): 'bullish' | 'bearish' | 'neutral' {
    if (signal === 'strong_buy' || signal === 'buy') return 'bullish';
    if (signal === 'strong_sell' || signal === 'sell') return 'bearish';
    return 'neutral';
  }

  private selectOptimalStrategy(
    signal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell',
    riskLevel: 'low' | 'medium' | 'high' | 'critical'
  ): string {
    if (riskLevel === 'critical') {
      return 'Capital-preservation mode: no aggressive routing, strict slippage guard, selective execution only';
    }

    if (riskLevel === 'high') {
      return 'Defensive execution: reduced notional, venue-latency filtering, and fee-aware routing';
    }

    if (signal === 'strong_buy' || signal === 'buy') {
      return 'Momentum-aligned arbitrage: prioritize low-latency venues with constrained reinvestment ladder';
    }

    if (signal === 'strong_sell' || signal === 'sell') {
      return 'Mean-reversion defensive strategy: tighten risk budget and require stronger cross-venue edge';
    }

    return 'Neutral volatility harvesting: conservative sizing with adaptive gas and slippage controls';
  }

  /**
   * Trigger faucet-initiated operations
   */
  async triggerFaucet(operationType: string): Promise<void> {
    if (!this.status.isRunning) {
      throw new Error('CRYPTARA is not running');
    }

    log.info('Faucet triggered', { operationType });
    this.status.faucetStatus = 'triggered';

    try {
      switch (operationType) {
        case 'simulation':
          await this.runMonteCarloSimulation();
          break;
        case 'evolution':
          await this.triggerCrawlerEvolution();
          break;
        default:
          log.warn('Unknown faucet operation type', { operationType });
      }
    } finally {
      this.status.faucetStatus = 'ready';
    }
  }

  /**
   * Trigger crawler evolution based on learnings
   */
  private async triggerCrawlerEvolution(): Promise<CrawlerEvolutionData> {
    log.info('Triggering crawler evolution cycle');

    const latestSignal = this.lastTradingViewAnalysis?.summary.signal || 'neutral';
    const latestRisk = this.lastSurveillanceData?.riskLevel || 'medium';
    const mempoolPending = this.lastMempoolAnalysis?.totalPending || 0;
    const mempoolSwaps = this.lastMempoolAnalysis?.swapTransactions || 0;

    const slippageTightening = latestRisk === 'critical' ? 'tighten slippage cap to <= 12 bps' : 'maintain slippage cap <= 20 bps';
    const routingDirective = mempoolPending > 2000
      ? 'prioritize low-latency venues and defer low-edge opportunities'
      : 'allow broader venue routing with fee-weighted path ranking';

    const evolution: CrawlerEvolutionData = {
      evolutionId: `evo-${Date.now()}`,
      timestamp: new Date(),
      improvements: [
        `execution: ${routingDirective}`,
        `fees: dynamic fee-aware spread floor based on venue asymmetry`,
        `slippage: ${slippageTightening}`,
        `liquidity: require mempool-supported depth confirmation before route commit`,
      ],
      adaptations: [
        `signal-driven strategy bias: ${latestSignal}`,
        `risk-governed notional scaling for ${latestRisk} regime`,
        `adaptive polling cadence tied to pending tx load (${mempoolPending})`,
        `autonomous directive: ${this.autonomousDirective.riskBudget} budget, slippage<=${this.autonomousDirective.maxSlippageBps}bps`,
      ],
      performanceGain: Number((Math.max(0, 0.015 + (mempoolSwaps / 10000) - (latestRisk === 'critical' ? 0.01 : 0.002))).toFixed(4)),
      newCapabilities: [
        'live_tradingview_signal_ingestion',
        'alchemy_mempool_pressure_awareness',
        'fee_slippage_liquidity_guardrail_feedback',
      ],
    };

    this.emit('crawler:evolved', evolution);
    return evolution;
  }

  /**
   * Analyze sentiment from crypto sources
   */
  async analyzeSentiment(): Promise<SentimentAnalysis> {
    if (!this.status.isRunning) {
      throw new Error('CRYPTARA is not running');
    }

    const analysis = this.lastTradingViewAnalysis || await TradingViewEngine.getAnalysis('BTCUSDT', '1h');
    const currentMempool = alchemyIntegration.getMempoolAnalysis();
    const mempool = this.lastMempoolAnalysis || (currentMempool.available && currentMempool.observedAt !== null ? currentMempool : null);
    const signalScore = TradingViewEngine.signalToScore(analysis.summary.signal) / 2;
    const pressure = mempool ? Math.min(1, mempool.totalPending / 8000) : null;
    const overallSentiment = pressure === null ? signalScore : Math.max(-1, Math.min(1, signalScore - pressure * 0.2));

    const fearGreedIndex = pressure === null ? Math.max(0, Math.min(100, Math.round(50 + signalScore * 30))) : Math.max(0, Math.min(100, Math.round(50 + signalScore * 30 - pressure * 12)));
    const dominantNarrative =
      analysis.summary.signal === 'strong_buy' || analysis.summary.signal === 'buy'
        ? 'Momentum expansion with selective arbitrage pressure'
        : analysis.summary.signal === 'strong_sell' || analysis.summary.signal === 'sell'
          ? 'Risk-off rotation with defensive execution focus'
          : 'Range-bound conditions with opportunistic spread capture';

    return {
      timestamp: new Date(),
      overallSentiment,
      socialVolume: null,
      fearGreedIndex,
      dominantNarrative,
      keyTopics: [
        `signal:${analysis.summary.signal}`,
        ...(mempool ? [`mempool:${mempool.totalPending}`, `swap-flow:${mempool.swapTransactions}`] : ['mempool:unavailable']),
      ],
    };
  }

  /**
   * Get CRYPTARA status
   */
  getStatus(): CryptaraStatus {
    return {
      ...this.status,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
    };
  }

  /**
   * Get recent patterns
   */
  getRecentPatterns(): DetectedPattern[] {
    return [...this.recentPatterns];
  }

  /**
   * Get recent predictions
   */
  getRecentPredictions(): MarketPrediction[] {
    return [...this.recentPredictions];
  }

  /**
   * Cryptara Market Evaluators (advisory gating signals)
   *
   * This is analysis-only: it returns a structured gate report, but does not execute anything.
   * Intended for Cryptocrawl preflight gating (Stages 1–6).
   */
  evaluateMarketGates(context: CryptaraMarketGateContext, config?: CryptaraMarketGateConfig): GateEvaluation {
    const governance = getCryptocrawlGovernance();
    governance.requireAllowed('ADVISE', { chain: context.chain, pair: context.pairOrSymbol, venue: context.venue });
    try {
      const report = this.marketGateEngine.evaluate(context, config);
      this.emit('gates:evaluated', report);
      return report;
    } finally {
      // Stage 1: auto-pause after each advisory cycle.
      governance.completeAdvisoryCycle('system', 'cryptara_gates_cycle_complete');
    }
  }

  /**
   * Shutdown CRYPTARA
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down CRYPTARA');
    
    if (this.surveillanceInterval) {
      clearInterval(this.surveillanceInterval);
      this.surveillanceInterval = null;
    }

    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }

    try {
      TradingViewEngine.shutdown();
    } catch {
      // best effort shutdown
    }

    try {
      alchemyIntegration.stop();
    } catch {
      // best effort shutdown
    }

    this.status.isRunning = false;
    this.status.isSurveillanceActive = false;
    this.status.faucetStatus = 'idle';
    this.emit('shutdown', { timestamp: new Date() });
    
    log.info('CRYPTARA shutdown complete');
  }

  /**
   * Reset singleton (for testing)
   */
  static async reset(): Promise<void> {
    if (Cryptara.instance) {
      await Cryptara.instance.shutdown();
      Cryptara.instance = null;
    }
  }
}

// Export singleton getter
export const getCryptara = (config?: Partial<CryptaraConfig>): Cryptara => {
  return Cryptara.getInstance(config);
};

export default Cryptara;
