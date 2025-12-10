// Enhanced Monte Carlo Profitability Engine v3.0
// Advanced statistical simulation with AI-powered market regime detection,
// Kelly Criterion position sizing, non-linear profit modeling, and continuous learning
// Research-backed: Implements variance reduction techniques from quantitative finance
// Enhanced with: Adaptive regime detection, neural-inspired learning, and hyper-creative logic

import logger from '../../../logger.js';
import type { ChainId } from '../core/lux-swarm';

// ============================================
// MARKET REGIME DETECTION SYSTEM
// ============================================
export type MarketRegime = 'trending' | 'ranging' | 'volatile' | 'crisis' | 'stressed' | 'normal' | 'favorable';

export interface MarketRegimeAnalysis {
  regime: MarketRegime;
  confidence: number;
  hurstExponent: number;          // < 0.5 = mean-reverting, > 0.5 = trending
  trendStrength: number;          // 0-1 strength of current trend
  volatilityPercentile: number;   // Where current vol sits in historical distribution
  liquidityCrisis: boolean;       // True if liquidity is dangerously low
  regimeMultipliers: RegimeMultipliers;
}

export interface RegimeMultipliers {
  successMultiplier: number;      // Adjust success rate based on regime
  profitMultiplier: number;       // Scale profits for fat-tail capture
  positionSizeMultiplier: number; // Kelly-adjusted position sizing
  riskMultiplier: number;         // Scale risk parameters
}

// ============================================
// KELLY CRITERION POSITION SIZING
// ============================================
export interface KellyCriterion {
  fullKellyFraction: number;      // Optimal fraction to bet
  halfKellyFraction: number;      // Conservative Kelly (recommended)
  quarterKellyFraction: number;   // Ultra-conservative Kelly
  edge: number;                   // Estimated edge (win% * avgWin - loss% * avgLoss)
  variance: number;               // Variance of returns
  optimalLeverage: number;        // Suggested leverage factor
  maxDrawdownEstimate: number;    // Expected max drawdown at full Kelly
}

// ============================================
// ENHANCED CONFIGURATION
// ============================================
export interface MonteCarloConfig {
  simulations: number;            // Number of Monte Carlo paths (default: 10000)
  timeHorizonDays: number;        // Simulation time horizon
  confidenceLevel: number;        // Confidence level for VaR (0.95 = 95%)
  antithetic: boolean;            // Use antithetic variates for variance reduction
  controlVariate: boolean;        // Use control variates for variance reduction
  // NEW: Advanced configuration
  enableRegimeDetection: boolean; // Use market regime adaptive logic
  enableKellySizing: boolean;     // Use Kelly Criterion for position sizing
  enableFatTails: boolean;        // Model non-linear fat-tail events
  enableEnsemble: boolean;        // Run ensemble of simulations
  ensembleCount: number;          // Number of ensemble members
  learningEnabled: boolean;       // Enable continuous learning from outcomes
}

export interface MarketCondition {
  volatility: number;             // Annualized volatility (0.0-1.0)
  liquidityScore: number;         // Liquidity availability (0.0-1.0)
  gasVolatility: number;          // Gas price volatility
  competitorDensity: number;      // MEV bot competition level
  networkCongestion: number;      // Network congestion level
  // NEW: Enhanced market data
  priceHistory?: number[];        // Recent price history for regime detection
  volumeHistory?: number[];       // Recent volume history
  gasHistory?: number[];          // Recent gas price history
}

// Performance level classification
export type PerformanceLevel = 'good' | 'medium' | 'bad';

// Detailed performance breakdown
export interface PerformanceBreakdown {
  level: PerformanceLevel;
  score: number;                    // 0-100 overall score
  profitabilityScore: number;       // 0-100 profit potential
  riskScore: number;                // 0-100 risk management (higher = better)
  consistencyScore: number;         // 0-100 consistency of returns
  resilienceScore: number;          // 0-100 performance in stress
  recommendation: string;           // Actionable recommendation
  tradingApproval: 'approved' | 'conditional' | 'rejected';
  conditions?: string[];            // Conditions for conditional approval
}

// Variable results based on performance scenarios
export interface ScenarioResults {
  bestCase: number;                 // 95th percentile outcome
  expectedCase: number;             // 50th percentile outcome  
  worstCase: number;                // 5th percentile outcome
  probabilityOfProfit: number;      // Chance of positive return
  probabilityOfMajorLoss: number;   // Chance of >20% loss
  breakEvenProbability: number;     // Chance of roughly breaking even
}

export interface SimulationResult {
  expectedProfit: number;
  standardDeviation: number;
  valueAtRisk95: number;      // 95% VaR
  valueAtRisk99: number;      // 99% VaR
  conditionalVaR: number;     // Expected Shortfall (CVaR)
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  confidenceInterval: [number, number];
  percentiles: {
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  };
  strengthsWeaknesses: StrengthWeakness[];
  convergenceDiagnostic: number;
  strategyRating: 'A' | 'B' | 'C' | 'D' | 'F';
  // Enhanced performance analysis
  performanceLevel: PerformanceLevel;
  performanceBreakdown: PerformanceBreakdown;
  scenarioResults: ScenarioResults;
  // NEW: Advanced analytics
  marketRegime: MarketRegimeAnalysis;
  kellyCriterion: KellyCriterion;
  ensembleConfidence: number;      // Confidence from ensemble averaging
  fatTailProbability: number;      // Probability of extreme events
  executionSpeedBonus: number;     // Bonus from fast execution
  learningAdjustments: LearningAdjustments;
}

// NEW: Learning adjustments from historical data
export interface LearningAdjustments {
  historicalSuccessRate: number;  // Adjusted success rate from real data
  parameterDrift: number;         // How much parameters have drifted
  regimeAccuracy: number;         // Historical accuracy of regime detection
  recommendedChanges: string[];   // AI-suggested improvements
}

export interface StrengthWeakness {
  type: 'strength' | 'weakness';
  factor: string;
  impact: number;           // -100 to +100
  confidence: number;       // 0.0-1.0
  recommendation?: string;
}

export interface StrategyProfile {
  name: string;
  baseSuccessRate: number;
  avgProfitPerTrade: number;
  avgLossPerTrade: number;
  tradesPerDay: number;
  gasPerTrade: number;
  slippageTolerance: number;
  executionLatency: number;
  // NEW: Enhanced strategy attributes
  strategyType?: 'arbitrage' | 'mev' | 'liquidity' | 'market_making' | 'black_swan' | 'hybrid';
  mlFilterEnabled?: boolean;      // Uses ML for trade filtering
  multiChainEnabled?: boolean;    // Cross-chain capability
  mempoolMonitoring?: boolean;    // Monitors mempool for MEV
}

// Default configuration based on research
const DEFAULT_CONFIG: MonteCarloConfig = {
  simulations: 10000,
  timeHorizonDays: 30,
  confidenceLevel: 0.95,
  antithetic: true,
  controlVariate: true,
  // NEW: Advanced defaults
  enableRegimeDetection: true,
  enableKellySizing: true,
  enableFatTails: true,
  enableEnsemble: true,
  ensembleCount: 5,
  learningEnabled: true
};

// Market condition presets
export const MARKET_CONDITIONS: Record<string, MarketCondition> = {
  normal: {
    volatility: 0.6,
    liquidityScore: 0.8,
    gasVolatility: 0.4,
    competitorDensity: 0.5,
    networkCongestion: 0.3
  },
  highVolatility: {
    volatility: 1.2,
    liquidityScore: 0.5,
    gasVolatility: 0.8,
    competitorDensity: 0.7,
    networkCongestion: 0.6
  },
  lowLiquidity: {
    volatility: 0.5,
    liquidityScore: 0.3,
    gasVolatility: 0.3,
    competitorDensity: 0.3,
    networkCongestion: 0.2
  },
  highCompetition: {
    volatility: 0.7,
    liquidityScore: 0.7,
    gasVolatility: 0.5,
    competitorDensity: 0.9,
    networkCongestion: 0.5
  },
  // NEW: Advanced market regimes
  trending: {
    volatility: 0.4,
    liquidityScore: 0.85,
    gasVolatility: 0.3,
    competitorDensity: 0.4,
    networkCongestion: 0.25
  },
  ranging: {
    volatility: 0.3,
    liquidityScore: 0.9,
    gasVolatility: 0.2,
    competitorDensity: 0.5,
    networkCongestion: 0.2
  },
  crisis: {
    volatility: 2.0,
    liquidityScore: 0.15,
    gasVolatility: 1.5,
    competitorDensity: 0.3,
    networkCongestion: 0.9
  },
  // ============================================
  // TESTNET MARKET CONDITIONS
  // Polygon Amoy (Chain ID: 80002) and Arbitrum Sepolia (Chain ID: 421614)
  // ============================================
  
  // Polygon Amoy Testnet Scenarios
  polygonAmoyNormal: {
    volatility: 0.6,
    liquidityScore: 0.7,
    gasVolatility: 0.3,
    competitorDensity: 0.3,
    networkCongestion: 0.2
  },
  polygonAmoyHighVolatility: {
    volatility: 1.2,
    liquidityScore: 0.5,
    gasVolatility: 0.8,
    competitorDensity: 0.4,
    networkCongestion: 0.4
  },
  polygonAmoyLowActivity: {
    volatility: 0.3,
    liquidityScore: 0.9,
    gasVolatility: 0.1,
    competitorDensity: 0.1,
    networkCongestion: 0.1
  },
  
  // Arbitrum Sepolia Testnet Scenarios
  arbitrumSepoliaNormal: {
    volatility: 0.5,
    liquidityScore: 0.8,
    gasVolatility: 0.2,
    competitorDensity: 0.4,
    networkCongestion: 0.15
  },
  arbitrumSepoliaHighSpeed: {
    volatility: 0.4,
    liquidityScore: 0.85,
    gasVolatility: 0.1,
    competitorDensity: 0.5,
    networkCongestion: 0.1
  },
  arbitrumSepoliaStress: {
    volatility: 0.9,
    liquidityScore: 0.6,
    gasVolatility: 0.6,
    competitorDensity: 0.6,
    networkCongestion: 0.5
  },
  
  // Cross-Testnet Scenarios
  crossTestnetArbitrage: {
    volatility: 0.55,
    liquidityScore: 0.75,
    gasVolatility: 0.35,
    competitorDensity: 0.35,
    networkCongestion: 0.25
  }
};

// ============================================
// ADAPTIVE CONFIGURATION CONSTANTS
// ============================================

/** Regime thresholds for stress factor classification */
const REGIME_THRESHOLDS = {
  CRISIS: 0.8,      // High stress = crisis mode
  STRESSED: 0.5,    // Medium-high stress = stressed mode
  NORMAL: 0.3       // Medium stress = normal mode
};

/** Adaptive floor values for extreme condition handling */
const ADAPTIVE_FLOORS = {
  LIQUIDITY_THRESHOLD: 0.2,         // Below this, apply special liquidity handling
  LIQUIDITY_FLOOR: 0.3,             // Minimum liquidity factor
  STRESS_FLOOR: 0.35,               // Minimum adjustment factor under stress
  SUCCESS_FLOOR_RATIO: 0.4,         // Ratio for calculating dynamic success floor
  ABSOLUTE_MIN_SUCCESS: 0.15        // Absolute minimum success rate
};

/** Volatility caps to prevent extreme outliers */
const VOLATILITY_CAPS = {
  MAX_STRESS_VOLATILITY: 2.0        // Maximum volatility for stress calculation
};

/** Weights for stress factor calculation */
const STRESS_WEIGHTS = {
  LIQUIDITY: 0.3,    // Weight of liquidity in stress calculation
  COMPETITION: 0.25, // Weight of competition density
  CONGESTION: 0.2,   // Weight of network congestion
  VOLATILITY: 0.25   // Weight of volatility
};

/** Learning rates for different regime conditions */
const LEARNING_RATES = {
  SLOW: 0.2,    // Slow learning in crisis
  MEDIUM: 0.5,  // Medium learning in normal conditions
  FAST: 0.8     // Fast learning in favorable conditions
};

// ============================================
// HIGH-PERFORMANCE TRADING STRATEGIES
// ============================================
export const ELITE_STRATEGIES: Record<string, StrategyProfile> = {
  // Strategy 1: Quantum Flash Arbitrage
  quantumFlashArbitrage: {
    name: 'Quantum Flash Arbitrage',
    baseSuccessRate: 0.82,           // Very high due to ML filtering
    avgProfitPerTrade: 0.045,        // 4.5% per winning trade
    avgLossPerTrade: 0.008,          // Only 0.8% loss per losing trade
    tradesPerDay: 200,               // High frequency
    gasPerTrade: 0.002,              // Optimized gas
    slippageTolerance: 0.003,        // Tight slippage
    executionLatency: 15,            // Ultra-fast 15ms execution
    strategyType: 'arbitrage',
    mlFilterEnabled: true,
    multiChainEnabled: false,
    mempoolMonitoring: true
  },
  
  // Strategy 2: Cross-Chain Liquidity Sniper
  crossChainLiquiditySniper: {
    name: 'Cross-Chain Liquidity Sniper',
    baseSuccessRate: 0.68,           // Moderate success rate
    avgProfitPerTrade: 0.12,         // 12% profit per winner
    avgLossPerTrade: 0.025,          // 2.5% loss per loser
    tradesPerDay: 50,                // Lower frequency
    gasPerTrade: 0.008,              // Higher gas for bridging
    slippageTolerance: 0.006,        // Wider slippage for cross-chain
    executionLatency: 200,           // Slower due to bridges
    strategyType: 'liquidity',
    mlFilterEnabled: true,
    multiChainEnabled: true,
    mempoolMonitoring: true
  },
  
  // Strategy 3: MEV Sandwich Defense + Counter
  mevSandwichCounter: {
    name: 'MEV Sandwich Defense + Counter',
    baseSuccessRate: 0.75,           // Good success detecting sandwiches
    avgProfitPerTrade: 0.08,         // 8% profit on counter-trades
    avgLossPerTrade: 0.015,          // 1.5% loss
    tradesPerDay: 120,               // Medium-high frequency
    gasPerTrade: 0.005,              // Moderate gas for priority
    slippageTolerance: 0.004,        // Tight slippage
    executionLatency: 10,            // Ultra-fast for MEV
    strategyType: 'mev',
    mlFilterEnabled: true,
    multiChainEnabled: false,
    mempoolMonitoring: true
  },
  
  // Strategy 4: Regime-Adaptive Market Maker
  regimeAdaptiveMarketMaker: {
    name: 'Regime-Adaptive Market Maker',
    baseSuccessRate: 0.88,           // Very high win rate
    avgProfitPerTrade: 0.025,        // 2.5% per trade (smaller but consistent)
    avgLossPerTrade: 0.005,          // Very small losses
    tradesPerDay: 500,               // Very high frequency
    gasPerTrade: 0.001,              // Minimal gas
    slippageTolerance: 0.002,        // Extremely tight
    executionLatency: 5,             // Fastest execution (5ms)
    strategyType: 'market_making',
    mlFilterEnabled: true,
    multiChainEnabled: false,
    mempoolMonitoring: true
  },
  
  // Strategy 5: Black Swan Hunter
  // NOTE: This strategy has low win rate (35%) but extremely high profit on winners (50%).
  // This is intentionally designed for asymmetric payoffs in rare market events.
  // The expected value calculation: 0.35 * 0.50 - 0.65 * 0.02 = 0.175 - 0.013 = 0.162 (16.2% edge)
  // Real-world performance may vary; validate against backtesting before deployment.
  blackSwanHunter: {
    name: 'Black Swan Hunter',
    baseSuccessRate: 0.35,           // Low win rate (intentional - hunting rare events)
    avgProfitPerTrade: 0.50,         // 50% profit on winners (extreme tail events)
    avgLossPerTrade: 0.02,           // Small controlled losses (2%)
    tradesPerDay: 10,                // Very low frequency
    gasPerTrade: 0.003,              // Normal gas
    slippageTolerance: 0.015,        // Wide slippage tolerance
    executionLatency: 100,           // Normal speed sufficient
    strategyType: 'black_swan',
    mlFilterEnabled: true,
    multiChainEnabled: true,
    mempoolMonitoring: true
  },
  
  // ============================================
  // TESTNET-OPTIMIZED STRATEGIES
  // Polygon Amoy (Chain ID: 80002) & Arbitrum Sepolia (Chain ID: 421614)
  // ============================================
  
  // Strategy 6: Polygon Amoy Flash Arbitrage
  polygonAmoyFlashArb: {
    name: 'Polygon Amoy Flash Arbitrage',
    baseSuccessRate: 0.78,
    avgProfitPerTrade: 0.035,
    avgLossPerTrade: 0.008,
    tradesPerDay: 150,
    gasPerTrade: 0.001,
    slippageTolerance: 0.003,
    executionLatency: 20,
    strategyType: 'arbitrage',
    mlFilterEnabled: true,
    multiChainEnabled: false,
    mempoolMonitoring: true
  },
  
  // Strategy 7: Arbitrum Sepolia L2 Speed
  arbitrumSepoliaL2Speed: {
    name: 'Arbitrum Sepolia L2 Speed',
    baseSuccessRate: 0.82,
    avgProfitPerTrade: 0.042,
    avgLossPerTrade: 0.007,
    tradesPerDay: 200,
    gasPerTrade: 0.0005,
    slippageTolerance: 0.002,
    executionLatency: 10,
    strategyType: 'arbitrage',
    mlFilterEnabled: true,
    multiChainEnabled: false,
    mempoolMonitoring: true
  },
  
  // Strategy 8: Cross-Testnet Bridge Arbitrage
  crossTestnetBridgeArb: {
    name: 'Cross-Testnet Bridge Arbitrage',
    baseSuccessRate: 0.68,
    avgProfitPerTrade: 0.08,
    avgLossPerTrade: 0.02,
    tradesPerDay: 50,
    gasPerTrade: 0.005,
    slippageTolerance: 0.006,
    executionLatency: 150,
    strategyType: 'arbitrage',
    mlFilterEnabled: true,
    multiChainEnabled: true,
    mempoolMonitoring: true
  },
  
  // Strategy 9: Testnet MEV Hunter
  testnetMEVHunter: {
    name: 'Testnet MEV Hunter',
    baseSuccessRate: 0.72,
    avgProfitPerTrade: 0.055,
    avgLossPerTrade: 0.012,
    tradesPerDay: 100,
    gasPerTrade: 0.003,
    slippageTolerance: 0.004,
    executionLatency: 15,
    strategyType: 'mev',
    mlFilterEnabled: true,
    multiChainEnabled: false,
    mempoolMonitoring: true
  },
  
  // Strategy 10: Testnet Market Maker
  testnetMarketMaker: {
    name: 'Testnet Market Maker',
    baseSuccessRate: 0.85,
    avgProfitPerTrade: 0.02,
    avgLossPerTrade: 0.004,
    tradesPerDay: 400,
    gasPerTrade: 0.0008,
    slippageTolerance: 0.002,
    executionLatency: 8,
    strategyType: 'market_making',
    mlFilterEnabled: true,
    multiChainEnabled: false,
    mempoolMonitoring: true
  }
};

// ============================================
// LEARNING HISTORY STORAGE
// ============================================
interface LearningEntry {
  timestamp: number;
  strategyName: string;
  simulatedResult: Partial<SimulationResult>;
  actualResult?: {
    winRate: number;
    profitFactor: number;
    sharpeRatio: number;
  };
  regimeAtTime: MarketRegime;
  parameterSnapshot: Record<string, number>;
}

class SimulationLearningHistory {
  private static instance: SimulationLearningHistory;
  private history: LearningEntry[] = [];
  private maxHistorySize = 10000;
  
  static getInstance(): SimulationLearningHistory {
    if (!SimulationLearningHistory.instance) {
      SimulationLearningHistory.instance = new SimulationLearningHistory();
    }
    return SimulationLearningHistory.instance;
  }
  
  recordSimulation(entry: LearningEntry): void {
    this.history.push(entry);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }
  
  recordActualOutcome(
    strategyName: string, 
    timestamp: number, 
    actualResult: LearningEntry['actualResult']
  ): void {
    const entry = this.history.find(
      e => e.strategyName === strategyName && 
           Math.abs(e.timestamp - timestamp) < 60000
    );
    if (entry) {
      entry.actualResult = actualResult;
    }
  }
  
  getHistoricalAccuracy(strategyName: string): { 
    accuracy: number; 
    sampleSize: number;
    drift: number;
  } {
    const relevant = this.history.filter(
      e => e.strategyName === strategyName && e.actualResult
    );
    
    if (relevant.length < 10) {
      return { accuracy: 0.5, sampleSize: relevant.length, drift: 0 };
    }
    
    let accuracySum = 0;
    let driftSum = 0;
    
    for (const entry of relevant) {
      const simWinRate = entry.simulatedResult.winRate || 0.5;
      const actWinRate = entry.actualResult?.winRate || 0.5;
      const error = Math.abs(simWinRate - actWinRate);
      accuracySum += 1 - error;
      driftSum += actWinRate - simWinRate;
    }
    
    return {
      accuracy: accuracySum / relevant.length,
      sampleSize: relevant.length,
      drift: driftSum / relevant.length
    };
  }
  
  getRegimeAccuracy(): Record<MarketRegime, number> {
    const regimes: MarketRegime[] = ['trending', 'ranging', 'volatile', 'crisis'];
    const result: Record<string, number> = {};
    
    for (const regime of regimes) {
      const relevant = this.history.filter(
        e => e.regimeAtTime === regime && e.actualResult
      );
      if (relevant.length < 5) {
        result[regime] = 0.5;
        continue;
      }
      
      let accuracySum = 0;
      for (const entry of relevant) {
        const simWinRate = entry.simulatedResult.winRate || 0.5;
        const actWinRate = entry.actualResult?.winRate || 0.5;
        accuracySum += 1 - Math.abs(simWinRate - actWinRate);
      }
      result[regime] = accuracySum / relevant.length;
    }
    
    return result as Record<MarketRegime, number>;
  }
  
  exportHistory(): LearningEntry[] {
    return [...this.history];
  }
  
  importHistory(data: LearningEntry[]): void {
    this.history = data.slice(-this.maxHistorySize);
  }
}

// Export learning history singleton
export const learningHistory = SimulationLearningHistory.getInstance();

class MonteCarloEngine {
  private config: MonteCarloConfig;
  private rng: () => number;

  constructor(config: Partial<MonteCarloConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Use standard Math.random() - for production cryptographic applications,
    // consider using crypto.getRandomValues() or a secure PRNG library
    this.rng = () => Math.random();
  }

  /**
   * Run full Monte Carlo simulation for strategy validation
   * Enhanced with market regime detection, Kelly sizing, and learning
   */
  async runSimulation(
    strategy: StrategyProfile,
    marketCondition: MarketCondition = MARKET_CONDITIONS.normal
  ): Promise<SimulationResult> {
    const startTime = Date.now();
    
    logger.info('Starting Enhanced Monte Carlo simulation v3.0', {
      component: 'MonteCarloEngine',
      simulations: this.config.simulations,
      timeHorizon: this.config.timeHorizonDays,
      strategy: strategy.name,
      regimeDetection: this.config.enableRegimeDetection,
      kellySizing: this.config.enableKellySizing,
      ensemble: this.config.enableEnsemble
    });

    // Step 1: Detect market regime
    const marketRegime = this.config.enableRegimeDetection 
      ? this.detectMarketRegime(marketCondition)
      : this.getDefaultRegimeAnalysis();
    
    // Step 2: Calculate Kelly Criterion
    const kellyCriterion = this.config.enableKellySizing
      ? this.calculateKellyCriterion(strategy, marketRegime)
      : this.getDefaultKellyCriterion();
    
    // Step 3: Apply regime adjustments to strategy
    const adjustedStrategy = this.applyRegimeAdjustments(strategy, marketRegime);
    
    // Step 4: Run simulation (with optional ensemble)
    let paths: number[][];
    let ensembleConfidence = 1.0;
    
    if (this.config.enableEnsemble) {
      const ensembleResult = await this.runEnsembleSimulations(
        adjustedStrategy, 
        marketCondition, 
        marketRegime
      );
      paths = ensembleResult.paths;
      ensembleConfidence = ensembleResult.confidence;
    } else {
      paths = this.generatePaths(adjustedStrategy, marketCondition, marketRegime);
    }

    // Step 5: Calculate base statistics
    const results = this.analyzeResults(paths, adjustedStrategy);

    // Analyze strengths and weaknesses
    results.strengthsWeaknesses = this.analyzeStrengthsWeaknesses(
      strategy, 
      marketCondition, 
      results
    );

    // Calculate strategy rating
    results.strategyRating = this.calculateRating(results);

    // Check convergence
    results.convergenceDiagnostic = this.checkConvergence(paths);

    // Calculate performance level and breakdown
    results.performanceBreakdown = this.calculatePerformanceBreakdown(results, strategy, marketCondition);
    results.performanceLevel = results.performanceBreakdown.level;
    
    // Calculate scenario results (variable outcomes)
    results.scenarioResults = this.calculateScenarioResults(results);
    
    // Step 6: Add advanced analytics
    results.marketRegime = marketRegime;
    results.kellyCriterion = kellyCriterion;
    results.ensembleConfidence = ensembleConfidence;
    
    // Step 7: Calculate fat-tail probability
    results.fatTailProbability = this.config.enableFatTails
      ? this.calculateFatTailProbability(results, marketRegime)
      : 0;
    
    // Step 8: Calculate execution speed bonus
    results.executionSpeedBonus = this.calculateExecutionSpeedBonus(
      strategy, 
      marketCondition
    );
    
    // Step 9: Apply learning adjustments
    results.learningAdjustments = this.config.learningEnabled
      ? this.applyLearningAdjustments(strategy, results, marketRegime)
      : this.getDefaultLearningAdjustments();
    
    // Step 10: Record to learning history
    if (this.config.learningEnabled) {
      learningHistory.recordSimulation({
        timestamp: Date.now(),
        strategyName: strategy.name,
        simulatedResult: {
          winRate: results.winRate,
          profitFactor: results.profitFactor,
          sharpeRatio: results.sharpeRatio,
          expectedProfit: results.expectedProfit
        },
        regimeAtTime: marketRegime.regime,
        parameterSnapshot: {
          baseSuccessRate: strategy.baseSuccessRate,
          avgProfitPerTrade: strategy.avgProfitPerTrade,
          avgLossPerTrade: strategy.avgLossPerTrade,
          tradesPerDay: strategy.tradesPerDay
        }
      });
    }

    const elapsed = Date.now() - startTime;
    
    logger.info('Enhanced Monte Carlo simulation complete', {
      component: 'MonteCarloEngine',
      elapsed: `${elapsed}ms`,
      expectedProfit: results.expectedProfit.toFixed(4),
      sharpeRatio: results.sharpeRatio.toFixed(4),
      winRate: `${(results.winRate * 100).toFixed(2)}%`,
      rating: results.strategyRating,
      performanceLevel: results.performanceLevel,
      tradingApproval: results.performanceBreakdown.tradingApproval,
      marketRegime: marketRegime.regime,
      kellySizing: kellyCriterion.halfKellyFraction.toFixed(3),
      ensembleConfidence: ensembleConfidence.toFixed(3),
      fatTailProb: results.fatTailProbability.toFixed(3)
    });

    return results;
  }

  // ============================================
  // MARKET REGIME DETECTION (Hurst Exponent + Volatility Analysis)
  // ============================================
  
  /**
   * Detect current market regime using fractal analysis
   * Returns regime type with multipliers for strategy adjustment
   */
  private detectMarketRegime(market: MarketCondition): MarketRegimeAnalysis {
    // Calculate Hurst Exponent from price history if available
    const hurstExponent = market.priceHistory && market.priceHistory.length >= 20
      ? this.calculateHurstExponent(market.priceHistory)
      : 0.5 + (market.volatility - 0.5) * 0.3; // Estimate from volatility
    
    // Calculate trend strength
    const trendStrength = market.priceHistory && market.priceHistory.length >= 10
      ? this.calculateTrendStrength(market.priceHistory)
      : Math.abs(hurstExponent - 0.5) * 2;
    
    // Calculate volatility percentile
    const volatilityPercentile = this.mapToPercentile(market.volatility, 0.2, 1.5);
    
    // Detect liquidity crisis
    const liquidityCrisis = market.liquidityScore < 0.2 && market.volatility > 1.0;
    
    // Determine regime
    let regime: MarketRegime;
    let confidence: number;
    
    if (liquidityCrisis || market.volatility > 1.5) {
      regime = 'crisis';
      confidence = 0.85;
    } else if (hurstExponent > 0.6 && trendStrength > 0.5) {
      regime = 'trending';
      confidence = 0.7 + hurstExponent * 0.2;
    } else if (market.volatility > 0.8) {
      regime = 'volatile';
      confidence = 0.6 + market.volatility * 0.2;
    } else {
      regime = 'ranging';
      confidence = 0.6 + (1 - Math.abs(hurstExponent - 0.5)) * 0.3;
    }
    
    // Calculate regime-specific multipliers
    const regimeMultipliers = this.calculateRegimeMultipliers(regime, market, hurstExponent);
    
    return {
      regime,
      confidence,
      hurstExponent,
      trendStrength,
      volatilityPercentile,
      liquidityCrisis,
      regimeMultipliers
    };
  }
  
  /**
   * Calculate Hurst Exponent using R/S analysis
   * H < 0.5: Mean-reverting, H = 0.5: Random walk, H > 0.5: Trending
   */
  private calculateHurstExponent(prices: number[]): number {
    if (prices.length < 20) return 0.5;
    
    // Calculate returns
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
    
    // Calculate R/S for different window sizes
    const windowSizes = [10, 15, 20, 30, 50].filter(w => w <= returns.length);
    const rsValues: Array<{ logN: number; logRS: number }> = [];
    
    for (const n of windowSizes) {
      const chunks: number[][] = [];
      for (let i = 0; i <= returns.length - n; i += n) {
        chunks.push(returns.slice(i, i + n));
      }
      
      if (chunks.length === 0) continue;
      
      let rsSum = 0;
      for (const chunk of chunks) {
        const mean = chunk.reduce((a, b) => a + b, 0) / chunk.length;
        const deviations = chunk.map(r => r - mean);
        
        // Cumulative deviations
        let cumSum = 0;
        const cumDeviations = deviations.map(d => {
          cumSum += d;
          return cumSum;
        });
        
        const range = Math.max(...cumDeviations) - Math.min(...cumDeviations);
        const stdDev = Math.sqrt(
          chunk.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / chunk.length
        );
        
        if (stdDev > 0) {
          rsSum += range / stdDev;
        }
      }
      
      const avgRS = rsSum / chunks.length;
      if (avgRS > 0) {
        rsValues.push({ logN: Math.log(n), logRS: Math.log(avgRS) });
      }
    }
    
    if (rsValues.length < 2) return 0.5;
    
    // Linear regression to get Hurst exponent
    const n = rsValues.length;
    const sumX = rsValues.reduce((s, v) => s + v.logN, 0);
    const sumY = rsValues.reduce((s, v) => s + v.logRS, 0);
    const sumXY = rsValues.reduce((s, v) => s + v.logN * v.logRS, 0);
    const sumX2 = rsValues.reduce((s, v) => s + v.logN * v.logN, 0);
    
    const hurst = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    
    // Clamp to valid range
    return Math.max(0.1, Math.min(0.9, hurst));
  }
  
  /**
   * Calculate trend strength from price history
   */
  private calculateTrendStrength(prices: number[]): number {
    if (prices.length < 3) return 0;
    
    // Calculate directional movement
    let upMoves = 0;
    let downMoves = 0;
    
    for (let i = 1; i < prices.length; i++) {
      if (prices[i] > prices[i - 1]) upMoves++;
      else if (prices[i] < prices[i - 1]) downMoves++;
    }
    
    const totalMoves = upMoves + downMoves;
    if (totalMoves === 0) return 0;
    
    // Trend strength is the imbalance between up and down moves
    return Math.abs(upMoves - downMoves) / totalMoves;
  }
  
  /**
   * Calculate regime-specific multipliers
   */
  private calculateRegimeMultipliers(
    regime: MarketRegime, 
    market: MarketCondition,
    hurstExponent: number
  ): RegimeMultipliers {
    switch (regime) {
      case 'trending':
        return {
          successMultiplier: 1.2,          // Trends are easier to ride
          profitMultiplier: 1.3 + hurstExponent * 0.5, // Bigger moves in trends
          positionSizeMultiplier: 1.2,     // Can size up in clear trends
          riskMultiplier: 0.9              // Lower risk in predictable trends
        };
        
      case 'ranging':
        return {
          successMultiplier: 1.0,          // Standard parameters
          profitMultiplier: 1.0,           // Normal profits
          positionSizeMultiplier: 1.0,     // Standard sizing
          riskMultiplier: 1.0              // Normal risk
        };
        
      case 'volatile':
        return {
          successMultiplier: 0.85,         // Harder to execute in volatility
          profitMultiplier: 1.5 + market.volatility * 0.5, // Bigger moves possible
          positionSizeMultiplier: 0.6,     // Reduce size significantly
          riskMultiplier: 1.5              // Higher risk
        };
        
      case 'crisis':
        return {
          successMultiplier: 0.6,          // Very defensive
          profitMultiplier: 3.0,           // But massive opportunities
          positionSizeMultiplier: 0.3,     // Minimal size
          riskMultiplier: 2.5              // Extreme risk
        };
        
      default:
        return {
          successMultiplier: 1.0,
          profitMultiplier: 1.0,
          positionSizeMultiplier: 1.0,
          riskMultiplier: 1.0
        };
    }
  }
  
  private getDefaultRegimeAnalysis(): MarketRegimeAnalysis {
    return {
      regime: 'ranging',
      confidence: 0.5,
      hurstExponent: 0.5,
      trendStrength: 0,
      volatilityPercentile: 50,
      liquidityCrisis: false,
      regimeMultipliers: {
        successMultiplier: 1.0,
        profitMultiplier: 1.0,
        positionSizeMultiplier: 1.0,
        riskMultiplier: 1.0
      }
    };
  }

  // ============================================
  // KELLY CRITERION POSITION SIZING
  // ============================================
  
  /**
   * Calculate optimal position size using Kelly Criterion
   */
  private calculateKellyCriterion(
    strategy: StrategyProfile,
    regime: MarketRegimeAnalysis
  ): KellyCriterion {
    const p = strategy.baseSuccessRate * regime.regimeMultipliers.successMultiplier;
    const q = 1 - p;
    
    const avgWin = strategy.avgProfitPerTrade * regime.regimeMultipliers.profitMultiplier;
    const avgLoss = strategy.avgLossPerTrade * regime.regimeMultipliers.riskMultiplier;
    
    // Edge = p * avgWin - q * avgLoss
    const edge = p * avgWin - q * avgLoss;
    
    // Odds = avgWin / avgLoss
    const odds = avgLoss > 0 ? avgWin / avgLoss : 1;
    
    // Full Kelly = (p * odds - q) / odds = edge / avgLoss (simplified)
    const fullKelly = avgLoss > 0 ? (p * odds - q) / odds : 0;
    
    // Variance calculation
    const variance = p * Math.pow(avgWin, 2) + q * Math.pow(avgLoss, 2) - Math.pow(edge, 2);
    
    // Max drawdown estimate at full Kelly ≈ 2 * Kelly%
    const maxDrawdownEstimate = Math.min(1, fullKelly * 2);
    
    // Optimal leverage based on Sharpe and Kelly
    const estimatedSharpe = variance > 0 ? edge / Math.sqrt(variance) : 0;
    const optimalLeverage = Math.max(1, estimatedSharpe / 2);
    
    return {
      fullKellyFraction: Math.max(0, Math.min(1, fullKelly)),
      halfKellyFraction: Math.max(0, Math.min(0.5, fullKelly / 2)),
      quarterKellyFraction: Math.max(0, Math.min(0.25, fullKelly / 4)),
      edge,
      variance,
      optimalLeverage: Math.min(3, optimalLeverage),
      maxDrawdownEstimate
    };
  }
  
  private getDefaultKellyCriterion(): KellyCriterion {
    return {
      fullKellyFraction: 0.1,
      halfKellyFraction: 0.05,
      quarterKellyFraction: 0.025,
      edge: 0,
      variance: 0.1,
      optimalLeverage: 1,
      maxDrawdownEstimate: 0.2
    };
  }

  // ============================================
  // ENSEMBLE SIMULATIONS
  // ============================================
  
  /**
   * Run multiple simulations with slightly different parameters
   * Weight average results based on historical performance
   */
  private async runEnsembleSimulations(
    strategy: StrategyProfile,
    market: MarketCondition,
    regime: MarketRegimeAnalysis
  ): Promise<{ paths: number[][]; confidence: number }> {
    const allPaths: number[][] = [];
    const ensembleResults: Array<{ paths: number[][]; weight: number }> = [];
    
    // Generate parameter variations
    const variations = [
      { successMod: 1.0, profitMod: 1.0 },     // Base case
      { successMod: 0.95, profitMod: 1.05 },   // Slightly pessimistic success
      { successMod: 1.05, profitMod: 0.95 },   // Slightly optimistic success
      { successMod: 0.9, profitMod: 1.1 },     // More conservative
      { successMod: 1.1, profitMod: 0.9 }      // More aggressive
    ].slice(0, this.config.ensembleCount);
    
    // Historical accuracy affects weighting
    const historicalAccuracy = learningHistory.getHistoricalAccuracy(strategy.name);
    const regimeAccuracy = learningHistory.getRegimeAccuracy();
    const currentRegimeAccuracy = regimeAccuracy[regime.regime] || 0.5;
    
    for (let i = 0; i < variations.length; i++) {
      const variation = variations[i];
      
      // Create modified strategy
      const modifiedStrategy: StrategyProfile = {
        ...strategy,
        baseSuccessRate: Math.min(0.95, strategy.baseSuccessRate * variation.successMod),
        avgProfitPerTrade: strategy.avgProfitPerTrade * variation.profitMod
      };
      
      // Run simulation
      const paths = this.generatePaths(modifiedStrategy, market, regime);
      
      // Calculate weight (base case gets highest weight)
      const baseWeight = i === 0 ? 0.4 : 0.15;
      const accuracyBonus = (historicalAccuracy.accuracy - 0.5) * 0.2;
      const weight = Math.max(0.05, baseWeight + accuracyBonus);
      
      ensembleResults.push({ paths, weight });
      allPaths.push(...paths);
    }
    
    // Calculate ensemble confidence
    const totalWeight = ensembleResults.reduce((sum, r) => sum + r.weight, 0);
    const normalizedWeights = ensembleResults.map(r => r.weight / totalWeight);
    
    // Confidence is based on agreement between ensemble members
    const ensembleConfidence = this.calculateEnsembleAgreement(
      ensembleResults, 
      normalizedWeights
    );
    
    return {
      paths: allPaths,
      confidence: ensembleConfidence * currentRegimeAccuracy
    };
  }
  
  /**
   * Calculate agreement between ensemble members
   */
  private calculateEnsembleAgreement(
    results: Array<{ paths: number[][]; weight: number }>,
    weights: number[]
  ): number {
    // Calculate final PnL for each ensemble member
    const finalPnLs = results.map(r => {
      const pathEnds = r.paths.map(p => p[p.length - 1] || 0);
      return pathEnds.reduce((a, b) => a + b, 0) / pathEnds.length;
    });
    
    // Calculate weighted mean
    const weightedMean = finalPnLs.reduce((sum, pnl, i) => sum + pnl * weights[i], 0);
    
    // Calculate weighted variance (disagreement)
    const weightedVariance = finalPnLs.reduce(
      (sum, pnl, i) => sum + weights[i] * Math.pow(pnl - weightedMean, 2),
      0
    );
    
    // Convert to confidence (lower variance = higher confidence)
    const coefficient = Math.abs(weightedMean) > 0 
      ? Math.sqrt(weightedVariance) / Math.abs(weightedMean) 
      : 1;
    
    return Math.max(0.3, Math.min(1, 1 - coefficient));
  }

  // ============================================
  // STRATEGY ADJUSTMENTS
  // ============================================
  
  /**
   * Apply regime-based adjustments to strategy parameters
   */
  private applyRegimeAdjustments(
    strategy: StrategyProfile,
    regime: MarketRegimeAnalysis
  ): StrategyProfile {
    return {
      ...strategy,
      baseSuccessRate: Math.min(0.95, 
        strategy.baseSuccessRate * regime.regimeMultipliers.successMultiplier
      ),
      avgProfitPerTrade: strategy.avgProfitPerTrade * regime.regimeMultipliers.profitMultiplier,
      avgLossPerTrade: strategy.avgLossPerTrade * regime.regimeMultipliers.riskMultiplier
    };
  }

  // ============================================
  // FAT-TAIL MODELING
  // ============================================
  
  /**
   * Calculate probability of fat-tail events (extreme profits)
   */
  private calculateFatTailProbability(
    results: Partial<SimulationResult>,
    regime: MarketRegimeAnalysis
  ): number {
    // Base fat-tail probability depends on regime
    let baseProbability = 0.05;
    
    switch (regime.regime) {
      case 'volatile':
        baseProbability = 0.15;
        break;
      case 'crisis':
        baseProbability = 0.25;
        break;
      case 'trending':
        baseProbability = 0.10;
        break;
      default:
        baseProbability = 0.05;
    }
    
    // Adjust based on percentile spread
    const percentiles = results.percentiles;
    if (percentiles) {
      const spread = (percentiles.p95 - percentiles.p5) / 
        (Math.abs(percentiles.p50) || 1);
      baseProbability *= 1 + Math.min(1, spread);
    }
    
    return Math.min(0.5, baseProbability);
  }

  // ============================================
  // EXECUTION SPEED BONUS
  // ============================================
  
  /**
   * Calculate bonus for fast execution in competitive environments
   */
  private calculateExecutionSpeedBonus(
    strategy: StrategyProfile,
    market: MarketCondition
  ): number {
    // Only significant if there's high competition
    if (market.competitorDensity < 0.5) return 0;
    
    let bonus = 0;
    
    // Ultra-fast execution (< 30ms) in high competition
    if (strategy.executionLatency < 30 && market.competitorDensity > 0.7) {
      bonus = 0.15; // 15% profit bonus
    } else if (strategy.executionLatency < 50 && market.competitorDensity > 0.6) {
      bonus = 0.10; // 10% profit bonus
    } else if (strategy.executionLatency < 100) {
      bonus = 0.05; // 5% profit bonus
    }
    
    // Additional bonus for mempool monitoring
    if (strategy.mempoolMonitoring) {
      bonus *= 1.2;
    }
    
    return bonus;
  }

  // ============================================
  // LEARNING ADJUSTMENTS
  // ============================================
  
  /**
   * Apply adjustments based on historical learning
   */
  private applyLearningAdjustments(
    strategy: StrategyProfile,
    results: Partial<SimulationResult>,
    regime: MarketRegimeAnalysis
  ): LearningAdjustments {
    const historicalAccuracy = learningHistory.getHistoricalAccuracy(strategy.name);
    const regimeAccuracy = learningHistory.getRegimeAccuracy();
    
    // Calculate adjusted success rate based on historical drift
    const adjustedSuccessRate = results.winRate 
      ? results.winRate + historicalAccuracy.drift
      : strategy.baseSuccessRate;
    
    // Generate recommendations based on patterns
    const recommendations: string[] = [];
    
    if (historicalAccuracy.drift < -0.05) {
      recommendations.push('Strategy success rate declining - review entry criteria');
    }
    if (historicalAccuracy.drift > 0.05) {
      recommendations.push('Strategy outperforming simulations - consider increasing position size');
    }
    if (regimeAccuracy[regime.regime] < 0.6) {
      recommendations.push(`Low accuracy in ${regime.regime} regime - use conservative sizing`);
    }
    if (results.sharpeRatio && results.sharpeRatio < 1.0) {
      recommendations.push('Sharpe ratio below 1.0 - improve risk-adjusted returns');
    }
    if (results.maxDrawdown && results.maxDrawdown > 0.2) {
      recommendations.push('High drawdown risk - implement tighter stop-losses');
    }
    
    return {
      historicalSuccessRate: adjustedSuccessRate,
      parameterDrift: historicalAccuracy.drift,
      regimeAccuracy: regimeAccuracy[regime.regime] || 0.5,
      recommendedChanges: recommendations
    };
  }
  
  private getDefaultLearningAdjustments(): LearningAdjustments {
    return {
      historicalSuccessRate: 0.5,
      parameterDrift: 0,
      regimeAccuracy: 0.5,
      recommendedChanges: []
    };
  }

  // ============================================
  // UTILITY METHODS
  // ============================================
  
  private mapToPercentile(value: number, min: number, max: number): number {
    const clamped = Math.max(min, Math.min(max, value));
    return ((clamped - min) / (max - min)) * 100;
  }

  /**
   * Generate simulation paths using variance reduction techniques
   * Enhanced with regime-aware trade simulation
   */
  private generatePaths(
    strategy: StrategyProfile,
    market: MarketCondition,
    regime?: MarketRegimeAnalysis
  ): number[][] {
    const paths: number[][] = [];
    const tradesPerPath = Math.floor(strategy.tradesPerDay * this.config.timeHorizonDays);
    
    // Store random numbers for antithetic pairing
    const storedRandoms: number[][] = [];

    // Calculate actual simulation count based on antithetic setting
    const simulationCount = this.config.antithetic 
      ? Math.ceil(this.config.simulations / 2) 
      : this.config.simulations;

    for (let i = 0; i < simulationCount; i++) {
      const path: number[] = [];
      let cumulativePnL = 0;
      const randoms: number[] = [];

      for (let t = 0; t < tradesPerPath; t++) {
        // Store random numbers for potential antithetic use
        const r1 = this.rng();
        const r2 = this.rng();
        randoms.push(r1, r2);
        
        // Generate trade outcome with market conditions impact
        const outcome = this.simulateTradeWithRandoms(strategy, market, r1, r2, regime);
        cumulativePnL += outcome;
        path.push(cumulativePnL);
      }

      paths.push(path);
      
      // Store randoms for antithetic path
      if (this.config.antithetic) {
        storedRandoms.push(randoms);
      }
    }

    // Generate antithetic paths using complementary random numbers
    if (this.config.antithetic) {
      for (let i = 0; i < storedRandoms.length; i++) {
        const antitheticPath: number[] = [];
        let antiCumulativePnL = 0;
        const randoms = storedRandoms[i];
        
        for (let t = 0; t < tradesPerPath; t++) {
          // Use 1 - original random numbers for antithetic variance reduction
          const r1 = 1 - randoms[t * 2];
          const r2 = 1 - randoms[t * 2 + 1];
          
          const antiOutcome = this.simulateTradeWithRandoms(strategy, market, r1, r2, regime);
          antiCumulativePnL += antiOutcome;
          antitheticPath.push(antiCumulativePnL);
        }
        paths.push(antitheticPath);
      }
    }

    return paths;
  }
  
  // ============================================
  // ADVANCED ADAPTIVE TRADE SIMULATION
  // ============================================
  
  /**
   * Detect market regime based on stress factors (numeric approach)
   * Uses neural-inspired threshold detection
   */
  private detectMarketRegimeFromStress(stressFactor: number): MarketRegime {
    if (stressFactor >= REGIME_THRESHOLDS.CRISIS) return 'crisis';
    if (stressFactor >= REGIME_THRESHOLDS.STRESSED) return 'stressed';
    if (stressFactor >= REGIME_THRESHOLDS.NORMAL) return 'normal';
    return 'favorable';
  }

  /**
   * Calculate adaptive liquidity factor with exponential smoothing
   * Implements floor protection for extreme conditions
   */
  private calculateAdaptiveLiquidityFactor(liquidityScore: number): number {
    if (liquidityScore < ADAPTIVE_FLOORS.LIQUIDITY_THRESHOLD) {
      // Exponential smoothing for very low liquidity
      // Prevents collapse to zero while maintaining realistic impact
      return ADAPTIVE_FLOORS.LIQUIDITY_FLOOR + 
        Math.pow(liquidityScore / ADAPTIVE_FLOORS.LIQUIDITY_THRESHOLD, 0.5) * 
        (1 - ADAPTIVE_FLOORS.LIQUIDITY_FLOOR);
    }
    return liquidityScore;
  }

  /**
   * Calculate regime-aware stress factor
   * Uses weighted combination with adaptive dampening
   */
  private calculateStressFactor(market: MarketCondition): number {
    const liquidityFactor = this.calculateAdaptiveLiquidityFactor(market.liquidityScore);
    
    // Normalized volatility with cap
    const normalizedVolatility = Math.min(1, market.volatility / VOLATILITY_CAPS.MAX_STRESS_VOLATILITY);
    
    // Weighted stress calculation
    const rawStress = (
      (1 - liquidityFactor) * STRESS_WEIGHTS.LIQUIDITY +
      market.competitorDensity * STRESS_WEIGHTS.COMPETITION +
      market.networkCongestion * STRESS_WEIGHTS.CONGESTION +
      normalizedVolatility * STRESS_WEIGHTS.VOLATILITY
    );
    
    // Apply sigmoid-like smoothing to prevent extreme values
    // This creates more realistic stress distribution
    return Math.tanh(rawStress * 1.5) * 0.85;
  }

  /**
   * Calculate regime-adaptive adjustment factor
   * Different regimes use different adaptation strategies
   */
  private calculateRegimeAdjustment(stressFactor: number, regime: MarketRegime): number {
    let baseAdjustment: number;
    let learningRate: number;
    
    switch (regime) {
      case 'crisis':
        // In crisis, maintain higher floor but adapt slowly
        baseAdjustment = 0.50;
        learningRate = LEARNING_RATES.SLOW;
        break;
      case 'stressed':
        // In stressed conditions, balance floor and adaptation
        baseAdjustment = 0.60;
        learningRate = LEARNING_RATES.MEDIUM;
        break;
      case 'normal':
        // Normal conditions allow more aggressive adaptation
        baseAdjustment = 0.75;
        learningRate = LEARNING_RATES.MEDIUM;
        break;
      case 'favorable':
      default:
        // Favorable conditions use full strategy potential
        baseAdjustment = 0.90;
        learningRate = LEARNING_RATES.FAST;
        break;
    }
    
    // Apply stress reduction with regime-aware floor
    const stressReduction = stressFactor * (1 - baseAdjustment) * (1 + learningRate);
    return Math.max(ADAPTIVE_FLOORS.STRESS_FLOOR, baseAdjustment - stressReduction);
  }

  /**
   * Calculate dynamic success floor based on strategy quality
   * Better strategies maintain higher performance even in extreme conditions
   */
  private calculateDynamicFloor(baseSuccessRate: number, regime: MarketRegime): number {
    const qualityFactor = baseSuccessRate * ADAPTIVE_FLOORS.SUCCESS_FLOOR_RATIO;
    
    // Regime-specific floor multipliers
    const regimeMultiplier = regime === 'crisis' ? 1.2 : 
                             regime === 'stressed' ? 1.1 : 
                             regime === 'normal' ? 1.0 : 0.9;
    
    return Math.max(
      ADAPTIVE_FLOORS.ABSOLUTE_MIN_SUCCESS,
      qualityFactor * regimeMultiplier
    );
  }

  /**
   * Simulate trade with explicit random numbers (for antithetic pairing)
   * Enhanced with fat-tail modeling and regime awareness
   */
  private simulateTradeWithRandoms(
    strategy: StrategyProfile, 
    market: MarketCondition,
    successRandom: number,
    volatilityRandom: number,
    regime?: MarketRegimeAnalysis
  ): number {
    // Adjust success rate based on market conditions
    let adjustedSuccessRate = strategy.baseSuccessRate 
      * market.liquidityScore 
      * (1 - market.competitorDensity * 0.3)
      * (1 - market.networkCongestion * 0.2);
    
    // Apply regime adjustments if available
    if (regime) {
      adjustedSuccessRate *= regime.regimeMultipliers.successMultiplier;
    }
    
    // Clamp to valid range
    adjustedSuccessRate = Math.max(0.05, Math.min(0.95, adjustedSuccessRate));

    // ========================================
    // PHASE 3: Trade Outcome Determination
    // ========================================
    const isSuccess = successRandom < adjustedSuccessRate;

    if (isSuccess) {
      // Profitable trade with volatility-adjusted returns
      let baseProfit = strategy.avgProfitPerTrade;
      
      // Apply regime profit multiplier
      if (regime) {
        baseProfit *= regime.regimeMultipliers.profitMultiplier;
      }
      
      let volatilityImpact = (volatilityRandom - 0.5) * 2 * market.volatility * baseProfit;
      const slippageImpact = strategy.slippageTolerance * (1 + market.networkCongestion);
      
      // FAT-TAIL MODELING: Non-linear profit events
      // When conditions are perfect, apply profit multiplier for tail events
      if (this.config.enableFatTails) {
        const fatTailThreshold = 0.95; // Top 5% of random draws
        
        if (volatilityRandom > fatTailThreshold) {
          // Fat-tail event! Multiply profit by 2-10x
          const tailMultiplier = 2 + (volatilityRandom - fatTailThreshold) * 160; // 2x to 10x
          baseProfit *= tailMultiplier;
          
          // But only if market conditions support it
          if (market.liquidityScore > 0.7 && market.networkCongestion < 0.4) {
            volatilityImpact *= tailMultiplier * 0.5; // Enhanced upside
          }
        }
      }
      
      // Execution speed bonus
      if (strategy.executionLatency < 30 && market.competitorDensity > 0.7) {
        baseProfit *= 1.15; // 15% bonus for ultra-fast execution
      }
      
      return baseProfit + volatilityImpact - slippageImpact - strategy.gasPerTrade;
    } else {
      // Loss trade with stop-loss logic
      let baseLoss = strategy.avgLossPerTrade;
      
      // Apply regime risk multiplier
      if (regime) {
        baseLoss *= regime.regimeMultipliers.riskMultiplier;
      }
      
      let volatilityImpact = volatilityRandom * market.volatility * baseLoss;
      
      // STOP-LOSS CAP: Limit maximum loss per trade to 3x average
      const maxLoss = baseLoss * 3;
      const totalLoss = baseLoss + volatilityImpact + strategy.gasPerTrade;
      
      return -Math.min(maxLoss, totalLoss);
    }
  }

  /**
   * Simulate a single trade outcome (uses internal RNG)
   */
  private simulateTrade(
    strategy: StrategyProfile, 
    market: MarketCondition,
    regime?: MarketRegimeAnalysis
  ): number {
    return this.simulateTradeWithRandoms(strategy, market, this.rng(), this.rng(), regime);
  }

  /**
   * Analyze simulation results for key metrics
   */
  private analyzeResults(paths: number[][], strategy: StrategyProfile): SimulationResult {
    const finalPnLs = paths.map(path => path[path.length - 1] || 0);
    const n = finalPnLs.length;

    // Sort for percentile calculations
    const sortedPnLs = [...finalPnLs].sort((a, b) => a - b);

    // Calculate expected profit (mean)
    const expectedProfit = finalPnLs.reduce((a, b) => a + b, 0) / n;

    // Calculate standard deviation
    const variance = finalPnLs.reduce((sum, pnl) => 
      sum + Math.pow(pnl - expectedProfit, 2), 0) / (n - 1);
    const standardDeviation = Math.sqrt(variance);

    // Calculate Value at Risk (VaR)
    const var95Index = Math.floor(n * 0.05);
    const var99Index = Math.floor(n * 0.01);
    const valueAtRisk95 = -sortedPnLs[var95Index];
    const valueAtRisk99 = -sortedPnLs[var99Index];

    // Calculate Conditional VaR (Expected Shortfall)
    const tailLosses = sortedPnLs.slice(0, var95Index);
    const conditionalVaR = tailLosses.length > 0 
      ? -tailLosses.reduce((a, b) => a + b, 0) / tailLosses.length 
      : 0;

    // Calculate Sharpe Ratio (assuming 0% risk-free rate)
    const sharpeRatio = standardDeviation > 0 ? expectedProfit / standardDeviation : 0;

    // Calculate Sortino Ratio (only downside deviation)
    const downsideReturns = finalPnLs.filter(r => r < 0);
    const downsideDeviation = downsideReturns.length > 0
      ? Math.sqrt(downsideReturns.reduce((sum, r) => sum + r * r, 0) / downsideReturns.length)
      : 0;
    const sortinoRatio = downsideDeviation > 0 ? expectedProfit / downsideDeviation : sharpeRatio * 1.5;

    // Calculate max drawdown
    const maxDrawdown = this.calculateMaxDrawdown(paths);

    // Calculate win rate and profit factor
    const wins = finalPnLs.filter(pnl => pnl > 0);
    const losses = finalPnLs.filter(pnl => pnl <= 0);
    const winRate = wins.length / n;
    
    const grossProfit = wins.reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Calculate confidence interval
    const zScore = 1.96; // 95% confidence
    const marginOfError = zScore * (standardDeviation / Math.sqrt(n));
    const confidenceInterval: [number, number] = [
      expectedProfit - marginOfError,
      expectedProfit + marginOfError
    ];

    // Calculate percentiles
    const percentiles = {
      p5: sortedPnLs[Math.floor(n * 0.05)],
      p25: sortedPnLs[Math.floor(n * 0.25)],
      p50: sortedPnLs[Math.floor(n * 0.50)],
      p75: sortedPnLs[Math.floor(n * 0.75)],
      p95: sortedPnLs[Math.floor(n * 0.95)]
    };

    // Initialize with placeholder values - will be calculated later in runSimulation
    return {
      expectedProfit,
      standardDeviation,
      valueAtRisk95,
      valueAtRisk99,
      conditionalVaR,
      sharpeRatio,
      sortinoRatio,
      maxDrawdown,
      winRate,
      profitFactor,
      confidenceInterval,
      percentiles,
      strengthsWeaknesses: [],
      convergenceDiagnostic: 0,
      strategyRating: 'C',
      // Performance level fields initialized with defaults
      performanceLevel: 'medium' as PerformanceLevel,
      performanceBreakdown: {
        level: 'medium' as PerformanceLevel,
        score: 50,
        profitabilityScore: 50,
        riskScore: 50,
        consistencyScore: 50,
        resilienceScore: 50,
        recommendation: 'Awaiting full analysis',
        tradingApproval: 'conditional' as const
      },
      scenarioResults: {
        bestCase: percentiles.p95,
        expectedCase: percentiles.p50,
        worstCase: percentiles.p5,
        probabilityOfProfit: winRate,
        probabilityOfMajorLoss: 0.1,
        breakEvenProbability: 0.1
      },
      // NEW: Advanced analytics with default values (will be filled by runSimulation)
      marketRegime: {
        regime: 'ranging',
        confidence: 0.5,
        hurstExponent: 0.5,
        trendStrength: 0,
        volatilityPercentile: 50,
        liquidityCrisis: false,
        regimeMultipliers: {
          successMultiplier: 1.0,
          profitMultiplier: 1.0,
          positionSizeMultiplier: 1.0,
          riskMultiplier: 1.0
        }
      },
      kellyCriterion: {
        fullKellyFraction: 0.1,
        halfKellyFraction: 0.05,
        quarterKellyFraction: 0.025,
        edge: 0,
        variance: 0.1,
        optimalLeverage: 1,
        maxDrawdownEstimate: 0.2
      },
      ensembleConfidence: 1.0,
      fatTailProbability: 0.05,
      executionSpeedBonus: 0,
      learningAdjustments: {
        historicalSuccessRate: winRate,
        parameterDrift: 0,
        regimeAccuracy: 0.5,
        recommendedChanges: []
      }
    };
  }

  /**
   * Calculate maximum drawdown across all paths
   */
  private calculateMaxDrawdown(paths: number[][]): number {
    let maxDrawdown = 0;

    for (const path of paths) {
      let peak = 0;
      
      for (const value of path) {
        if (value > peak) {
          peak = value;
        }
        
        const drawdown = peak > 0 ? (peak - value) / peak : 0;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }
    }

    return maxDrawdown;
  }

  /**
   * Analyze strengths and weaknesses of the strategy
   */
  private analyzeStrengthsWeaknesses(
    strategy: StrategyProfile,
    market: MarketCondition,
    results: SimulationResult
  ): StrengthWeakness[] {
    const analysis: StrengthWeakness[] = [];

    // Win rate analysis
    if (results.winRate > 0.7) {
      analysis.push({
        type: 'strength',
        factor: 'High Win Rate',
        impact: Math.min(100, (results.winRate - 0.5) * 200),
        confidence: 0.95,
        recommendation: 'Maintain current entry criteria'
      });
    } else if (results.winRate < 0.4) {
      analysis.push({
        type: 'weakness',
        factor: 'Low Win Rate',
        impact: -Math.min(100, (0.5 - results.winRate) * 200),
        confidence: 0.95,
        recommendation: 'Improve entry signal filters or reduce position sizes'
      });
    }

    // Sharpe ratio analysis
    if (results.sharpeRatio > 2.0) {
      analysis.push({
        type: 'strength',
        factor: 'Excellent Risk-Adjusted Returns',
        impact: Math.min(100, results.sharpeRatio * 25),
        confidence: 0.90
      });
    } else if (results.sharpeRatio < 0.5) {
      analysis.push({
        type: 'weakness',
        factor: 'Poor Risk-Adjusted Returns',
        impact: -Math.min(100, (0.5 - results.sharpeRatio) * 100),
        confidence: 0.90,
        recommendation: 'Implement tighter risk controls or optimize entry/exit timing'
      });
    }

    // Drawdown analysis
    if (results.maxDrawdown < 0.1) {
      analysis.push({
        type: 'strength',
        factor: 'Low Maximum Drawdown',
        impact: Math.min(100, (0.3 - results.maxDrawdown) * 333),
        confidence: 0.85
      });
    } else if (results.maxDrawdown > 0.3) {
      analysis.push({
        type: 'weakness',
        factor: 'High Maximum Drawdown',
        impact: -Math.min(100, (results.maxDrawdown - 0.1) * 500),
        confidence: 0.85,
        recommendation: 'Implement circuit breakers or position size limits'
      });
    }

    // Profit factor analysis
    if (results.profitFactor > 2.0) {
      analysis.push({
        type: 'strength',
        factor: 'High Profit Factor',
        impact: Math.min(100, (results.profitFactor - 1) * 50),
        confidence: 0.90
      });
    } else if (results.profitFactor < 1.2) {
      analysis.push({
        type: 'weakness',
        factor: 'Low Profit Factor',
        impact: -Math.min(100, (1.5 - results.profitFactor) * 200),
        confidence: 0.90,
        recommendation: 'Review loss management and consider tighter stop-losses'
      });
    }

    // Market condition sensitivity
    if (market.volatility > 0.8) {
      if (results.expectedProfit > 0) {
        analysis.push({
          type: 'strength',
          factor: 'Profitable in High Volatility',
          impact: 60,
          confidence: 0.80
        });
      } else {
        analysis.push({
          type: 'weakness',
          factor: 'Loses in High Volatility',
          impact: -70,
          confidence: 0.80,
          recommendation: 'Add volatility filters or reduce exposure during high vol'
        });
      }
    }

    // Competition sensitivity
    if (market.competitorDensity > 0.7 && results.winRate > 0.5) {
      analysis.push({
        type: 'strength',
        factor: 'Competitive in High MEV Environment',
        impact: 50,
        confidence: 0.75
      });
    }

    // Latency analysis
    if (strategy.executionLatency < 50) {
      analysis.push({
        type: 'strength',
        factor: 'Ultra-Low Latency Execution',
        impact: 40,
        confidence: 0.85
      });
    } else if (strategy.executionLatency > 200) {
      analysis.push({
        type: 'weakness',
        factor: 'High Execution Latency',
        impact: -45,
        confidence: 0.85,
        recommendation: 'Optimize execution path or use closer RPC endpoints'
      });
    }

    return analysis;
  }

  /**
   * Calculate overall strategy rating
   */
  private calculateRating(results: SimulationResult): 'A' | 'B' | 'C' | 'D' | 'F' {
    let score = 0;

    // Win rate (max 25 points)
    score += Math.min(25, results.winRate * 35);

    // Sharpe ratio (max 25 points)
    score += Math.min(25, results.sharpeRatio * 10);

    // Profit factor (max 20 points)
    score += Math.min(20, (results.profitFactor - 1) * 15);

    // Max drawdown (max 15 points, inverse)
    score += Math.max(0, 15 - results.maxDrawdown * 50);

    // Expected profit positive (15 points)
    score += results.expectedProfit > 0 ? 15 : 0;

    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 55) return 'C';
    if (score >= 40) return 'D';
    return 'F';
  }

  /**
   * Check simulation convergence using standard error
   */
  private checkConvergence(paths: number[][]): number {
    const finalPnLs = paths.map(path => path[path.length - 1] || 0);
    const n = finalPnLs.length;
    
    const mean = finalPnLs.reduce((a, b) => a + b, 0) / n;
    const variance = finalPnLs.reduce((sum, pnl) => 
      sum + Math.pow(pnl - mean, 2), 0) / (n - 1);
    
    const standardError = Math.sqrt(variance / n);
    
    // Return coefficient of variation of the mean estimate
    // Lower is better (more converged)
    return mean !== 0 ? Math.abs(standardError / mean) : 1;
  }

  /**
   * Calculate detailed performance breakdown with variable levels
   */
  private calculatePerformanceBreakdown(
    results: Partial<SimulationResult>,
    strategy: StrategyProfile,
    market: MarketCondition
  ): PerformanceBreakdown {
    // Calculate individual scores (0-100)
    
    // Profitability Score: Based on expected profit, profit factor, and win rate
    const profitabilityScore = Math.min(100, Math.max(0,
      (results.expectedProfit && results.expectedProfit > 0 ? 40 : 0) +
      (results.profitFactor ? Math.min(30, (results.profitFactor - 1) * 20) : 0) +
      (results.winRate ? Math.min(30, results.winRate * 40) : 0)
    ));

    // Risk Score: Based on drawdown, VaR, and Sharpe ratio (inverted for safety)
    const maxDrawdownPenalty = results.maxDrawdown ? results.maxDrawdown * 100 : 50;
    const varPenalty = results.valueAtRisk95 ? Math.min(30, results.valueAtRisk95 * 10) : 15;
    const riskScore = Math.min(100, Math.max(0,
      100 - maxDrawdownPenalty - varPenalty +
      (results.sharpeRatio ? Math.min(30, results.sharpeRatio * 15) : 0)
    ));

    // Consistency Score: Based on standard deviation and confidence interval width
    const stdDevPenalty = results.standardDeviation ? Math.min(40, results.standardDeviation * 20) : 20;
    const ciWidth = results.confidenceInterval ? 
      Math.abs(results.confidenceInterval[1] - results.confidenceInterval[0]) : 1;
    const consistencyScore = Math.min(100, Math.max(0,
      100 - stdDevPenalty - Math.min(30, ciWidth * 10) +
      (results.sortinoRatio ? Math.min(20, results.sortinoRatio * 10) : 0)
    ));

    // Resilience Score: Based on market stress factors
    const marketStressFactor = market.volatility * 0.3 + 
      (1 - market.liquidityScore) * 0.3 + 
      market.competitorDensity * 0.2 +
      market.networkCongestion * 0.2;
    const resilienceBonus = results.expectedProfit && results.expectedProfit > 0 ? 20 : -20;
    const resilienceScore = Math.min(100, Math.max(0,
      70 - marketStressFactor * 50 + resilienceBonus +
      (strategy.executionLatency < 100 ? 10 : 0)
    ));

    // Calculate overall score (weighted average)
    const overallScore = (
      profitabilityScore * 0.35 +
      riskScore * 0.30 +
      consistencyScore * 0.20 +
      resilienceScore * 0.15
    );

    // Determine performance level
    let level: PerformanceLevel;
    if (overallScore >= 70) {
      level = 'good';
    } else if (overallScore >= 45) {
      level = 'medium';
    } else {
      level = 'bad';
    }

    // Generate recommendation and trading approval
    let recommendation: string;
    let tradingApproval: 'approved' | 'conditional' | 'rejected';
    const conditions: string[] = [];

    if (level === 'good') {
      recommendation = 'Strategy shows strong performance. Proceed with standard position sizing.';
      tradingApproval = 'approved';
    } else if (level === 'medium') {
      recommendation = 'Strategy shows moderate performance. Use conservative position sizes and monitor closely.';
      tradingApproval = 'conditional';
      
      if (riskScore < 50) conditions.push('Implement additional stop-loss protection');
      if (consistencyScore < 50) conditions.push('Reduce position size by 50%');
      if (resilienceScore < 50) conditions.push('Avoid trading during high volatility periods');
      if (profitabilityScore < 50) conditions.push('Require higher profit threshold for entry');
    } else {
      recommendation = 'Strategy shows poor performance. Do not trade until fundamental improvements are made.';
      tradingApproval = 'rejected';
      
      if (profitabilityScore < 30) conditions.push('Improve entry/exit logic');
      if (riskScore < 30) conditions.push('Implement circuit breakers');
      if (consistencyScore < 30) conditions.push('Reduce exposure significantly');
      if (resilienceScore < 30) conditions.push('Strategy not suitable for current market conditions');
    }

    return {
      level,
      score: Math.round(overallScore),
      profitabilityScore: Math.round(profitabilityScore),
      riskScore: Math.round(riskScore),
      consistencyScore: Math.round(consistencyScore),
      resilienceScore: Math.round(resilienceScore),
      recommendation,
      tradingApproval,
      conditions: conditions.length > 0 ? conditions : undefined
    };
  }

  /**
   * Calculate variable scenario results (best/expected/worst case)
   */
  private calculateScenarioResults(results: Partial<SimulationResult>): ScenarioResults {
    const percentiles = results.percentiles || { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 };
    const expectedProfit = results.expectedProfit || 0;
    const winRate = results.winRate || 0;
    const stdDev = results.standardDeviation || 0;

    // Best case: 95th percentile outcome
    const bestCase = percentiles.p95;

    // Expected case: median (50th percentile)
    const expectedCase = percentiles.p50;

    // Worst case: 5th percentile outcome
    const worstCase = percentiles.p5;

    // Probability of profit: estimate from distribution
    const probabilityOfProfit = winRate;

    // Probability of major loss (>20% of expected returns or >20% drawdown)
    const lossThreshold = Math.abs(expectedProfit * 0.2);
    const probabilityOfMajorLoss = worstCase < -lossThreshold ? 
      Math.min(0.5, 0.05 + (Math.abs(worstCase) / (stdDev || 1)) * 0.1) : 
      0.05;

    // Break-even probability: within ±5% of zero
    const breakEvenRange = Math.abs(expectedProfit * 0.05) || 0.01;
    const breakEvenProbability = expectedCase >= -breakEvenRange && expectedCase <= breakEvenRange ?
      0.15 : 0.05;

    return {
      bestCase,
      expectedCase,
      worstCase,
      probabilityOfProfit,
      probabilityOfMajorLoss,
      breakEvenProbability
    };
  }

  /**
   * Run stress test under extreme market conditions
   */
  async runStressTest(strategy: StrategyProfile): Promise<Record<string, SimulationResult>> {
    const results: Record<string, SimulationResult> = {};

    for (const [conditionName, condition] of Object.entries(MARKET_CONDITIONS)) {
      results[conditionName] = await this.runSimulation(strategy, condition);
    }

    // Add extreme stress scenarios
    const extremeConditions: Record<string, MarketCondition> = {
      blackSwan: {
        volatility: 2.0,
        liquidityScore: 0.1,
        gasVolatility: 1.5,
        competitorDensity: 0.9,
        networkCongestion: 0.9
      },
      flashCrash: {
        volatility: 3.0,
        liquidityScore: 0.05,
        gasVolatility: 2.0,
        competitorDensity: 0.3,
        networkCongestion: 0.95
      }
    };

    for (const [conditionName, condition] of Object.entries(extremeConditions)) {
      results[conditionName] = await this.runSimulation(strategy, condition);
    }

    logger.info('Stress test complete', {
      component: 'MonteCarloEngine',
      scenarios: Object.keys(results).length,
      worstCase: Object.entries(results)
        .sort((a, b) => a[1].expectedProfit - b[1].expectedProfit)[0][0]
    });

    return results;
  }

  /**
   * Quick performance assessment without full simulation
   * Returns variable results based on strategy parameters
   */
  quickAssessment(strategy: StrategyProfile): { level: PerformanceLevel; reason: string } {
    // Quick heuristic assessment
    const expectedEdge = strategy.baseSuccessRate * strategy.avgProfitPerTrade - 
      (1 - strategy.baseSuccessRate) * (strategy.avgLossPerTrade + strategy.gasPerTrade);
    
    const profitToLossRatio = strategy.avgProfitPerTrade / (strategy.avgLossPerTrade + strategy.gasPerTrade);
    
    if (expectedEdge > 0 && strategy.baseSuccessRate > 0.6 && profitToLossRatio > 1.5) {
      return { level: 'good', reason: 'Strong edge with favorable risk/reward' };
    } else if (expectedEdge > 0 && strategy.baseSuccessRate > 0.5) {
      return { level: 'medium', reason: 'Positive edge but requires monitoring' };
    } else {
      return { level: 'bad', reason: 'Negative or marginal edge' };
    }
  }
  
  /**
   * Record actual deployment outcome for continuous learning
   * This should be called after real trades are executed
   */
  recordDeploymentOutcome(
    strategyName: string,
    deploymentTimestamp: number,
    actualResult: {
      winRate: number;
      profitFactor: number;
      sharpeRatio: number;
      totalTrades: number;
      totalProfit: number;
    }
  ): void {
    learningHistory.recordActualOutcome(strategyName, deploymentTimestamp, {
      winRate: actualResult.winRate,
      profitFactor: actualResult.profitFactor,
      sharpeRatio: actualResult.sharpeRatio
    });
    
    logger.info('Deployment outcome recorded for learning', {
      component: 'MonteCarloEngine',
      strategy: strategyName,
      actualWinRate: `${(actualResult.winRate * 100).toFixed(1)}%`,
      profitFactor: actualResult.profitFactor.toFixed(2),
      totalTrades: actualResult.totalTrades
    });
  }
  
  /**
   * Get learning statistics for a strategy
   */
  getLearningStats(strategyName: string): {
    accuracy: number;
    sampleSize: number;
    drift: number;
    regimeAccuracy: Record<MarketRegime, number>;
  } {
    const historicalAccuracy = learningHistory.getHistoricalAccuracy(strategyName);
    const regimeAccuracy = learningHistory.getRegimeAccuracy();
    
    return {
      ...historicalAccuracy,
      regimeAccuracy
    };
  }
}

// Factory function for creating configured engines
export function createMonteCarloEngine(config?: Partial<MonteCarloConfig>): MonteCarloEngine {
  return new MonteCarloEngine(config);
}

export { MonteCarloEngine };
