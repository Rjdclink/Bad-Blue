/**
 * MONTE CARLO STRESS GATE
 * 
 * Stress tests signals through Monte Carlo simulation:
 * - Volatility stress testing
 * - Fees stress testing
 * - Slippage stress testing
 * - Latency stress testing
 * 
 * Quantifies downside tails (worst-case paths) and determines if signal is tradeable.
 */

import { createLogger } from '../../../logger';
import type { FusedSignal } from './signal-fusion-gate';

const log = createLogger('MonteCarloStressGate');

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface StressTestConfig {
  simulations: number;              // Number of Monte Carlo iterations
  confidenceLevel: number;          // Confidence level for VaR (0.95 = 95%)
  stressTestVolatility: boolean;
  stressTestFees: boolean;
  stressTestSlippage: boolean;
  stressTestLatency: boolean;
  minPassThreshold: number;         // Minimum confidence to pass (0-1)
}

export interface StressTestResult {
  passed: boolean;
  confidence: number;
  reason: string;
  
  // Risk metrics
  valueAtRisk95: number;           // 95% VaR (downside tail)
  valueAtRisk99: number;           // 99% VaR (extreme downside)
  conditionalVaR: number;          // Expected Shortfall (CVaR)
  maxDrawdown: number;              // Maximum drawdown in worst-case path
  worstCasePath: number[];          // Worst-case profit path
  
  // Stress test results
  volatilityStress: {
    tested: boolean;
    worstCase: number;
    percentile95: number;
    percentile99: number;
  };
  feesStress: {
    tested: boolean;
    worstCase: number;
    impact: number;                 // Impact on profit (%)
  };
  slippageStress: {
    tested: boolean;
    worstCase: number;
    impact: number;                 // Impact on profit (%)
  };
  latencyStress: {
    tested: boolean;
    worstCase: number;              // ms
    impact: number;                 // Impact on profit (%)
  };
  
  // Pass/fail thresholds
  passFailThreshold: number;
  killHoldTriggers: {
    kill: boolean;                  // Kill switch trigger
    hold: boolean;                  // Hold (don't execute) trigger
    reason?: string;
  };
  
  // Confidence intervals
  confidenceInterval: [number, number];
  percentiles: {
    p5: number;                     // 5th percentile (worst case)
    p25: number;
    p50: number;                    // Median
    p75: number;
    p95: number;                    // 95th percentile (best case)
  };
}

// ============================================================================
// MONTE CARLO STRESS GATE CLASS
// ============================================================================

export class MonteCarloStressGate {
  private config: StressTestConfig;
  private initialized: boolean = false;

  constructor(config: StressTestConfig) {
    this.config = config;
    log.info('Monte Carlo Stress Gate created', { config });
  }

  /**
   * Initialize the gate
   */
  async initialize(): Promise<void> {
    this.initialized = true;
    log.info('Monte Carlo Stress Gate initialized');
  }

  /**
   * Stress test a fused signal through Monte Carlo simulation
   */
  async stressTest(fusedSignal: FusedSignal): Promise<StressTestResult> {
    if (!this.initialized) {
      throw new Error('Monte Carlo Stress Gate not initialized');
    }

    if (!fusedSignal.opportunity) {
      return {
        passed: false,
        confidence: 0,
        reason: 'No opportunity signal to stress test',
        valueAtRisk95: 0,
        valueAtRisk99: 0,
        conditionalVaR: 0,
        maxDrawdown: 0,
        worstCasePath: [],
        volatilityStress: { tested: false, worstCase: 0, percentile95: 0, percentile99: 0 },
        feesStress: { tested: false, worstCase: 0, impact: 0 },
        slippageStress: { tested: false, worstCase: 0, impact: 0 },
        latencyStress: { tested: false, worstCase: 0, impact: 0 },
        passFailThreshold: this.config.minPassThreshold,
        killHoldTriggers: { kill: false, hold: false },
        confidenceInterval: [0, 0],
        percentiles: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 },
      };
    }

    const opportunity = fusedSignal.opportunity;
    const marketData = fusedSignal.marketData;

    log.info('Running Monte Carlo stress test', {
      asset: opportunity.asset,
      profitEstimate: opportunity.profitEstimate,
      simulations: this.config.simulations,
    });

    // Run Monte Carlo simulation
    const simulationResults = this.runMonteCarloSimulation(
      opportunity,
      marketData,
      this.config.simulations
    );

    // Calculate risk metrics
    const valueAtRisk95 = this.calculateVaR(simulationResults, 0.95);
    const valueAtRisk99 = this.calculateVaR(simulationResults, 0.99);
    const conditionalVaR = this.calculateCVaR(simulationResults, 0.95);
    const maxDrawdown = this.calculateMaxDrawdown(simulationResults);
    const worstCasePath = this.getWorstCasePath(simulationResults);

    // Stress test components
    const volatilityStress = this.config.stressTestVolatility
      ? this.stressTestVolatility(opportunity, marketData, simulationResults)
      : { tested: false, worstCase: 0, percentile95: 0, percentile99: 0 };

    const feesStress = this.config.stressTestFees
      ? this.stressTestFees(opportunity, simulationResults)
      : { tested: false, worstCase: 0, impact: 0 };

    const slippageStress = this.config.stressTestSlippage
      ? this.stressTestSlippage(opportunity, simulationResults)
      : { tested: false, worstCase: 0, impact: 0 };

    const latencyStress = this.config.stressTestLatency
      ? this.stressTestLatency(opportunity, simulationResults)
      : { tested: false, worstCase: 0, impact: 0 };

    // Calculate percentiles
    const sortedResults = [...simulationResults].sort((a, b) => a - b);
    const percentiles = {
      p5: this.getPercentile(sortedResults, 0.05),
      p25: this.getPercentile(sortedResults, 0.25),
      p50: this.getPercentile(sortedResults, 0.50),
      p75: this.getPercentile(sortedResults, 0.75),
      p95: this.getPercentile(sortedResults, 0.95),
    };

    // Confidence interval (95%)
    const confidenceInterval: [number, number] = [
      percentiles.p5,
      percentiles.p95,
    ];

    // Calculate overall confidence
    const baseConfidence = opportunity.confidence;
    const riskPenalty = Math.max(0, (valueAtRisk95 / opportunity.profitEstimate) * 0.3);
    const drawdownPenalty = Math.max(0, (maxDrawdown / opportunity.profitEstimate) * 0.2);
    const confidence = Math.max(0, baseConfidence - riskPenalty - drawdownPenalty);

    // Kill/hold triggers
    const killHoldTriggers = this.determineKillHoldTriggers(
      valueAtRisk99,
      maxDrawdown,
      opportunity.profitEstimate,
      percentiles.p5
    );

    // Pass/fail determination
    const passed = confidence >= this.config.minPassThreshold &&
                   !killHoldTriggers.kill &&
                   percentiles.p5 > -opportunity.profitEstimate * 0.5; // Worst case shouldn't lose more than 50% of expected profit

    const reason = passed
      ? `Stress test passed: confidence ${confidence.toFixed(3)}, VaR95=${valueAtRisk95.toFixed(2)}, maxDrawdown=${maxDrawdown.toFixed(2)}`
      : `Stress test failed: confidence ${confidence.toFixed(3)} < ${this.config.minPassThreshold}${killHoldTriggers.kill ? `, KILL TRIGGERED: ${killHoldTriggers.reason}` : ''}`;

    return {
      passed,
      confidence,
      reason,
      valueAtRisk95,
      valueAtRisk99,
      conditionalVaR,
      maxDrawdown,
      worstCasePath,
      volatilityStress,
      feesStress,
      slippageStress,
      latencyStress,
      passFailThreshold: this.config.minPassThreshold,
      killHoldTriggers,
      confidenceInterval,
      percentiles,
    };
  }

  /**
   * Run Monte Carlo simulation
   */
  private runMonteCarloSimulation(
    opportunity: FusedSignal['opportunity']!,
    marketData: FusedSignal['marketData'] | undefined,
    simulations: number
  ): number[] {
    const results: number[] = [];
    const baseProfit = opportunity.profitEstimate;
    const volatility = marketData?.volatility || 0.6;
    const baseConfidence = opportunity.confidence;

    for (let i = 0; i < simulations; i++) {
      // Simulate profit with random walk
      let profit = baseProfit;
      
      // Volatility impact (random walk)
      const volatilityShock = (Math.random() - 0.5) * 2 * volatility * baseProfit;
      profit += volatilityShock;
      
      // Confidence-based adjustment
      const confidenceMultiplier = 0.5 + (baseConfidence * 0.5); // Scale between 0.5 and 1.0
      profit *= confidenceMultiplier;
      
      // Random market conditions
      const marketShock = (Math.random() - 0.5) * 0.3 * baseProfit;
      profit += marketShock;
      
      results.push(profit);
    }

    return results;
  }

  /**
   * Calculate Value at Risk (VaR)
   */
  private calculateVaR(results: number[], confidence: number): number {
    const sorted = [...results].sort((a, b) => a - b);
    const index = Math.floor((1 - confidence) * sorted.length);
    return Math.abs(sorted[index] || 0);
  }

  /**
   * Calculate Conditional Value at Risk (CVaR / Expected Shortfall)
   */
  private calculateCVaR(results: number[], confidence: number): number {
    const sorted = [...results].sort((a, b) => a - b);
    const tailStart = Math.floor((1 - confidence) * sorted.length);
    const tail = sorted.slice(0, tailStart);
    if (tail.length === 0) return 0;
    const avgTail = tail.reduce((sum, v) => sum + v, 0) / tail.length;
    return Math.abs(avgTail);
  }

  /**
   * Calculate maximum drawdown
   */
  private calculateMaxDrawdown(results: number[]): number {
    let maxDrawdown = 0;
    let peak = results[0];

    for (const value of results) {
      if (value > peak) {
        peak = value;
      }
      const drawdown = (peak - value) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return maxDrawdown;
  }

  /**
   * Get worst-case path
   */
  private getWorstCasePath(results: number[]): number[] {
    // Return worst 10% of results as "path"
    const sorted = [...results].sort((a, b) => a - b);
    return sorted.slice(0, Math.floor(results.length * 0.1));
  }

  /**
   * Stress test volatility
   */
  private stressTestVolatility(
    opportunity: FusedSignal['opportunity']!,
    marketData: FusedSignal['marketData'] | undefined,
    results: number[]
  ): StressTestResult['volatilityStress'] {
    const sorted = [...results].sort((a, b) => a - b);
    return {
      tested: true,
      worstCase: sorted[0] || 0,
      percentile95: this.getPercentile(sorted, 0.05),
      percentile99: this.getPercentile(sorted, 0.01),
    };
  }

  /**
   * Stress test fees
   */
  private stressTestFees(
    opportunity: FusedSignal['opportunity']!,
    results: number[]
  ): StressTestResult['feesStress'] {
    // Simulate high gas fees (up to 20% of profit)
    const maxFeeImpact = opportunity.profitEstimate * 0.2;
    const worstCaseFee = maxFeeImpact;
    const worstCaseProfit = Math.min(...results) - worstCaseFee;
    
    return {
      tested: true,
      worstCase: worstCaseFee,
      impact: (worstCaseFee / opportunity.profitEstimate) * 100,
    };
  }

  /**
   * Stress test slippage
   */
  private stressTestSlippage(
    opportunity: FusedSignal['opportunity']!,
    results: number[]
  ): StressTestResult['slippageStress'] {
    // Simulate slippage (up to 15% of profit)
    const maxSlippageImpact = opportunity.profitEstimate * 0.15;
    const worstCaseSlippage = maxSlippageImpact;
    const worstCaseProfit = Math.min(...results) - worstCaseSlippage;
    
    return {
      tested: true,
      worstCase: worstCaseSlippage,
      impact: (worstCaseSlippage / opportunity.profitEstimate) * 100,
    };
  }

  /**
   * Stress test latency
   */
  private stressTestLatency(
    opportunity: FusedSignal['opportunity']!,
    results: number[]
  ): StressTestResult['latencyStress'] {
    // Simulate latency impact (opportunity decay over time)
    // High latency = missed opportunity = profit reduction
    const maxLatency = 1000; // ms
    const latencyDecayRate = 0.001; // 0.1% per ms
    const worstCaseLatency = maxLatency;
    const worstCaseImpact = opportunity.profitEstimate * latencyDecayRate * worstCaseLatency;
    
    return {
      tested: true,
      worstCase: worstCaseLatency,
      impact: (worstCaseImpact / opportunity.profitEstimate) * 100,
    };
  }

  /**
   * Determine kill/hold triggers
   */
  private determineKillHoldTriggers(
    valueAtRisk99: number,
    maxDrawdown: number,
    baseProfit: number,
    worstCase: number
  ): StressTestResult['killHoldTriggers'] {
    // Kill triggers (hard stops)
    if (valueAtRisk99 > baseProfit * 0.8) {
      return {
        kill: true,
        hold: false,
        reason: `VaR99 (${valueAtRisk99.toFixed(2)}) exceeds 80% of base profit (${baseProfit.toFixed(2)})`,
      };
    }

    if (maxDrawdown > 0.5) {
      return {
        kill: true,
        hold: false,
        reason: `Max drawdown (${(maxDrawdown * 100).toFixed(1)}%) exceeds 50%`,
      };
    }

    if (worstCase < -baseProfit * 0.5) {
      return {
        kill: true,
        hold: false,
        reason: `Worst case (${worstCase.toFixed(2)}) loses more than 50% of base profit`,
      };
    }

    // Hold triggers (don't execute, but don't kill)
    if (valueAtRisk99 > baseProfit * 0.5) {
      return {
        kill: false,
        hold: true,
        reason: `VaR99 (${valueAtRisk99.toFixed(2)}) exceeds 50% of base profit`,
      };
    }

    if (maxDrawdown > 0.3) {
      return {
        kill: false,
        hold: true,
        reason: `Max drawdown (${(maxDrawdown * 100).toFixed(1)}%) exceeds 30%`,
      };
    }

    return {
      kill: false,
      hold: false,
    };
  }

  /**
   * Get percentile from sorted array
   */
  private getPercentile(sorted: number[], percentile: number): number {
    const index = Math.floor(percentile * sorted.length);
    return sorted[index] || 0;
  }
}
