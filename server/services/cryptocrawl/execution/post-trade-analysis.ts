/**
 * POST-TRADE ANALYSIS
 * 
 * Analyzes execution vs model:
 * - Compare actual vs predicted metrics
 * - Tune parameters by trade bucket
 * - Track performance for scaling decisions
 */

import { createLogger } from '../../../logger';
import type { DecisionResult } from '../decision-engine';
import type { ExecutionStubResult } from './execution-stub';

const log = createLogger('PostTradeAnalysis');

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface PostTradeAnalysis {
  tradeId: string;
  timestamp: Date;
  
  // Execution vs Model Comparison
  executionVsModel: {
    predictedProfit: number;
    actualProfit: number;
    profitDeviation: number;         // Actual - Predicted
    profitDeviationPercent: number;  // (Actual - Predicted) / Predicted * 100
    
    predictedSlippage: number;
    actualSlippage: number;
    slippageDeviation: number;
    
    predictedLatency: number;
    actualLatency: number;
    latencyDeviation: number;
    
    predictedConfidence: number;
    actualOutcome: 'success' | 'failure';
    confidenceAccuracy: number;      // 0-1, how well confidence predicted outcome
  };
  
  // Trade Bucket Classification
  tradeBucket: {
    size: 'micro' | 'small' | 'medium' | 'large';
    volatility: 'low' | 'medium' | 'high';
    liquidity: 'low' | 'medium' | 'high';
    timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  };
  
  // Parameter Tuning Recommendations
  tuningRecommendations: {
    signalFusion: {
      currentThreshold: number;
      recommendedThreshold: number;
      reason: string;
    };
    monteCarlo: {
      currentSimulations: number;
      recommendedSimulations: number;
      reason: string;
    };
    riskGovernor: {
      currentMaxPositionSize: number;
      recommendedMaxPositionSize: number;
      reason: string;
    };
  };
  
  // Scaling Decision
  scalingDecision: {
    readyToScale: boolean;
    recommendedNextSize: number;
    stabilityScore: number;          // 0-1, how stable recent performance
    reason: string;
  };
}

// ============================================================================
// POST-TRADE ANALYZER
// ============================================================================

export class PostTradeAnalyzer {
  private tradeHistory: PostTradeAnalysis[] = [];

  /**
   * Analyze a completed trade
   */
  analyzeTrade(
    decisionResult: DecisionResult,
    executionResult: ExecutionStubResult,
    actualMetrics?: {
      profit?: number;
      slippage?: number;
      latency?: number;
    }
  ): PostTradeAnalysis {
    const tradeId = executionResult.executionId;
    const timestamp = new Date();

    // Extract predicted values from decision result
    const predictedProfit = decisionResult.fusedSignal?.opportunity?.profitEstimate || 0;
    const predictedSlippage = 1 - (decisionResult.riskAssessment?.slippageTolerance || 1);
    const predictedLatency = decisionResult.riskAssessment?.latencyTolerance 
      ? (1 - decisionResult.riskAssessment.latencyTolerance) * 500 // Convert tolerance to latency estimate
      : 50;
    const predictedConfidence = decisionResult.outputSignal?.confidence || 0;

    // Get actual values (use simulated if actual not provided)
    const actualProfit = actualMetrics?.profit || executionResult.simulatedProfit || 0;
    const actualSlippage = actualMetrics?.slippage || 0.02; // Default 2% if not provided
    const actualLatency = actualMetrics?.latency || executionResult.latency;
    const actualOutcome: 'success' | 'failure' = executionResult.success ? 'success' : 'failure';

    // Calculate deviations
    const profitDeviation = actualProfit - predictedProfit;
    const profitDeviationPercent = predictedProfit !== 0 
      ? (profitDeviation / predictedProfit) * 100 
      : 0;
    const slippageDeviation = actualSlippage - predictedSlippage;
    const latencyDeviation = actualLatency - predictedLatency;
    const confidenceAccuracy = actualOutcome === 'success' 
      ? predictedConfidence 
      : 1 - predictedConfidence;

    // Classify trade bucket
    const tradeBucket = this.classifyTradeBucket(decisionResult, executionResult);

    // Generate tuning recommendations
    const tuningRecommendations = this.generateTuningRecommendations(
      decisionResult,
      executionResult,
      profitDeviationPercent
    );

    // Determine scaling decision
    const scalingDecision = this.determineScalingDecision(
      decisionResult,
      executionResult,
      this.tradeHistory
    );

    const analysis: PostTradeAnalysis = {
      tradeId,
      timestamp,
      executionVsModel: {
        predictedProfit,
        actualProfit,
        profitDeviation,
        profitDeviationPercent,
        predictedSlippage,
        actualSlippage,
        slippageDeviation,
        predictedLatency,
        actualLatency,
        latencyDeviation,
        predictedConfidence,
        actualOutcome,
        confidenceAccuracy,
      },
      tradeBucket,
      tuningRecommendations,
      scalingDecision,
    };

    // Store in history
    this.tradeHistory.push(analysis);
    if (this.tradeHistory.length > 1000) {
      this.tradeHistory.shift();
    }

    log.info('Post-trade analysis complete', {
      tradeId,
      profitDeviationPercent: `${profitDeviationPercent.toFixed(2)}%`,
      confidenceAccuracy: confidenceAccuracy.toFixed(3),
      readyToScale: scalingDecision.readyToScale,
    });

    return analysis;
  }

  /**
   * Classify trade into bucket
   */
  private classifyTradeBucket(
    decisionResult: DecisionResult,
    executionResult: ExecutionStubResult
  ): PostTradeAnalysis['tradeBucket'] {
    const profitEstimate = decisionResult.fusedSignal?.opportunity?.profitEstimate || 0;
    const volatility = decisionResult.fusedSignal?.marketData?.volatility || 0.5;
    const liquidityScore = decisionResult.fusedSignal?.marketData?.liquidityScore || 0.5;
    const hour = new Date().getHours();

    // Size classification
    let size: 'micro' | 'small' | 'medium' | 'large';
    if (profitEstimate < 0.01) {
      size = 'micro';
    } else if (profitEstimate < 0.1) {
      size = 'small';
    } else if (profitEstimate < 1.0) {
      size = 'medium';
    } else {
      size = 'large';
    }

    // Volatility classification
    const volatilityLevel: 'low' | 'medium' | 'high' = 
      volatility < 0.4 ? 'low' : volatility < 0.7 ? 'medium' : 'high';

    // Liquidity classification
    const liquidityLevel: 'low' | 'medium' | 'high' = 
      liquidityScore < 0.5 ? 'low' : liquidityScore < 0.8 ? 'medium' : 'high';

    // Time of day classification
    let timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
    if (hour >= 6 && hour < 12) {
      timeOfDay = 'morning';
    } else if (hour >= 12 && hour < 18) {
      timeOfDay = 'afternoon';
    } else if (hour >= 18 && hour < 24) {
      timeOfDay = 'evening';
    } else {
      timeOfDay = 'night';
    }

    return {
      size,
      volatility: volatilityLevel,
      liquidity: liquidityLevel,
      timeOfDay,
    };
  }

  /**
   * Generate tuning recommendations by trade bucket
   */
  private generateTuningRecommendations(
    decisionResult: DecisionResult,
    executionResult: ExecutionStubResult,
    profitDeviationPercent: number
  ): PostTradeAnalysis['tuningRecommendations'] {
    const currentSignalFusionThreshold = 0.6; // Default
    const currentMonteCarloSims = 3000; // Default for live path
    const currentMaxPositionSize = 10000; // Default

    // Tune signal fusion threshold based on accuracy
    let recommendedSignalFusionThreshold = currentSignalFusionThreshold;
    let signalFusionReason = 'No change recommended';
    if (Math.abs(profitDeviationPercent) > 20) {
      // High deviation - tighten threshold
      recommendedSignalFusionThreshold = Math.min(0.8, currentSignalFusionThreshold + 0.1);
      signalFusionReason = `High profit deviation (${profitDeviationPercent.toFixed(1)}%) - tighten threshold`;
    } else if (Math.abs(profitDeviationPercent) < 5 && executionResult.success) {
      // Low deviation and success - can relax slightly
      recommendedSignalFusionThreshold = Math.max(0.5, currentSignalFusionThreshold - 0.05);
      signalFusionReason = `Low profit deviation (${profitDeviationPercent.toFixed(1)}%) - can relax threshold`;
    }

    // Tune Monte Carlo simulations based on performance
    let recommendedMonteCarloSims = currentMonteCarloSims;
    let monteCarloReason = 'No change recommended';
    if (executionResult.success && Math.abs(profitDeviationPercent) < 10) {
      // Good performance - can reduce sims for speed
      recommendedMonteCarloSims = Math.max(1000, currentMonteCarloSims - 500);
      monteCarloReason = 'Good performance - reduce sims for speed';
    } else if (!executionResult.success || Math.abs(profitDeviationPercent) > 30) {
      // Poor performance - increase sims for accuracy
      recommendedMonteCarloSims = Math.min(5000, currentMonteCarloSims + 1000);
      monteCarloReason = 'Poor performance - increase sims for accuracy';
    }

    // Tune position size based on success rate
    let recommendedMaxPositionSize = currentMaxPositionSize;
    let riskGovernorReason = 'No change recommended';
    if (executionResult.success && profitDeviationPercent > 0) {
      // Successful and profitable - can increase size slightly
      recommendedMaxPositionSize = Math.min(20000, currentMaxPositionSize * 1.1);
      riskGovernorReason = 'Successful trade - can increase position size';
    } else if (!executionResult.success) {
      // Failed - reduce size
      recommendedMaxPositionSize = Math.max(5000, currentMaxPositionSize * 0.9);
      riskGovernorReason = 'Failed trade - reduce position size';
    }

    return {
      signalFusion: {
        currentThreshold: currentSignalFusionThreshold,
        recommendedThreshold: recommendedSignalFusionThreshold,
        reason: signalFusionReason,
      },
      monteCarlo: {
        currentSimulations: currentMonteCarloSims,
        recommendedSimulations: recommendedMonteCarloSims,
        reason: monteCarloReason,
      },
      riskGovernor: {
        currentMaxPositionSize,
        recommendedMaxPositionSize,
        reason: riskGovernorReason,
      },
    };
  }

  /**
   * Determine scaling decision
   */
  private determineScalingDecision(
    decisionResult: DecisionResult,
    executionResult: ExecutionStubResult,
    tradeHistory: PostTradeAnalysis[]
  ): PostTradeAnalysis['scalingDecision'] {
    // Calculate stability score from recent trades
    const recentTrades = tradeHistory.slice(-10); // Last 10 trades
    let stabilityScore = 0.5; // Default

    if (recentTrades.length >= 5) {
      const successRate = recentTrades.filter(t => t.executionVsModel.actualOutcome === 'success').length / recentTrades.length;
      const avgDeviation = recentTrades.reduce((sum, t) => sum + Math.abs(t.executionVsModel.profitDeviationPercent), 0) / recentTrades.length;
      
      // Stability = high success rate + low deviation
      stabilityScore = (successRate * 0.6) + ((1 - Math.min(avgDeviation / 50, 1)) * 0.4);
    }

    // Determine if ready to scale
    const readyToScale = stabilityScore >= 0.7 && 
                         recentTrades.length >= 5 &&
                         recentTrades.filter(t => t.executionVsModel.actualOutcome === 'success').length >= 4;

    // Recommend next size
    const currentSize = decisionResult.fusedSignal?.opportunity?.profitEstimate || 0.001;
    const recommendedNextSize = readyToScale 
      ? currentSize * 1.5 // Scale up 50%
      : currentSize; // Stay same size

    const reason = readyToScale
      ? `Stability score ${stabilityScore.toFixed(2)} >= 0.7, ${recentTrades.filter(t => t.executionVsModel.actualOutcome === 'success').length}/${recentTrades.length} recent trades successful`
      : `Stability score ${stabilityScore.toFixed(2)} < 0.7 or insufficient trade history - maintain current size`;

    return {
      readyToScale,
      recommendedNextSize,
      stabilityScore,
      reason,
    };
  }

  /**
   * Get trade history by bucket
   */
  getTradeHistoryByBucket(bucket: Partial<PostTradeAnalysis['tradeBucket']>): PostTradeAnalysis[] {
    return this.tradeHistory.filter(trade => {
      if (bucket.size && trade.tradeBucket.size !== bucket.size) return false;
      if (bucket.volatility && trade.tradeBucket.volatility !== bucket.volatility) return false;
      if (bucket.liquidity && trade.tradeBucket.liquidity !== bucket.liquidity) return false;
      if (bucket.timeOfDay && trade.tradeBucket.timeOfDay !== bucket.timeOfDay) return false;
      return true;
    });
  }

  /**
   * Get overall statistics
   */
  getStatistics(): {
    totalTrades: number;
    successRate: number;
    avgProfitDeviationPercent: number;
    avgConfidenceAccuracy: number;
    stabilityScore: number;
  } {
    if (this.tradeHistory.length === 0) {
      return {
        totalTrades: 0,
        successRate: 0,
        avgProfitDeviationPercent: 0,
        avgConfidenceAccuracy: 0,
        stabilityScore: 0,
      };
    }

    const successRate = this.tradeHistory.filter(t => t.executionVsModel.actualOutcome === 'success').length / this.tradeHistory.length;
    const avgProfitDeviationPercent = this.tradeHistory.reduce((sum, t) => sum + Math.abs(t.executionVsModel.profitDeviationPercent), 0) / this.tradeHistory.length;
    const avgConfidenceAccuracy = this.tradeHistory.reduce((sum, t) => sum + t.executionVsModel.confidenceAccuracy, 0) / this.tradeHistory.length;
    
    const recentTrades = this.tradeHistory.slice(-10);
    const recentSuccessRate = recentTrades.length > 0 
      ? recentTrades.filter(t => t.executionVsModel.actualOutcome === 'success').length / recentTrades.length
      : 0;
    const recentAvgDeviation = recentTrades.length > 0
      ? recentTrades.reduce((sum, t) => sum + Math.abs(t.executionVsModel.profitDeviationPercent), 0) / recentTrades.length
      : 0;
    const stabilityScore = (recentSuccessRate * 0.6) + ((1 - Math.min(recentAvgDeviation / 50, 1)) * 0.4);

    return {
      totalTrades: this.tradeHistory.length,
      successRate,
      avgProfitDeviationPercent,
      avgConfidenceAccuracy,
      stabilityScore,
    };
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

let postTradeAnalyzerInstance: PostTradeAnalyzer | null = null;

export function getPostTradeAnalyzer(): PostTradeAnalyzer {
  if (!postTradeAnalyzerInstance) {
    postTradeAnalyzerInstance = new PostTradeAnalyzer();
  }
  return postTradeAnalyzerInstance;
}

export default PostTradeAnalyzer;
