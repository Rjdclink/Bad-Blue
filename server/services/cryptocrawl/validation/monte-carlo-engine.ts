// Enhanced Monte Carlo Profitability Engine
// Statistical simulation for strategy validation with confidence intervals
// Research-backed: Implements variance reduction techniques from quantitative finance

import logger from '../../../logger.js';
import type { ChainId } from '../core/lux-swarm';

export interface MonteCarloConfig {
  simulations: number;        // Number of Monte Carlo paths (default: 10000)
  timeHorizonDays: number;    // Simulation time horizon
  confidenceLevel: number;    // Confidence level for VaR (0.95 = 95%)
  antithetic: boolean;        // Use antithetic variates for variance reduction
  controlVariate: boolean;    // Use control variates for variance reduction
}

export interface MarketCondition {
  volatility: number;         // Annualized volatility (0.0-1.0)
  liquidityScore: number;     // Liquidity availability (0.0-1.0)
  gasVolatility: number;      // Gas price volatility
  competitorDensity: number;  // MEV bot competition level
  networkCongestion: number;  // Network congestion level
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
  // NEW: Enhanced performance analysis
  performanceLevel: PerformanceLevel;
  performanceBreakdown: PerformanceBreakdown;
  scenarioResults: ScenarioResults;
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
}

// Default configuration based on research
const DEFAULT_CONFIG: MonteCarloConfig = {
  simulations: 10000,
  timeHorizonDays: 30,
  confidenceLevel: 0.95,
  antithetic: true,
  controlVariate: true
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
  }
};

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
   */
  async runSimulation(
    strategy: StrategyProfile,
    marketCondition: MarketCondition = MARKET_CONDITIONS.normal
  ): Promise<SimulationResult> {
    const startTime = Date.now();
    
    logger.info('Starting Monte Carlo simulation', {
      component: 'MonteCarloEngine',
      simulations: this.config.simulations,
      timeHorizon: this.config.timeHorizonDays,
      strategy: strategy.name
    });

    // Generate simulation paths
    const paths = this.generatePaths(strategy, marketCondition);

    // Calculate statistics
    const results = this.analyzeResults(paths, strategy);

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

    // NEW: Calculate performance level and breakdown
    results.performanceBreakdown = this.calculatePerformanceBreakdown(results, strategy, marketCondition);
    results.performanceLevel = results.performanceBreakdown.level;
    
    // NEW: Calculate scenario results (variable outcomes)
    results.scenarioResults = this.calculateScenarioResults(results);

    const elapsed = Date.now() - startTime;
    
    logger.info('Monte Carlo simulation complete', {
      component: 'MonteCarloEngine',
      elapsed: `${elapsed}ms`,
      expectedProfit: results.expectedProfit.toFixed(4),
      sharpeRatio: results.sharpeRatio.toFixed(4),
      winRate: `${(results.winRate * 100).toFixed(2)}%`,
      rating: results.strategyRating,
      performanceLevel: results.performanceLevel,
      tradingApproval: results.performanceBreakdown.tradingApproval
    });

    return results;
  }

  /**
   * Generate simulation paths using variance reduction techniques
   */
  private generatePaths(
    strategy: StrategyProfile,
    market: MarketCondition
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
        const outcome = this.simulateTradeWithRandoms(strategy, market, r1, r2);
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
          
          const antiOutcome = this.simulateTradeWithRandoms(strategy, market, r1, r2);
          antiCumulativePnL += antiOutcome;
          antitheticPath.push(antiCumulativePnL);
        }
        paths.push(antitheticPath);
      }
    }

    return paths;
  }
  
  /**
   * Simulate trade with explicit random numbers (for antithetic pairing)
   */
  private simulateTradeWithRandoms(
    strategy: StrategyProfile, 
    market: MarketCondition,
    successRandom: number,
    volatilityRandom: number
  ): number {
    // Adjust success rate based on market conditions
    const adjustedSuccessRate = strategy.baseSuccessRate 
      * market.liquidityScore 
      * (1 - market.competitorDensity * 0.3)
      * (1 - market.networkCongestion * 0.2);

    // Generate trade outcome using provided random numbers
    const isSuccess = successRandom < adjustedSuccessRate;

    if (isSuccess) {
      // Profitable trade with volatility-adjusted returns
      const baseProfit = strategy.avgProfitPerTrade;
      const volatilityImpact = (volatilityRandom - 0.5) * 2 * market.volatility * baseProfit;
      const slippageImpact = strategy.slippageTolerance * (1 + market.networkCongestion);
      
      return baseProfit + volatilityImpact - slippageImpact;
    } else {
      // Loss trade
      const baseLoss = strategy.avgLossPerTrade;
      const volatilityImpact = volatilityRandom * market.volatility * baseLoss;
      
      return -(baseLoss + volatilityImpact + strategy.gasPerTrade);
    }
  }

  /**
   * Simulate a single trade outcome (uses internal RNG)
   */
  private simulateTrade(strategy: StrategyProfile, market: MarketCondition): number {
    return this.simulateTradeWithRandoms(strategy, market, this.rng(), this.rng());
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
}

// Factory function for creating configured engines
export function createMonteCarloEngine(config?: Partial<MonteCarloConfig>): MonteCarloEngine {
  return new MonteCarloEngine(config);
}

export { MonteCarloEngine };
