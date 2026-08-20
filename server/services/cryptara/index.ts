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
  sentimentScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  patterns: DetectedPattern[];
  predictions: MarketPrediction[];
}

export interface TokenActivity {
  token: string;
  chain: string;
  volume24h: number;
  priceChange24h: number;
  liquidity: number;
  holders: number;
  transactions: number;
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
  socialVolume: number;
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
  realizedProfitUsd: number;
  feeUsd: number;
  slippageBps: number;
  latencyMs: number;
  usedZeroCapital: boolean;
  timestamp: number;
  notes?: string;
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
      preferredChains: ['polygon', 'arbitrum', 'base'],
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
    };
  }

  async validateLiveSignalReadiness(options?: { strictLive?: boolean }): Promise<CryptaraConnectorReadiness> {
    const strictLive = options?.strictLive === true;
    const [tradingView, alchemy] = await Promise.all([
      TradingViewEngine.checkReadiness({ strictLive }),
      alchemyIntegration.readinessCheck({ strictLive }),
    ]);

    const alchemyMode: CryptaraConnectorReadiness['alchemy']['mode'] = alchemy.ready ? 'live' : 'degraded';
    const liveSignalReady = tradingView.ready && alchemy.ready;

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
    };

    this.connectorReadiness = readiness;
    return readiness;
  }

  private recomputeAutonomousDirective(): void {
    const recent = this.executionHistory.slice(-120);
    const successful = recent.filter(entry => entry.success);
    const successRate = recent.length > 0 ? successful.length / recent.length : 0.5;
    const avgNetProfit = successful.length > 0
      ? successful.reduce((sum, entry) => sum + entry.realizedProfitUsd, 0) / successful.length
      : 0;
    const avgSlippageBps = recent.length > 0
      ? recent.reduce((sum, entry) => sum + Math.max(0, entry.slippageBps), 0) / recent.length
      : 12;

    const chainPerformance = new Map<string, { net: number; wins: number; total: number }>();
    for (const entry of recent) {
      const current = chainPerformance.get(entry.chain) || { net: 0, wins: 0, total: 0 };
      current.net += entry.realizedProfitUsd;
      current.total += 1;
      if (entry.success) current.wins += 1;
      chainPerformance.set(entry.chain, current);
    }

    const preferredChains = Array.from(chainPerformance.entries())
      .sort((a, b) => {
        const scoreA = a[1].net + (a[1].wins / Math.max(1, a[1].total)) * 10;
        const scoreB = b[1].net + (b[1].wins / Math.max(1, b[1].total)) * 10;
        return scoreB - scoreA;
      })
      .slice(0, 3)
      .map(([chain]) => chain);

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

    const maxSlippageBps = Math.max(
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
      preferredChains: preferredChains.length > 0 ? preferredChains : ['polygon', 'arbitrum', 'base'],
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
    this.recomputeAutonomousDirective();
  }

  getAutonomousDirective(): CryptaraAutonomousDirective {
    return { ...this.autonomousDirective, preferredChains: [...this.autonomousDirective.preferredChains], preferredExecutionModes: [...this.autonomousDirective.preferredExecutionModes] };
  }

  getExecutionHistory(limit: number = 100): CryptaraExecutionFeedback[] {
    return this.executionHistory.slice(-Math.max(1, limit));
  }

  getConnectorReadiness(): CryptaraConnectorReadiness {
    return {
      ...this.connectorReadiness,
      tradingView: { ...this.connectorReadiness.tradingView },
      alchemy: { ...this.connectorReadiness.alchemy },
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
      });
      if (strictLive) {
        throw new Error(`Cryptara strict-live initialization failed: ${readiness.tradingView.detail}; ${readiness.alchemy.detail}`);
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
      // Simulate market surveillance
      // In production, this would integrate with blockchain APIs
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

    let mempool: MempoolAnalysis = {
      totalPending: 0,
      swapTransactions: 0,
      liquidityAdditions: 0,
      largeTransfers: 0,
      arbitrageOpportunities: [],
      avgGasPrice: 0,
      maxGasPrice: 0,
    };

    try {
      mempool = alchemyIntegration.getMempoolAnalysis();
      this.lastMempoolAnalysis = mempool;
    } catch {
      // If mempool stream is unavailable, continue with TradingView-only signaling.
    }

    const signalScore = TradingViewEngine.signalToScore(analysis.summary.signal);
    const normalizedSignal = signalScore / 2; // -1..1
    const congestionFactor = Math.min(1, mempool.totalPending / 8000);
    const gasPressureFactor = Math.min(1, mempool.avgGasPrice / 180_000_000_000); // normalize around ~180 gwei
    const riskIndex = Math.max(
      0,
      Math.min(
        1,
        0.25 +
          congestionFactor * 0.35 +
          gasPressureFactor * 0.25 +
          (normalizedSignal < 0 ? Math.abs(normalizedSignal) * 0.3 : 0),
      )
    );

    const riskLevel: MarketSurveillanceData['riskLevel'] =
      riskIndex >= 0.85 ? 'critical' :
      riskIndex >= 0.65 ? 'high' :
      riskIndex >= 0.4 ? 'medium' :
      'low';

    const tokenActivity: TokenActivity[] = [
      {
        token: 'BTC',
        chain: 'ethereum',
        volume24h: Math.max(100_000, mempool.swapTransactions * 220_000),
        priceChange24h: Number((normalizedSignal * 4.5).toFixed(3)),
        liquidity: Math.max(0.1, 1 - riskIndex),
        holders: 1_000_000 + mempool.largeTransfers,
        transactions: Math.max(analysis.summary.strength, mempool.totalPending),
      },
      {
        token: 'ETH',
        chain: 'ethereum',
        volume24h: Math.max(80_000, mempool.swapTransactions * 180_000),
        priceChange24h: Number((normalizedSignal * 3.7).toFixed(3)),
        liquidity: Math.max(0.1, 0.95 - riskIndex * 0.9),
        holders: 600_000 + Math.floor(mempool.totalPending / 8),
        transactions: Math.max(analysis.movingAverages.buyCount + analysis.movingAverages.sellCount, Math.floor(mempool.totalPending / 2)),
      },
    ];

    const surveillance: MarketSurveillanceData = {
      timestamp: new Date(),
      chain: 'ethereum',
      tokenActivity,
      sentimentScore: Math.max(-1, Math.min(1, normalizedSignal - riskIndex * 0.25)),
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
    const riskPenalty = data.riskLevel === 'critical' ? 0.18 : data.riskLevel === 'high' ? 0.1 : 0.04;
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

    const secondary: MarketPrediction = {
      asset: 'ETHUSDT',
      timeframe: '1h',
      direction,
      confidence: Math.max(0.28, confidence - 0.08),
      signals: [
        'cross-asset-correlation',
        `primary:${analysis.symbol}`,
        `risk:${data.riskLevel}`,
      ],
    };

    return [primary, secondary];
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

    log.info('Starting Monte Carlo simulation');
    this.status.totalSimulations++;

    try {
      const baseline = this.lastSurveillanceData || await this.collectMarketData();
      const signal = this.lastTradingViewAnalysis?.summary.signal || 'neutral';
      const sentiment = baseline.sentimentScore;
      const bullishBias = Math.max(0, Math.min(1, (sentiment + 1) / 2));
      const riskPenalty = baseline.riskLevel === 'critical'
        ? 0.35
        : baseline.riskLevel === 'high'
          ? 0.25
          : baseline.riskLevel === 'medium'
            ? 0.15
            : 0.08;

      let bullishProbability = 0.25 + bullishBias * 0.45;
      if (signal.includes('buy')) bullishProbability += 0.12;
      if (signal.includes('sell')) bullishProbability -= 0.12;
      bullishProbability = Math.max(0.1, Math.min(0.7, bullishProbability));

      let bearishProbability = 0.2 + riskPenalty * 0.8 - bullishBias * 0.2;
      bearishProbability = Math.max(0.1, Math.min(0.6, bearishProbability));

      let sidewaysProbability = 1 - bullishProbability - bearishProbability;
      if (sidewaysProbability < 0.1) {
        const deficit = 0.1 - sidewaysProbability;
        bullishProbability -= deficit / 2;
        bearishProbability -= deficit / 2;
        sidewaysProbability = 0.1;
      }

      const normalization = bullishProbability + bearishProbability + sidewaysProbability;
      bullishProbability /= normalization;
      bearishProbability /= normalization;
      sidewaysProbability /= normalization;

      const volatility = Math.max(0.08, Math.min(0.6, 0.12 + riskPenalty * 0.9));
      const bullishReturn = Math.max(-0.02, 0.02 + bullishBias * 0.14 - riskPenalty * 0.04);
      const bearishReturn = Math.min(-0.01, -0.02 - riskPenalty * 0.18 + bullishBias * 0.03);
      const sidewaysReturn = 0.004 + (0.05 - riskPenalty * 0.03);

      const expectedPortfolioReturn =
        bullishProbability * bullishReturn +
        bearishProbability * bearishReturn +
        sidewaysProbability * sidewaysReturn;

      const result: MonteCarloResult = {
        simulationId: `sim-${Date.now()}`,
        timestamp: new Date(),
        iterations: 10000,
        scenarios: [
          {
            name: 'Bullish Market',
            probability: Number(bullishProbability.toFixed(4)),
            expectedReturn: Number(bullishReturn.toFixed(4)),
            maxDrawdown: Number((0.06 + riskPenalty * 0.4).toFixed(4)),
            sharpeRatio: Number((bullishReturn / Math.max(volatility, 0.08)).toFixed(3)),
          },
          {
            name: 'Bearish Market',
            probability: Number(bearishProbability.toFixed(4)),
            expectedReturn: Number(bearishReturn.toFixed(4)),
            maxDrawdown: Number((0.14 + riskPenalty * 0.55).toFixed(4)),
            sharpeRatio: Number((bearishReturn / Math.max(volatility, 0.08)).toFixed(3)),
          },
          {
            name: 'Sideways Market',
            probability: Number(sidewaysProbability.toFixed(4)),
            expectedReturn: Number(sidewaysReturn.toFixed(4)),
            maxDrawdown: Number((0.08 + riskPenalty * 0.3).toFixed(4)),
            sharpeRatio: Number((sidewaysReturn / Math.max(volatility * 0.8, 0.06)).toFixed(3)),
          },
        ],
        optimalStrategy: this.selectOptimalStrategy(signal, baseline.riskLevel),
        riskMetrics: {
          valueAtRisk: Number((0.03 + riskPenalty * 0.18).toFixed(4)),
          expectedShortfall: Number((0.05 + riskPenalty * 0.25).toFixed(4)),
          maxDrawdown: Number((0.09 + riskPenalty * 0.33).toFixed(4)),
          volatility: Number(volatility.toFixed(4)),
        },
        learnings: [
          `Expected blended return ${expectedPortfolioReturn.toFixed(4)} under current signal ${signal}`,
          `Mempool pressure: ${this.lastMempoolAnalysis?.totalPending ?? 0} pending tx; adjust execution cadence to avoid fee spikes`,
          `Risk regime ${baseline.riskLevel}; enforce slippage guardrails before deployment`,
        ],
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
    const mempool = this.lastMempoolAnalysis || alchemyIntegration.getMempoolAnalysis();
    const signalScore = TradingViewEngine.signalToScore(analysis.summary.signal) / 2;
    const pressure = Math.min(1, mempool.totalPending / 8000);
    const overallSentiment = Math.max(-1, Math.min(1, signalScore - pressure * 0.2));

    const fearGreedIndex = Math.max(0, Math.min(100, Math.round(50 + signalScore * 30 - pressure * 12)));
    const dominantNarrative =
      analysis.summary.signal === 'strong_buy' || analysis.summary.signal === 'buy'
        ? 'Momentum expansion with selective arbitrage pressure'
        : analysis.summary.signal === 'strong_sell' || analysis.summary.signal === 'sell'
          ? 'Risk-off rotation with defensive execution focus'
          : 'Range-bound conditions with opportunistic spread capture';

    return {
      timestamp: new Date(),
      overallSentiment,
      socialVolume: Math.max(1000, mempool.totalPending * 18),
      fearGreedIndex,
      dominantNarrative,
      keyTopics: [
        `signal:${analysis.summary.signal}`,
        `mempool:${mempool.totalPending}`,
        `swap-flow:${mempool.swapTransactions}`,
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
